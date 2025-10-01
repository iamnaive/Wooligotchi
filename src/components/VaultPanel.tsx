// src/components/VaultPanel.tsx
// Auto-pick ANY owned NFT without logs/enumerable: ownerOf/balanceOf probing.
// Works on Monad testnet in MetaMask & Phantom. Direct writeContract. Manual ID fallback kept.
// Comments in English only.

'use client';

import { useEffect, useState } from "react";
import { zeroAddress } from "viem";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import { readContract, writeContract } from "@wagmi/core";

/* ===== ENV / CONSTS ===== */
const MONAD_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const ALLOWED_CONTRACT = "0x88c78d5852f45935324c6d100052958f694e8446";
const VAULT = (import.meta.env.VITE_VAULT_ADDRESS as string) || zeroAddress;

// Probe caps/tuning
const MAX_ERC721_PROBES = 800;     // total ownerOf calls cap
const MAX_ERC1155_PROBES = 600;    // total balanceOf calls cap
const DEFAULT_TOP_GUESS  = 10_000; // upper guess if no totalSupply
const SMALL_FIRST_RANGE  = 64;     // 0..64 quick pass

/* ===== ABIs ===== */
const ERC165_ABI = [
  { type: "function", name: "supportsInterface", stateMutability: "view",
    inputs: [{ name: "interfaceId", type: "bytes4" }], outputs: [{ type: "bool" }] },
] as const;
const IFACE_ERC721      = "0x80ac58cd";
const IFACE_ERC1155     = "0xd9b67a26";
const IFACE_ERC721_ENUM = "0x780e9d63";

// Common read methods (ERC721/721A)
const ERC721_READ_ABI = [
  { type: "function", name: "ownerOf", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  // optional totalSupply on many 721/721A
  { type: "function", name: "totalSupply", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
  // optional enumerable stuff (will try but not required)
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

/* ===== Local lives store ===== */
const LKEY = "wg_lives_v1";
const lKey = (cid:number, addr:string)=>`${cid}:${addr.toLowerCase()}`;
const getLives = (cid:number, addr?:string|null) => {
  if (!addr) return 0;
  const raw = localStorage.getItem(LKEY);
  const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  return map[lKey(cid, addr)] ?? 0;
};
const addLives = (cid:number, addr:string, d=1) => {
  const raw = localStorage.getItem(LKEY);
  const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  const k = lKey(cid, addr); map[k] = (map[k] ?? 0) + d;
  localStorage.setItem(LKEY, JSON.stringify(map));
  return map[k];
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

  function append(s: string) { setLog((p) => (p ? p + "\n" : "") + s); }

  useEffect(() => {
    (async () => {
      try {
        setStd("UNKNOWN"); setLog("");
        append("Detecting token standard (ERC-165) on Monad…");
        const is721 = await readContract(cfg, {
          abi: ERC165_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "supportsInterface",
          args: [IFACE_ERC721 as `0x${string}`],
          chainId: MONAD_CHAIN_ID,
        });
        if (is721) { setStd("ERC721"); append("✓ Detected ERC-721"); return; }
        const is1155 = await readContract(cfg, {
          abi: ERC165_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "supportsInterface",
          args: [IFACE_ERC1155 as `0x${string}`],
          chainId: MONAD_CHAIN_ID,
        });
        if (is1155) { setStd("ERC1155"); append("✓ Detected ERC-1155"); return; }
        append("⚠️ Unknown standard; fallback will try both.");
      } catch {
        append("ℹ️ Standard detection failed; fallback enabled.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensureMonad() {
    try { await switchChain({ chainId: MONAD_CHAIN_ID }); } catch {}
  }

  const canSend = isConnected && VAULT !== zeroAddress;

  /* ---------- Auto-pick without logs ---------- */

  async function tryEnumerableFirst(user: `0x${string}`): Promise<bigint | null> {
    try {
      const enumerable = await readContract(cfg, {
        abi: ERC165_ABI,
        address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "supportsInterface",
        args: [IFACE_ERC721_ENUM as `0x${string}`],
        chainId: MONAD_CHAIN_ID,
      });
      if (!enumerable) return null;
      const bal = await readContract(cfg, {
        abi: ERC721_READ_ABI,
        address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "balanceOf",
        args: [user],
        chainId: MONAD_CHAIN_ID,
      }) as bigint;
      if (bal === 0n) return null;
      const id0 = await readContract(cfg, {
        abi: ERC721_READ_ABI,
        address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "tokenOfOwnerByIndex",
        args: [user, 0n],
        chainId: MONAD_CHAIN_ID,
      }) as bigint;
      return id0;
    } catch { return null; }
  }

  async function readTotalSupplyGuess(): Promise<number | null> {
    try {
      const ts = await readContract(cfg, {
        abi: ERC721_READ_ABI,
        address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "totalSupply",
        args: [],
        chainId: MONAD_CHAIN_ID,
      }) as bigint;
      const n = Number(ts);
      if (Number.isFinite(n) && n > 0) return n;
      return null;
    } catch { return null; }
  }

  async function pickAnyErc721ByOwnerOfProbe(user: `0x${string}`): Promise<bigint | null> {
    let probes = 0;

    // 1) quick pass: small ids 0..SMALL_FIRST_RANGE
    for (let id = 0; id <= SMALL_FIRST_RANGE && probes < MAX_ERC721_PROBES; id++) {
      probes++;
      try {
        const owner = await readContract(cfg, {
          abi: ERC721_READ_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "ownerOf",
          args: [BigInt(id)],
          chainId: MONAD_CHAIN_ID,
        }) as `0x${string}`;
        if (owner.toLowerCase() === user.toLowerCase()) return BigInt(id);
      } catch {/* non-existent id */}
    }

    // 2) try to get totalSupply and probe backwards
    let top = await readTotalSupplyGuess();
    if (!top) top = DEFAULT_TOP_GUESS; // fallback guess
    // probe descending with stride=1 but limited by cap
    for (let id = top - 1; id >= 0 && probes < MAX_ERC721_PROBES; id--) {
      probes++;
      try {
        const owner = await readContract(cfg, {
          abi: ERC721_READ_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "ownerOf",
          args: [BigInt(id)],
          chainId: MONAD_CHAIN_ID,
        }) as `0x${string}`;
        if (owner.toLowerCase() === user.toLowerCase()) return BigInt(id);
      } catch {/* skip */}
      // small break to avoid long loops in TS transpiled code
      if (id % 200 === 0) await new Promise(r => setTimeout(r, 0));
    }

    return null;
  }

  async function pickAnyErc1155ByBalanceProbe(user: `0x${string}`): Promise<bigint | null> {
    let probes = 0;

    // 1) quick pass: 0..SMALL_FIRST_RANGE
    for (let id = 0; id <= SMALL_FIRST_RANGE && probes < MAX_ERC1155_PROBES; id++) {
      probes++;
      try {
        const bal = await readContract(cfg, {
          abi: ERC1155_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "balanceOf",
          args: [user, BigInt(id)],
          chainId: MONAD_CHAIN_ID,
        }) as bigint;
        if (bal > 0n) return BigInt(id);
      } catch {/* skip */}
    }

    // 2) exponential hints: 128,256,512,1024,...
    let id = 128;
    while (id <= 65536 && probes < MAX_ERC1155_PROBES) {
      probes++;
      try {
        const bal = await readContract(cfg, {
          abi: ERC1155_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "balanceOf",
          args: [user, BigInt(id)],
          chainId: MONAD_CHAIN_ID,
        }) as bigint;
        if (bal > 0n) return BigInt(id);
      } catch {}
      id *= 2;
    }

    // 3) short linear sweep 0..N (with cap)
    const N = Math.min(5000, MAX_ERC1155_PROBES - probes); // keep overall cap
    for (let j = 0; j < N && probes < MAX_ERC1155_PROBES; j++) {
      probes++;
      try {
        const bal = await readContract(cfg, {
          abi: ERC1155_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "balanceOf",
          args: [user, BigInt(j)],
          chainId: MONAD_CHAIN_ID,
        }) as bigint;
        if (bal > 0n) return BigInt(j);
      } catch {}
      if (j % 200 === 0) await new Promise(r => setTimeout(r, 0));
    }

    return null;
  }

  /* ---------- Main actions ---------- */

  async function sendOne() {
    if (!isConnected || VAULT === zeroAddress || !address) return;
    setBusy(true); setLog("");

    try {
      await ensureMonad(); // Phantom may ignore, but it won't block reads (we read with chainId)

      // Prefer ERC-721 first (or unknown)
      if (std === "ERC721" || std === "UNKNOWN") {
        // try enumerable shortcut
        const idEnum = await tryEnumerableFirst(address as `0x${string}`);
        const id = idEnum ?? (await pickAnyErc721ByOwnerOfProbe(address as `0x${string}`));
        if (id !== null) {
          append(`Sending ERC-721 #${id} → VAULT...`);
          const tx = await writeContract(cfg, {
            abi: ERC721_WRITE_ABI,
            address: ALLOWED_CONTRACT as `0x${string}`,
            functionName: "safeTransferFrom",
            args: [address, VAULT as `0x${string}`, id],
            account: address,
            chainId: MONAD_CHAIN_ID,
          });
          append(`✅ Tx sent: ${tx}`);
          const total = addLives(MONAD_CHAIN_ID, address, 1); 
          append(`+1 life (total: ${total})`);
          setBusy(false);
          return;
        }
      }

      // ERC-1155 fallback
      const id1155 = await pickAnyErc1155ByBalanceProbe(address as `0x${string}`);
      if (id1155 !== null) {
        append(`Sending ERC-1155 id=${id1155} x1 → VAULT...`);
        const tx2 = await writeContract(cfg, {
          abi: ERC1155_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "safeTransferFrom",
          args: [address, VAULT as `0x${string}`, id1155, 1n, "0x"],
          account: address,
          chainId: MONAD_CHAIN_ID,
        });
        append(`✅ Tx sent: ${tx2}`);
        const total2 = addLives(MONAD_CHAIN_ID, address, 1);
        append(`+1 life (total: ${total2})`);
        setBusy(false);
        return;
      }

      append("❌ Auto-pick couldn't find a token with safe probes. Use Advanced → Send by ID.");
    } catch (e:any) {
      console.error(e);
      const m = e?.shortMessage || e?.message || "write failed";
      if (/user rejected/i.test(m)) append("❌ Rejected in wallet.");
      else if (/insufficient funds/i.test(m)) append("❌ Not enough MON for gas.");
      else if (/chain/i.test(m)) append("❌ Wallet chain mismatch. MetaMask/OKX/Rabby recommended; Phantom may ignore chain switch.");
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

      // try 1155 first only if standard detected as 1155
      if (std === "ERC1155") {
        const tx = await writeContract(cfg, {
          abi: ERC1155_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "safeTransferFrom",
          args: [address, VAULT as `0x${string}`, id, 1n, "0x"],
          account: address, chainId: MONAD_CHAIN_ID,
        });
        append(`✅ Sent 1155 id=${id}: ${tx}`);
      } else {
        const tx = await writeContract(cfg, {
          abi: ERC721_WRITE_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "safeTransferFrom",
          args: [address, VAULT as `0x${string}`, id],
          account: address, chainId: MONAD_CHAIN_ID,
        });
        append(`✅ Sent 721 #${id}: ${tx}`);
      }
      const total = addLives(MONAD_CHAIN_ID, address, 1);
      append(`+1 life (total: ${total})`);
    } catch (e:any) {
      console.error(e);
      append(`❌ ${e?.shortMessage || e?.message || "manual write failed"}`);
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="mb-2 text-sm text-zinc-400">
        Vault: <span className="font-mono">{VAULT}</span>
      </div>
      <div className="mb-2 text-sm text-zinc-400">
        Allowed: <span className="font-mono">{ALLOWED_CONTRACT}</span>
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
