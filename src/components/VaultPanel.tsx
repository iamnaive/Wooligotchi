'use client';

import { useEffect, useState } from "react";
import { zeroAddress } from "viem";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import { readContract, writeContract, getPublicClient } from "@wagmi/core";

/** Component props */
export default function VaultPanel({ mode = "full" }: { mode?: "full" | "cta" }) {
  return <VaultPanelInner mode={mode} />;
}

/* ===== ENV / CONSTS ===== */
const MONAD_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const ALLOWED_CONTRACT = "0x88c78d5852f45935324c6d100052958f694e8446";
const VAULT = (import.meta.env.VITE_VAULT_ADDRESS as string) || zeroAddress;

/* ---- Probe tuning ---- */
const SMALL_FIRST_RANGE = 64;
const MAX_ERC721_PROBES = 400;
const MAX_ERC1155_PROBES = 400;
const DEFAULT_TOP_GUESS  = 10_000;
const BATCH_SIZE         = 24;
const YIELD_EVERY        = 6;

/* ===== ABIs ===== */
const ERC165_ABI = [
  { type: "function", name: "supportsInterface", stateMutability: "view",
    inputs: [{ name: "interfaceId", type: "bytes4" }], outputs: [{ type: "bool" }] },
] as const;
const IFACE_ERC721      = "0x80ac58cd";
const IFACE_ERC1155     = "0xD9B67A26";
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

/* ===== Small local helpers (for showing lives in this panel) ===== */
const LIVES_KEY = "wg_lives_v1";
const livesKey = (cid:number, addr:string)=>`${cid}:${addr.toLowerCase()}`;
const getLives = (cid:number, addr?:string|null) => {
  if (!addr) return 0;
  const raw = localStorage.getItem(LIVES_KEY);
  const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  return map[livesKey(cid, addr)] ?? 0;
};

type Std = "ERC721" | "ERC1155" | "UNKNOWN";

function VaultPanelInner({ mode }: { mode: "full" | "cta" }) {
  const cfg = useConfig();
  const { address, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();

  const [std, setStd] = useState<Std>("UNKNOWN");
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [lives, setLives] = useState(() => getLives(MONAD_CHAIN_ID, address));
  const [modeScan, setModeScan] = useState<"balanced"|"fast">("balanced");

  function append(s: string) { setLog((p) => (p ? p + "\n" : "") + s); }
  const canSend = isConnected && VAULT !== zeroAddress;

  useEffect(() => { if (address) setLives(getLives(MONAD_CHAIN_ID, address)); }, [address]);
  useEffect(() => {
    const onLives = () => setLives(getLives(MONAD_CHAIN_ID, address));
    window.addEventListener("wg:lives-changed", onLives as any);
    return () => window.removeEventListener("wg:lives-changed", onLives as any);
  }, [address]);

  useEffect(() => {
    (async () => {
      try {
        setStd("UNKNOWN");
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
      } catch { append("ℹ️ Standard detection failed; fallback enabled."); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function probe721Batch(user: `0x${string}`, ids: number[]) {
    const res = await Promise.allSettled(ids.map((id)=>ownerOfSafe(id)));
    for (let i = 0; i < res.length; i++) {
      const v = res[i];
      if (v.status === "fulfilled" && v.value && v.value.toLowerCase() === user.toLowerCase()) {
        return BigInt(ids[i]);
      }
    }
    return null;
  }
  async function probe1155Batch(user: `0x${string}`, ids: number[]) {
    const res = await Promise.allSettled(ids.map((id)=>balance1155Safe(user, id)));
    for (let i = 0; i < res.length; i++) {
      const v = res[i];
      if (v.status === "fulfilled" && v.value && v.value > 0n) {
        return BigInt(ids[i]);
      }
    }
    return null;
  }

  async function tryEnumerableFirst(user: `0x${string}`) {
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

  async function pickAnyErc721(user: `0x${string}`) {
    if ((await balance721Of(user)) === 0n) return null;

    const idEnum = await tryEnumerableFirst(user);
    if (idEnum !== null) return idEnum;

    let probes = 0;
    {
      const batches = chunkify(0, SMALL_FIRST_RANGE);
      for (let b = 0; b < batches.length; b++) {
        const hit = await probe721Batch(user, batches[b]);
        probes += batches[b].length;
        if (hit !== null) return hit;
        if (b % YIELD_EVERY === 0) await sleep(0);
        if (probes >= MAX_ERC721_PROBES || modeScan === "fast") break;
      }
    }
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

  async function pickAnyErc1155(user: `0x${string}`) {
    let probes = 0;
    {
      const batches = chunkify(0, SMALL_FIRST_RANGE);
      for (let b = 0; b < batches.length; b++) {
        const hit = await probe1155Batch(user, batches[b]);
        probes += batches[b].length;
        if (hit !== null) return hit;
        if (b % YIELD_EVERY === 0) await sleep(0);
        if (probes >= MAX_ERC1155_PROBES || modeScan === "fast") break;
      }
    }
    const hints: number[] = []; for (let v = 128; v <= 65536; v *= 2) hints.push(v);
    {
      const batches: number[][] = [];
      for (let i = 0; i < hints.length; i += BATCH_SIZE) batches.push(hints.slice(i, i + BATCH_SIZE));
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

  /* ---------- Send & notify app ---------- */
  async function sendOne() {
    if (!isConnected || VAULT === zeroAddress || !address) return;
    setBusy(true); setLog("");

    try {
      try { await switchChain({ chainId: MONAD_CHAIN_ID }); } catch {}

      if (std === "ERC721" || std === "UNKNOWN") {
        const id = await pickAnyErc721(address as `0x${string}`);
        if (id !== null) {
          const txHash = await writeContract(cfg, {
            abi: ERC721_WRITE_ABI,
            address: ALLOWED_CONTRACT as `0x${string}`,
            functionName: "safeTransferFrom",
            args: [address, VAULT as `0x${string}`, id],
            account: address, chainId: MONAD_CHAIN_ID,
          });
          const pc = getPublicClient(cfg, { chainId: MONAD_CHAIN_ID });
          const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
          if (receipt.status === "success") {
            // сообщаем приложению — начисляйте жизнь
            window.dispatchEvent(new CustomEvent("wg:nft-confirmed", { detail: { address } }));
          }
          setBusy(false);
          return;
        }
      }

      const id1155 = await pickAnyErc1155(address as `0x${string}`);
      if (id1155 !== null) {
        const txHash = await writeContract(cfg, {
          abi: ERC1155_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "safeTransferFrom",
          args: [address, VAULT as `0x${string}`, id1155, 1n, "0x"],
          account: address, chainId: MONAD_CHAIN_ID,
        });
        const pc = getPublicClient(cfg, { chainId: MONAD_CHAIN_ID });
        const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status === "success") {
          window.dispatchEvent(new CustomEvent("wg:nft-confirmed", { detail: { address } }));
        }
        setBusy(false);
        return;
      }

      setLog("No owned NFT found in allowed collection.");
    } catch (e:any) {
      console.error(e);
      setLog(e?.shortMessage || e?.message || "send failed");
      setBusy(false);
    }
  }

  /* ---------- UI ---------- */
  if (mode === "cta") {
    return (
      <div style={{ display:"grid", placeItems:"center", marginTop:8 }}>
        <button className="btn btn-primary btn-lg" onClick={sendOne} disabled={!canSend || busy}>
          {busy ? "Sending…" : "1 NFT = 1 life"}
        </button>
        <div className="helper" style={{ marginTop:10 }}>
          Sends one NFT from <span className="pill">{ALLOWED_CONTRACT.slice(0,6)}…{ALLOWED_CONTRACT.slice(-4)}</span> to the vault.
        </div>
        {log && <div className="log" style={{marginTop:12}}><pre>{log}</pre></div>}
      </div>
    );
  }

  return (
    <div className="mx-auto mt-6 max-w-3xl rounded-2xl card">
      <div className="mb-2 text-sm muted">
        Vault: <span className="font-mono">{VAULT}</span>
      </div>
      <div className="mb-2 text-sm muted">
        Allowed: <span className="font-mono">{ALLOWED_CONTRACT}</span>
      </div>
      <div className="mb-2 text-xs muted" style={{display:"flex", gap:8, alignItems:"center"}}>
        <span>Scan mode:</span>
        <button className={`btn ${modeScan==="balanced"?"":"btn-ghost"}`} onClick={()=>setModeScan("balanced")}>Balanced</button>
        <button className={`btn ${modeScan==="fast"?"":"btn-ghost"}`} onClick={()=>setModeScan("fast")}>Fast</button>
      </div>

      <div className="mb-3 text-lg card-title">Send 1 NFT to Vault → get 1 life</div>
      <button className="btn btn-primary" disabled={!canSend || busy} onClick={sendOne}>
        {busy ? "Sending…" : "Send automatically"}
      </button>

      <div className="mt-3 log">
        <div className="mb-1" style={{fontWeight:600}}>Log</div>
        <pre>{log || "—"}</pre>
      </div>

      <div className="mt-1 text-sm">Lives: <span className="font-semibold">{lives}</span></div>
    </div>
  );
}
