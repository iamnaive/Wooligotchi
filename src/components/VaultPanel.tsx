'use client';

import { useEffect, useMemo, useState } from "react";
import { zeroAddress } from "viem";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import { readContract, writeContract, getPublicClient } from "@wagmi/core";

/** VaultPanel (multicall-safe)
 *  - Tries multicall for fast probing; if chain doesn't support it, falls back to parallel single calls.
 *  - Supports ERC-721 (incl. non-enumerable) and ERC-1155.
 *  - Manual send by ID for both standards (instant path).
 *  - Emits "wg:nft-confirmed" on success (Tamagotchi listens to it).
 *  - Public API unchanged: export default function VaultPanel({ mode = "full" | "cta" })
 */

export default function VaultPanel({ mode = "full" }: { mode?: "full" | "cta" }) {
  return <VaultPanelInner mode={mode} />;
}

/* ===== ENV / CONSTS ===== */
const MONAD_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const ALLOWED_CONTRACT = "0x88c78d5852f45935324c6d100052958f694e8446";
const VAULT = (import.meta.env.VITE_VAULT_ADDRESS as string) || zeroAddress;
const EXPLORER = (import.meta.env.VITE_EXPLORER_URL as string) || "";

/* ---- Probe tuning ---- */
const SMALL_FIRST_RANGE = 64;
const MAX_ERC721_PROBES_FAST = 500;
const MAX_ERC721_PROBES_BAL = 1800;
const MAX_ERC1155_PROBES_FAST = 256;
const MAX_ERC1155_PROBES_BAL = 800;
const DEFAULT_TOP_GUESS  = 10_000;  // you said 10k ids exist
const BATCH_SIZE         = 24;      // batch size for parallelism
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

/* ===== Lives (unchanged) ===== */
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
  const pc = useMemo(() => getPublicClient(cfg, { chainId: MONAD_CHAIN_ID }), [cfg]);
  const { address, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();

  const [std, setStd] = useState<Std>("UNKNOWN");
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<`0x${string}` | null>(null);
  const [lives, setLives] = useState(() => getLives(MONAD_CHAIN_ID, address));
  const [modeScan, setModeScan] = useState<"fast"|"balanced">("fast"); // default fast

  // Manual send inputs
  const [manualId721, setManualId721] = useState<string>("");
  const [manualId1155, setManualId1155] = useState<string>("");

  function append(s: string) { setLog((p) => (p ? p + "\n" : "") + s); }
  const canSend = isConnected && VAULT !== zeroAddress;

  useEffect(() => { if (address) setLives(getLives(MONAD_CHAIN_ID, address)); }, [address]);
  useEffect(() => {
    const onLives = () => setLives(getLives(MONAD_CHAIN_ID, address));
    window.addEventListener("wg:lives-changed", onLives as any);
    return () => window.removeEventListener("wg:lives-changed", onLives as any);
  }, [address]);

  // Detect token standard
  useEffect(() => {
    (async () => {
      try {
        setStd("UNKNOWN");
        append("Detecting token standard…");
        const [is721, is1155] = await Promise.all([
          readContract(cfg, {
            abi: ERC165_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
            functionName: "supportsInterface", args: [IFACE_ERC721 as `0x${string}`], chainId: MONAD_CHAIN_ID,
          }).catch(()=>false),
          readContract(cfg, {
            abi: ERC165_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
            functionName: "supportsInterface", args: [IFACE_ERC1155 as `0x${string}`], chainId: MONAD_CHAIN_ID,
          }).catch(()=>false),
        ]);
        if (is721) { setStd("ERC721"); append("✓ ERC-721"); }
        else if (is1155) { setStd("ERC1155"); append("✓ ERC-1155"); }
        else append("⚠️ Unknown; will try both.");
      } catch {
        append("ℹ️ Standard detection failed; fallback enabled.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===== utils ===== */
  const sleep = (ms:number)=>new Promise(r=>setTimeout(r,ms));

  function range(start: number, end: number, step = 1): number[] {
    const out: number[] = [];
    if (step > 0) for (let i = start; i <= end; i += step) out.push(i);
    else for (let i = start; i >= end; i += step) out.push(i);
    return out;
  }

  function chunk<T>(arr: T[], sz: number): T[][] {
    const res: T[][] = [];
    for (let i = 0; i < arr.length; i += sz) res.push(arr.slice(i, i + sz));
    return res;
  }

  async function supportsEnumerable(): Promise<boolean> {
    try {
      return await readContract(cfg, {
        abi: ERC165_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "supportsInterface", args: [IFACE_ERC721_ENUM as `0x${string}`],
        chainId: MONAD_CHAIN_ID,
      }) as boolean;
    } catch { return false; }
  }

  async function balance721Of(user:`0x${string}`): Promise<bigint> {
    try {
      return await readContract(cfg, {
        abi: ERC721_READ_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "balanceOf", args: [user], chainId: MONAD_CHAIN_ID,
      }) as bigint;
    } catch { return 0n; }
  }

  /* ===== probe helpers (multicall with fallback) ===== */

  async function probe721Batch(user: `0x${string}`, ids: number[]): Promise<bigint | null> {
    // Try multicall
    try {
      const res = await pc.multicall({
        allowFailure: true,
        contracts: ids.map((id) => ({
          address: ALLOWED_CONTRACT as `0x${string}`,
          abi: ERC721_READ_ABI,
          functionName: "ownerOf" as const,
          args: [BigInt(id)],
        })),
      });
      for (let i = 0; i < res.length; i++) {
        const r = res[i];
        if (r.status === "success") {
          const owner = (r.result as `0x${string}`).toLowerCase();
          if (owner === user.toLowerCase()) return BigInt(ids[i]);
        }
      }
      return null;
    } catch {
      // Fallback: parallel single calls
      const calls = ids.map((id) =>
        readContract(cfg, {
          abi: ERC721_READ_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "ownerOf", args: [BigInt(id)], chainId: MONAD_CHAIN_ID,
        })
        .then((owner) => ({ ok: true, id, owner: (owner as `0x${string}`).toLowerCase() }))
        .catch(() => ({ ok: false, id }))
      );
      const res = await Promise.allSettled(calls);
      for (const rr of res) {
        if (rr.status === "fulfilled" && (rr.value as any).ok) {
          const v = rr.value as any;
          if (v.owner === user.toLowerCase()) return BigInt(v.id);
        }
      }
      return null;
    }
  }

  async function probe1155Batch(user: `0x${string}`, ids: number[]): Promise<bigint | null> {
    // Try multicall
    try {
      const res = await pc.multicall({
        allowFailure: true,
        contracts: ids.map((id) => ({
          address: ALLOWED_CONTRACT as `0x${string}`,
          abi: ERC1155_ABI,
          functionName: "balanceOf" as const,
          args: [user, BigInt(id)],
        })),
      });
      for (let i = 0; i < res.length; i++) {
        const r = res[i];
        if (r.status === "success") {
          const bal = r.result as bigint;
          if (bal > 0n) return BigInt(ids[i]);
        }
      }
      return null;
    } catch {
      // Fallback: parallel single calls
      const calls = ids.map((id) =>
        readContract(cfg, {
          abi: ERC1155_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "balanceOf", args: [user, BigInt(id)], chainId: MONAD_CHAIN_ID,
        })
        .then((bal) => ({ ok: true, id, bal: bal as bigint }))
        .catch(() => ({ ok: false, id }))
      );
      const res = await Promise.allSettled(calls);
      for (const rr of res) {
        if (rr.status === "fulfilled" && (rr.value as any).ok) {
          const v = rr.value as any;
          if (v.bal > 0n) return BigInt(v.id);
        }
      }
      return null;
    }
  }

  /* ===== pickers ===== */

  async function pickAnyErc721(user: `0x${string}`) {
    if ((await balance721Of(user)) === 0n) return null;

    // 1) Enumerable shortcut (tokenOfOwnerByIndex)
    if (await supportsEnumerable()) {
      try {
        const id0 = await readContract(cfg, {
          abi: ERC721_READ_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "tokenOfOwnerByIndex", args: [user, 0n], chainId: MONAD_CHAIN_ID,
        }) as bigint;
        return id0;
      } catch {}
    }

    const cap = modeScan === "fast" ? MAX_ERC721_PROBES_FAST : MAX_ERC721_PROBES_BAL;
    let spent = 0;

    // 2) Front window [0..SMALL_FIRST_RANGE]
    {
      const ids = range(0, SMALL_FIRST_RANGE);
      const batches = chunk(ids, BATCH_SIZE);
      for (const b of batches) {
        const hit = await probe721Batch(user, b);
        spent += b.length;
        if (hit !== null) return hit;
        if (spent >= cap) return null;
        await sleep(0);
      }
    }

    // 3) Top-down near default top (10k)
    {
      const remain = cap - spent;
      const down = Math.max(0, Math.floor(remain * 0.6));
      if (down > 0) {
        const ids = range(DEFAULT_TOP_GUESS - 1, Math.max(0, DEFAULT_TOP_GUESS - down), -1);
        const batches = chunk(ids, BATCH_SIZE);
        for (const b of batches) {
          const hit = await probe721Batch(user, b);
          spent += b.length;
          if (hit !== null) return hit;
          if (spent >= cap) return null;
          await sleep(0);
        }
      }
    }

    // 4) Sparse stride across 0..DEFAULT_TOP_GUESS
    {
      const remain = cap - spent;
      if (remain <= 0) return null;
      const stride = Math.max(1, Math.ceil(DEFAULT_TOP_GUESS / remain));
      const picks: number[] = [];
      for (let i = 0; i <= DEFAULT_TOP_GUESS && picks.length < remain; i += stride) picks.push(i);
      const batches = chunk(picks, BATCH_SIZE);
      for (const b of batches) {
        const hit = await probe721Batch(user, b);
        spent += b.length;
        if (hit !== null) return hit;
        if (spent >= cap) return null;
        await sleep(0);
      }
    }

    return null;
  }

  async function pickAnyErc1155(user: `0x${string}`) {
    const cap = modeScan === "fast" ? MAX_ERC1155_PROBES_FAST : MAX_ERC1155_PROBES_BAL;
    let spent = 0;

    // 1) Front window
    {
      const ids = range(0, SMALL_FIRST_RANGE);
      const batches = chunk(ids, BATCH_SIZE);
      for (const b of batches) {
        const hit = await probe1155Batch(user, b);
        spent += b.length;
        if (hit !== null) return hit;
        if (spent >= cap) return null;
        await sleep(0);
      }
    }

    // 2) Powers-of-two hints
    {
      const hints: number[] = [];
      for (let v = 128; v <= 65536 && spent < cap; v *= 2) hints.push(v);
      const batches = chunk(hints, BATCH_SIZE);
      for (const b of batches) {
        const hit = await probe1155Batch(user, b);
        spent += b.length;
        if (hit !== null) return hit;
        if (spent >= cap) return null;
        await sleep(0);
      }
    }

    return null;
  }

  /* ===== send + wait receipt ===== */

  async function waitReceipt(hash: `0x${string}`) {
    try {
      const rcpt = await pc.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      return rcpt;
    } catch {
      append("⏳ Still pending… keep this panel open; it should confirm soon.");
      return null;
    }
  }

  async function sendErc721ById(idNum: number) {
    if (!isConnected || VAULT === zeroAddress || !address) return;
    setBusy(true); setLog(""); setTx(null);
    try {
      try { await switchChain({ chainId: MONAD_CHAIN_ID }); } catch {}
      const hash = await writeContract(cfg, {
        abi: ERC721_WRITE_ABI,
        address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "safeTransferFrom",
        args: [address, VAULT as `0x${string}`, BigInt(idNum)],
        account: address, chainId: MONAD_CHAIN_ID,
      });
      setTx(hash);
      append(`Tx sent: ${hash}`);
      const rcpt = await waitReceipt(hash);
      if (rcpt && rcpt.status === "success") {
        window.dispatchEvent(new CustomEvent("wg:nft-confirmed", { detail: { address } }));
        append("✓ Confirmed");
      }
    } catch (e:any) {
      append(e?.shortMessage || e?.message || "send failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendErc1155ById(idNum: number) {
    if (!isConnected || VAULT === zeroAddress || !address) return;
    setBusy(true); setLog(""); setTx(null);
    try {
      try { await switchChain({ chainId: MONAD_CHAIN_ID }); } catch {}
      const hash = await writeContract(cfg, {
        abi: ERC1155_ABI,
        address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "safeTransferFrom",
        args: [address, VAULT as `0x${string}`, BigInt(idNum), 1n, "0x"],
        account: address, chainId: MONAD_CHAIN_ID,
      });
      setTx(hash);
      append(`Tx sent: ${hash}`);
      const rcpt = await waitReceipt(hash);
      if (rcpt && rcpt.status === "success") {
        window.dispatchEvent(new CustomEvent("wg:nft-confirmed", { detail: { address } }));
        append("✓ Confirmed");
      }
    } catch (e:any) {
      append(e?.shortMessage || e?.message || "send failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendOne() {
    if (!isConnected || VAULT === zeroAddress || !address) return;
    setBusy(true); setLog(""); setTx(null);

    try {
      try { await switchChain({ chainId: MONAD_CHAIN_ID }); } catch {}

      if (std === "ERC721" || std === "UNKNOWN") {
        const id = await pickAnyErc721(address as `0x${string}`);
        if (id !== null) {
          const hash = await writeContract(cfg, {
            abi: ERC721_WRITE_ABI,
            address: ALLOWED_CONTRACT as `0x${string}`,
            functionName: "safeTransferFrom",
            args: [address, VAULT as `0x${string}`, id],
            account: address, chainId: MONAD_CHAIN_ID,
          });
          setTx(hash);
          append(`Tx sent: ${hash}`);
          const rcpt = await waitReceipt(hash);
          if (rcpt && rcpt.status === "success") {
            window.dispatchEvent(new CustomEvent("wg:nft-confirmed", { detail: { address } }));
            append("✓ Confirmed");
          }
          return;
        }
      }

      const id1155 = await pickAnyErc1155(address as `0x${string}`);
      if (id1155 !== null) {
        const hash = await writeContract(cfg, {
          abi: ERC1155_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "safeTransferFrom",
          args: [address, VAULT as `0x${string}`, id1155, 1n, "0x"],
          account: address, chainId: MONAD_CHAIN_ID,
        });
        setTx(hash);
        append(`Tx sent: ${hash}`);
        const rcpt = await waitReceipt(hash);
        if (rcpt && rcpt.status === "success") {
          window.dispatchEvent(new CustomEvent("wg:nft-confirmed", { detail: { address } }));
          append("✓ Confirmed");
        }
        return;
      }

      append("No owned NFT found in allowed collection.");
    } catch (e:any) {
      append(e?.shortMessage || e?.message || "send failed");
    } finally {
      setBusy(false);
    }
  }

  /* ===== UI ===== */

  const txLink = tx && EXPLORER ? `${EXPLORER.replace(/\/+$/, "")}/tx/${tx}` : null;

  if (mode === "cta") {
    return (
      <div style={{ display:"grid", placeItems:"center", marginTop:8 }}>
        <button className="btn btn-primary btn-lg" onClick={sendOne} disabled={!canSend || busy}>
          {busy ? "Sending…" : "1 NFT = 1 life"}
        </button>
        <div className="helper" style={{ marginTop:10 }}>
          Sends one NFT from <span className="pill">{ALLOWED_CONTRACT.slice(0,6)}…{ALLOWED_CONTRACT.slice(-4)}</span> to the vault.
        </div>
        {tx && (
          <div className="muted" style={{ marginTop: 8 }}>
            Tx: <code>{tx}</code>{txLink ? <> • <a href={txLink} target="_blank" rel="noreferrer">Open in explorer</a></> : null}
          </div>
        )}
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
        <button className={`btn ${modeScan==="fast"?"":"btn-ghost"}`} onClick={()=>setModeScan("fast")}>Fast</button>
        <button className={`btn ${modeScan==="balanced"?"":"btn-ghost"}`} onClick={()=>setModeScan("balanced")}>Balanced</button>
      </div>

      <div className="mb-3 text-lg card-title">Send 1 NFT to Vault → get 1 life</div>
      <button className="btn btn-primary" disabled={!canSend || busy} onClick={sendOne}>
        {busy ? "Sending…" : "Send automatically"}
      </button>

      {/* Manual ID lane (instant path; avoids scan) */}
      <div className="mt-3" style={{ display:"grid", gap:8, gridTemplateColumns:"1fr 1fr" }}>
        <div className="card" style={{ padding: 8 }}>
          <div className="mb-2" style={{ fontWeight: 600 }}>ERC-721: send by tokenId</div>
          <div style={{ display:"flex", gap:8 }}>
            <input className="input" type="number" placeholder="tokenId (0…9999)"
                   value={manualId721} onChange={(e)=>setManualId721(e.target.value)} />
            <button className="btn" disabled={!manualId721 || busy} onClick={()=>sendErc721ById(Number(manualId721))}>
              Send
            </button>
          </div>
        </div>
        <div className="card" style={{ padding: 8 }}>
          <div className="mb-2" style={{ fontWeight: 600 }}>ERC-1155: send by id</div>
          <div style={{ display:"flex", gap:8 }}>
            <input className="input" type="number" placeholder="id"
                   value={manualId1155} onChange={(e)=>setManualId1155(e.target.value)} />
            <button className="btn" disabled={!manualId1155 || busy} onClick={()=>sendErc1155ById(Number(manualId1155))}>
              Send
            </button>
          </div>
        </div>
      </div>

      {tx && (
        <div className="muted" style={{ marginTop: 8 }}>
          Tx: <code>{tx}</code>{txLink ? <> • <a href={txLink} target="_blank" rel="noreferrer">Open in explorer</a></> : null}
        </div>
      )}
      <div className="mt-3 log">
        <div className="mb-1" style={{fontWeight:600}}>Log</div>
        <pre>{log || "—"}</pre>
      </div>

      <div className="mt-1 text-sm">Lives: <span className="font-semibold">{lives}</span></div>
    </div>
  );
}
