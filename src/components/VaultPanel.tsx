// src/components/VaultPanel.tsx
// Fast auto-pick with caching + persistent lives.
// 1) Try cached tokenId first (instant pop-up).
// 2) Quick balanceOf(address) -> if 0, skip scan.
// 3) Batched probes if needed.
// 4) Wait receipt -> add life + persist.
// Comments in English only.

'use client';

import { useEffect, useMemo, useState } from "react";
import { zeroAddress } from "viem";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import { readContract, writeContract, getPublicClient } from "@wagmi/core";

/* ===== ENV / CONSTS ===== */
const MONAD_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const ALLOWED_CONTRACT = "0x88c78d5852f45935324c6d100052958f694e8446";
const VAULT = (import.meta.env.VITE_VAULT_ADDRESS as string) || zeroAddress;

/* ---- Probe tuning ---- */
const SMALL_FIRST_RANGE = 64;      // quick pass: 0..64
const MAX_ERC721_PROBES = 400;     // overall ownerOf calls cap
const MAX_ERC1155_PROBES = 400;    // overall balanceOf calls cap
const DEFAULT_TOP_GUESS  = 10_000; // fallback upper bound if no totalSupply
const BATCH_SIZE         = 24;     // parallel calls per batch
const YIELD_EVERY        = 6;      // yield to UI every N batches

/* ===== ABIs ===== */
const ERC165_ABI = [
  { type: "function", name: "supportsInterface", stateMutability: "view",
    inputs: [{ name: "interfaceId", type: "bytes4" }], outputs: [{ type: "bool" }] },
] as const;
const IFACE_ERC721      = "0x80ac58cd";
const IFACE_ERC1155     = "0xd9b67a26";
const IFACE_ERC721_ENUM = "0x780e9d63";

const ERC721_READ_ABI = [
  { type: "function", name: "ownerOf", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "tokenOfOwnerByIndex", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "index", type: "uint256" }],
    outputs: [{ type: "uint256" }] },
] as const;

const ERC721_WRITE_ABI = [
  { type: "function", name: "safeTransferFrom", stateMutability: "nonpayable",
    inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "tokenId", type: "uint256" }],
    outputs: [] },
] as const;

const ERC1155_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }],
    outputs: [{ type: "uint256" }] },
  { type: "function", name: "safeTransferFrom", stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "id", type: "uint256" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }
    ],
    outputs: [] },
] as const;

/* ===== Local persistence ===== */
const LIVES_KEY = "wg_lives_v1";
const LASTID_KEY = "wg_last_token_v1"; // stores { "<chain>:<addr>:<contract>:<std>": string(tokenId) }

const livesKey = (cid:number, addr:string)=>`${cid}:${addr.toLowerCase()}`;
const lastIdKey = (cid:number, addr:string, contract:string, std:"ERC721"|"ERC1155") =>
  `${cid}:${addr.toLowerCase()}:${contract.toLowerCase()}:${std}`;

const getLives = (cid:number, addr?:string|null) => {
  if (!addr) return 0;
  const raw = localStorage.getItem(LIVES_KEY);
  const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  return map[livesKey(cid, addr)] ?? 0;
};
const setLivesPersist = (cid:number, addr:string, val:number) => {
  const raw = localStorage.getItem(LIVES_KEY);
  const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  map[livesKey(cid, addr)] = val;
  localStorage.setItem(LIVES_KEY, JSON.stringify(map));
  return val;
};
const addLives = (cid:number, addr:string, d=1) => {
  const cur = getLives(cid, addr);
  return setLivesPersist(cid, addr, cur + d);
};
const getCachedId = (cid:number, addr:string, contract:string, std:"ERC721"|"ERC1155") => {
  const raw = localStorage.getItem(LASTID_KEY);
  const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  const v = map[lastIdKey(cid, addr, contract, std)];
  return v ? BigInt(v) : null;
};
const setCachedId = (cid:number, addr:string, contract:string, std:"ERC721"|"ERC1155", id:bigint) => {
  const raw = localStorage.getItem(LASTID_KEY);
  const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  map[lastIdKey(cid, addr, contract, std)] = id.toString();
  localStorage.setItem(LASTID_KEY, JSON.stringify(map));
};

/* ===== Component ===== */
type Std = "ERC721" | "ERC1155" | "UNKNOWN";

export default function VaultPanel() {
  const cfg = useConfig();
  const { address, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();

  const [std, setStd] = useState<Std>("UNKNOWN");
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [lives, setLives] = useState(() => getLives(MONAD_CHAIN_ID, address));
  const [advanced, setAdvanced] = useState(false);
  const [manualId, setManualId] = useState("");
  const [mode, setMode] = useState<"balanced"|"fast">("balanced");

  function append(s: string) { setLog((p) => (p ? p + "\n" : "") + s); }
  const canSend = isConnected && VAULT !== zeroAddress;

  // pick up lives when address appears/changes (persisted)
  useEffect(() => {
    if (address) setLives(getLives(MONAD_CHAIN_ID, address));
  }, [address]);

  // detect standard on Monad once
  useEffect(() => {
    (async () => {
      try {
        setStd("UNKNOWN"); setLog("");
        append("Detecting token standard on Monad…");
        const is721 = await readContract(cfg, {
          abi: ERC165_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "supportsInterface", args: [IFACE_ERC721 as `0x${string}`],
          chainId: MONAD_CHAIN_ID,
        });
        if (is721) { setStd("ERC721"); append("✓ ERC-721"); return; }
        const is1155 = await readContract(cfg, {
          abi: ERC165_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "supportsInterface", args: [IFACE_ERC1155 as `0x${string}`],
          chainId: MONAD_CHAIN_ID,
        });
        if (is1155) { setStd("ERC1155"); append("✓ ERC-1155"); return; }
        append("⚠️ Unknown; will try both.");
      } catch {
        append("ℹ️ Standard detection failed; fallback enabled.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensureMonad() {
    try { await switchChain({ chainId: MONAD_CHAIN_ID }); } catch {/* Phantom may ignore; it's fine */ }
  }

  /* ---------- Utils ---------- */
  const sleep = (ms:number)=>new Promise(r=>setTimeout(r,ms));
  function chunkify(start: number, end: number, step = 1): number[][] {
    const out: number[][] = []; let buf: number[] = [];
    for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
      buf.push(i); if (buf.length === BATCH_SIZE) { out.push(buf); buf = []; }
    }
    if (buf.length) out.push(buf);
    return out;
  }

  async function ownerOfSafe(id: number): Promise<`0x${string}` | null> {
    try {
      return (await readContract(cfg, {
        abi: ERC721_READ_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "ownerOf", args: [BigInt(id)], chainId: MONAD_CHAIN_ID,
      })) as `0x${string}`;
    } catch { return null; }
  }
  async function balance721Of(user:`0x${string}`): Promise<bigint> {
    try {
      return (await readContract(cfg, {
        abi: ERC721_READ_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "balanceOf", args: [user], chainId: MONAD_CHAIN_ID,
      })) as bigint;
    } catch { return 0n; }
  }
  async function balance1155Safe(user: `0x${string}`, id: number): Promise<bigint> {
    try {
      return (await readContract(cfg, {
        abi: ERC1155_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "balanceOf", args: [user, BigInt(id)], chainId: MONAD_CHAIN_ID,
      })) as bigint;
    } catch { return 0n; }
  }
  async function readTotalSupplyGuess(): Promise<number | null> {
    try {
      const ts = await readContract(cfg, {
        abi: ERC721_READ_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "totalSupply", args: [], chainId: MONAD_CHAIN_ID,
      }) as bigint;
      const n = Number(ts);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch { return null; }
  }

  async function probe721Batch(user: `0x${string}`, ids: number[]): Promise<bigint | null> {
    const res = await Promise.allSettled(ids.map(ownerOfSafe));
    for (let i = 0; i < res.length; i++) {
      const v = res[i];
      if (v.status === "fulfilled" && v.value && v.value.toLowerCase() === user.toLowerCase()) {
        return BigInt(ids[i]);
      }
    }
    return null;
  }
  async function probe1155Batch(user: `0x${string}`, ids: number[]): Promise<bigint | null> {
    const res = await Promise.allSettled(ids.map((id) => balance1155Safe(user, id)));
    for (let i = 0; i < res.length; i++) {
      const v = res[i];
      if (v.status === "fulfilled" && v.value && v.value > 0n) {
        return BigInt(ids[i]);
      }
    }
    return null;
  }

  async function tryEnumerableFirst(user: `0x${string}`): Promise<bigint | null> {
    try {
      const enumerable = await readContract(cfg, {
        abi: ERC165_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "supportsInterface", args: [IFACE_ERC721_ENUM as `0x${string}`],
        chainId: MONAD_CHAIN_ID,
      });
      if (!enumerable) return null;
      const bal = await balance721Of(user);
      if (bal === 0n) return null;
      const id0 = await readContract(cfg, {
        abi: ERC721_READ_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "tokenOfOwnerByIndex", args: [user, 0n], chainId: MONAD_CHAIN_ID,
      }) as bigint;
      return id0;
    } catch { return null; }
  }

  /* ---------- Auto-pick with cache ---------- */

  async function pickAnyErc721(user: `0x${string}`): Promise<bigint | null> {
    // 0) cached id (instant)
    const cached = getCachedId(MONAD_CHAIN_ID, user, ALLOWED_CONTRACT, "ERC721");
    if (cached !== null) {
      const owner = await ownerOfSafe(Number(cached));
      if (owner && owner.toLowerCase() === user.toLowerCase()) return cached;
    }

    // 1) quick exit: balanceOf(address) === 0 => no scan
    if ((await balance721Of(user)) === 0n) return null;

    // 2) enumerable fast path
    const idEnum = await tryEnumerableFirst(user);
    if (idEnum !== null) return idEnum;

    let probes = 0;

    // 3) small ids 0..SMALL_FIRST_RANGE
    {
      const batches = chunkify(0, SMALL_FIRST_RANGE);
      for (let b = 0; b < batches.length; b++) {
        const hit = await probe721Batch(user, batches[b]);
        probes += batches[b].length;
        if (hit !== null) return hit;
        if (b % YIELD_EVERY === 0) await sleep(0);
        if (probes >= MAX_ERC721_PROBES || mode === "fast") break;
      }
    }

    // 4) descending from totalSupply/guess
    const topGuess = (await readTotalSupplyGuess()) ?? DEFAULT_TOP_GUESS;
    {
      const batches = chunkify(topGuess - 1, Math.max(0, topGuess - MAX_ERC721_PROBES), -1);
      for (let b = 0; b < batches.length; b++) {
        const hit = await probe721Batch(user, batches[b]);
        probes += batches[b].length;
        if (hit !== null) return hit;
        if (b % YIELD_EVERY === 0) await sleep(0);
        if (probes >= MAX_ERC721_PROBES) break;
      }
    }

    return null;
  }

  async function pickAnyErc1155(user: `0x${string}`): Promise<bigint | null> {
    // cached id (instant)
    const cached = getCachedId(MONAD_CHAIN_ID, user, ALLOWED_CONTRACT, "ERC1155");
    if (cached !== null) {
      const bal = await balance1155Safe(user, Number(cached));
      if (bal > 0n) return cached;
    }

    let probes = 0;

    // small ids
    {
      const batches = chunkify(0, SMALL_FIRST_RANGE);
      for (let b = 0; b < batches.length; b++) {
        const hit = await probe1155Batch(user, batches[b]);
        probes += batches[b].length;
        if (hit !== null) return hit;
        if (b % YIELD_EVERY === 0) await sleep(0);
        if (probes >= MAX_ERC1155_PROBES || mode === "fast") break;
      }
    }

    // exponential hints
    const hints: number[] = []; for (let v = 128; v <= 65536; v *= 2) hints.push(v);
    {
      const batches: number[][] = [];
      for (let i = 0; i < hints.length; i += BATCH_SIZE) {
        batches.push(hints.slice(i, i + BATCH_SIZE));
      }
      for (let b = 0; b < batches.length; b++) {
        const hit = await probe1155Batch(user, batches[b]);
        probes += batches[b].length;
        if (hit !== null) return hit;
        if (b % YIELD_EVERY === 0) await sleep(0);
        if (probes >= MAX_ERC1155_PROBES) break;
      }
    }

    return null;
  }

  /* ---------- Main actions (with receipt & lives & cache) ---------- */

  async function sendOne() {
    if (!isConnected || VAULT === zeroAddress || !address) return;
    setBusy(true); setLog("");

    try {
      await ensureMonad(); // try switch; reads are pinned to chainId anyway

      // prefer 721 first (or unknown)
      if (std === "ERC721" || std === "UNKNOWN") {
        const id = await pickAnyErc721(address as `0x${string}`);
        if (id !== null) {
          append(`Sending ERC-721 #${id} → VAULT...`);
          const txHash = await writeContract(cfg, {
            abi: ERC721_WRITE_ABI,
            address: ALLOWED_CONTRACT as `0x${string}`,
            functionName: "safeTransferFrom",
            args: [address, VAULT as `0x${string}`, id],
            account: address, chainId: MONAD_CHAIN_ID,
          });
          append(`✅ Tx sent: ${txHash}`);

          const pc = getPublicClient(cfg, { chainId: MONAD_CHAIN_ID });
          const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
          if (receipt.status === "success") {
            setCachedId(MONAD_CHAIN_ID, address, ALLOWED_CONTRACT, "ERC721", id); // cache for instant next time
            const total = addLives(MONAD_CHAIN_ID, address, 1);
            setLives(total);
            append(`+1 life (total: ${total})`);
          } else {
            append("❌ Tx reverted — life not granted.");
          }
          return;
        }
      }

      // 1155 fallback
      const id1155 = await pickAnyErc1155(address as `0x${string}`);
      if (id1155 !== null) {
        append(`Sending ERC-1155 id=${id1155} x1 → VAULT...`);
        const txHash = await writeContract(cfg, {
          abi: ERC1155_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "safeTransferFrom",
          args: [address, VAULT as `0x${string}`, id1155, 1n, "0x"],
          account: address, chainId: MONAD_CHAIN_ID,
        });
        append(`✅ Tx sent: ${txHash}`);

        const pc = getPublicClient(cfg, { chainId: MONAD_CHAIN_ID });
        const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status === "success") {
          setCachedId(MONAD_CHAIN_ID, address, ALLOWED_CONTRACT, "ERC1155", id1155);
          const total = addLives(MONAD_CHAIN_ID, address, 1);
          setLives(total);
          append(`+1 life (total: ${total})`);
        } else {
          append("❌ Tx reverted — life not granted.");
        }
        return;
      }

      append("❌ Auto-pick couldn't find a token. Use Advanced → Send by ID.");
    } catch (e:any) {
      console.error(e);
      const m = e?.shortMessage || e?.message || "write failed";
      if (/user rejected/i.test(m)) append("❌ Rejected in wallet.");
      else if (/insufficient funds/i.test(m)) append("❌ Not enough MON for gas.");
      else if (/chain/i.test(m)) append("❌ Wallet chain mismatch.");
      else append(`❌ ${m}`);
    } finally {
      setBusy(false);
    }
  }

  async function sendManual() {
    if (!address || !manualId) return;
    try {
      await ensureMonad();
      const id = BigInt(manualId);

      if (std === "ERC1155") {
        const tx = await writeContract(cfg, {
          abi: ERC1155_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "safeTransferFrom",
          args: [address, VAULT as `0x${string}`, id, 1n, "0x"],
          account: address, chainId: MONAD_CHAIN_ID,
        });
        append(`✅ Sent 1155 id=${id}: ${tx}`);
        const pc = getPublicClient(cfg, { chainId: MONAD_CHAIN_ID });
        const r = await pc.waitForTransactionReceipt({ hash: tx });
        if (r.status === "success") {
          setCachedId(MONAD_CHAIN_ID, address, ALLOWED_CONTRACT, "ERC1155", id);
          const total = addLives(MONAD_CHAIN_ID, address, 1);
          setLives(total); append(`+1 life (total: ${total})`);
        } else append("❌ Tx reverted — life not granted.");
      } else {
        const tx = await writeContract(cfg, {
          abi: ERC721_WRITE_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "safeTransferFrom",
          args: [address, VAULT as `0x${string}`, id],
          account: address, chainId: MONAD_CHAIN_ID,
        });
        append(`✅ Sent 721 #${id}: ${tx}`);
        const pc = getPublicClient(cfg, { chainId: MONAD_CHAIN_ID });
        const r = await pc.waitForTransactionReceipt({ hash: tx });
        if (r.status === "success") {
          setCachedId(MONAD_CHAIN_ID, address, ALLOWED_CONTRACT, "ERC721", id);
          const total = addLives(MONAD_CHAIN_ID, address, 1);
          setLives(total); append(`+1 life (total: ${total})`);
        } else append("❌ Tx reverted — life not granted.");
      }
    } catch (e:any) {
      console.error(e);
      append(`❌ ${e?.shortMessage || e?.message || "manual write failed"}`);
    }
  }

  /* ---------- UI ---------- */
  const modeLabel = useMemo(() => mode === "fast" ? "Fast (fewer probes)" : "Balanced (wider search)", [mode]);

  return (
    <div className="mx-auto mt-6 max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="mb-2 text-sm text-zinc-400">
        Vault: <span className="font-mono">{VAULT}</span>
      </div>
      <div className="mb-2 text-sm text-zinc-400">
        Allowed: <span className="font-mono">{ALLOWED_CONTRACT}</span>
      </div>

      <div className="mb-2 flex items-center gap-3 text-xs text-zinc-400">
        <span>Scan mode:</span>
        <button
          className={`rounded px-2 py-1 border ${mode==="balanced"?"border-zinc-300":"border-zinc-700"}`}
          onClick={()=>setMode("balanced")}
        >Balanced</button>
        <button
          className={`rounded px-2 py-1 border ${mode==="fast"?"border-zinc-300":"border-zinc-700"}`}
          onClick={()=>setMode("fast")}
        >Fast</button>
        <span className="opacity-70">{modeLabel}</span>
      </div>

      <div className="mb-3 text-lg font-semibold">Send 1 NFT to Vault → get 1 life</div>

      <button
        className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
        disabled={!canSend || busy}
        onClick={sendOne}
      >
        {busy ? "Searching & sending…" : "Send 1 NFT to Vault"}
      </button>

      <div className="mt-3">
        <button
          className="text-xs underline text-zinc-400"
          onClick={() => setAdvanced(v => !v)}
        >
          {advanced ? "Hide" : "Advanced"} (manual id)
        </button>
        {advanced && (
          <div className="mt-2 flex items-center gap-2">
            <input
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm"
              placeholder="tokenId / id"
              value={manualId}
              onChange={(e)=>setManualId(e.target.value)}
            />
            <button
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm"
              onClick={sendManual}
              disabled={!canSend || !manualId}
            >
              Send by ID
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
        <div className="mb-1 font-medium">Log</div>
        <pre className="whitespace-pre-wrap break-all">{log || "—"}</pre>
      </div>

      <div className="mt-1 text-sm">
        Lives: <span className="font-semibold">{lives}</span>
      </div>
    </div>
  );
}
