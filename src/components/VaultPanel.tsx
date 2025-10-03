'use client';

import { useEffect, useMemo, useState } from "react";
import { zeroAddress } from "viem";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import { readContract, writeContract, getPublicClient } from "@wagmi/core";

/** VaultPanel (instant lookup via BlockVision + safe on-chain fallback)
 * - Instant indexer-first: fetch owned NFTs from BlockVision (key-in-URL).
 * - Fallback: light on-chain probe (no multicall dependency; works on Monad testnet).
 * - Manual send by ID for both ERC-721 and ERC-1155.
 * - Emits "wg:nft-confirmed" on success (your game listens to it).
 * - Public API unchanged: export default function VaultPanel({ mode = "full" | "cta" }).
 */

export default function VaultPanel({ mode = "full" }: { mode?: "full" | "cta" }) {
  return <VaultPanelInner mode={mode} />;
}

/* ===== ENV / CONSTS ===== */
const MONAD_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const ALLOWED_CONTRACT = "0x88c78d5852f45935324c6d100052958f694e8446"; // allowed collection
const VAULT = (import.meta.env.VITE_VAULT_ADDRESS as string) || zeroAddress;

// BlockVision (key-in-URL) base; example: https://monad-testnet.blockvision.org/v1/<KEY>
const BV_HTTP = (import.meta.env.VITE_BV_HTTP as string | undefined)?.replace(/\/+$/, "") || "";

// Optional explorer for tx links
const EXPLORER = (import.meta.env.VITE_EXPLORER_URL as string | undefined) || "";

/* ---- Probe tuning (fallback only; indexer is primary) ---- */
const DEFAULT_TOP_GUESS = 10_000; // you said there are 10k ids
const BATCH_SIZE = 24;            // parallel calls per batch
const YIELD_EVERY = 6;            // cooperative yielding cadence

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
type IndexedToken = { standard: "ERC721" | "ERC1155"; tokenId: bigint };

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

  // Manual send inputs
  const [manualId721, setManualId721] = useState<string>("");
  const [manualId1155, setManualId1155] = useState<string>("");

  // Cached list from indexer
  const [indexed, setIndexed] = useState<IndexedToken[] | null>(null);

  function append(s: string) { setLog((p) => (p ? p + "\n" : "") + s); }
  const canSend = isConnected && VAULT !== zeroAddress;

  useEffect(() => { if (address) setLives(getLives(MONAD_CHAIN_ID, address)); }, [address]);
  useEffect(() => {
    const onLives = () => setLives(getLives(MONAD_CHAIN_ID, address));
    window.addEventListener("wg:lives-changed", onLives as any);
    return () => window.removeEventListener("wg:lives-changed", onLives as any);
  }, [address]);

  // Detect token standard (cheap, parallel)
  useEffect(() => {
    (async () => {
      try {
        setStd("UNKNOWN");
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
        if (is721) setStd("ERC721");
        else if (is1155) setStd("ERC1155");
        else setStd("UNKNOWN");
      } catch { setStd("UNKNOWN"); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ALLOWED_CONTRACT]);

  /* ===== Instant lookup via BlockVision (key-in-URL) ===== */
  async function fetchFromBlockvision(addr: string): Promise<IndexedToken[] | null> {
    if (!BV_HTTP) return null;

    // BlockVision: GET /account/nfts?address=0x..&pageIndex=1&verified=false&unknown=true
    const buildUrl = (pageIndex:number) =>
      `${BV_HTTP}/account/nfts?address=${addr}&pageIndex=${pageIndex}&verified=false&unknown=true`;

    const out: IndexedToken[] = [];
    let page = 1;
    let guard = 10; // safety for pagination loops

    while (guard-- > 0) {
      const r = await fetch(buildUrl(page), { headers: { accept: "application/json" } });
      if (!r.ok) break;
      const j: any = await r.json();

      const cols = j?.result?.data;
      if (!Array.isArray(cols)) break;

      for (const col of cols) {
        const ca = String(col?.contractAddress || "").toLowerCase();
        const std = String(col?.ercStandard || "").toUpperCase(); // "ERC721" | "ERC1155"
        if (ca !== ALLOWED_CONTRACT.toLowerCase()) continue;
        const items = Array.isArray(col?.items) ? col.items : [];
        for (const it of items) {
          const idRaw = it?.tokenId ?? it?.token_id ?? it?.id;
          if (idRaw == null) continue;
          try {
            out.push({ standard: (std === "ERC1155" ? "ERC1155" : "ERC721"), tokenId: BigInt(String(idRaw)) });
          } catch {}
        }
      }

      const next = j?.result?.nextPageIndex;
      if (!next || next === page) break;
      const n = Number(next);
      if (!Number.isFinite(n) || n < 1) break;
      page = n;
    }

    return out;
  }

  // Load index on address change
  useEffect(() => {
    (async () => {
      if (!address) { setIndexed(null); return; }
      const list = await fetchFromBlockvision(address);
      if (list) setIndexed(list);
    })();
  }, [address]);

  /* ===== On-chain fallback (only if index is empty/unset) ===== */
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
  async function probe721Batch(user: `0x${string}`, ids: number[]): Promise<bigint | null> {
    // Parallel single calls (no multicall on this chain)
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
  async function pickAnyErc721(user: `0x${string}`) {
    if ((await balance721Of(user)) === 0n) return null;

    // Enumerable shortcut, if available
    if (await supportsEnumerable()) {
      try {
        const id0 = await readContract(cfg, {
          abi: ERC721_READ_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "tokenOfOwnerByIndex", args: [user, 0n], chainId: MONAD_CHAIN_ID,
        }) as bigint;
        return id0;
      } catch {}
    }

    // Modest scan budget (indexer is primary)
    const cap = 1200;
    let spent = 0;

    // 0..128
    {
      const ids = range(0, 128);
      const batches = chunk(ids, BATCH_SIZE);
      for (const b of batches) {
        const hit = await probe721Batch(user, b);
        spent += b.length; if (hit !== null) return hit;
        if (spent >= cap) return null; await sleep(0);
      }
    }
    // top-down near 10k
    {
      const remain = cap - spent;
      const down = Math.max(0, Math.floor(remain * 0.6));
      const ids = range(DEFAULT_TOP_GUESS - 1, Math.max(0, DEFAULT_TOP_GUESS - down), -1);
      const batches = chunk(ids, BATCH_SIZE);
      for (const b of batches) {
        const hit = await probe721Batch(user, b);
        spent += b.length; if (hit !== null) return hit;
        if (spent >= cap) return null; await sleep(0);
      }
    }
    // sparse stride
    {
      const remain = cap - spent;
      if (remain <= 0) return null;
      const stride = Math.max(1, Math.ceil(DEFAULT_TOP_GUESS / remain));
      const picks: number[] = [];
      for (let i = 0; i <= DEFAULT_TOP_GUESS && picks.length < remain; i += stride) picks.push(i);
      const batches = chunk(picks, BATCH_SIZE);
      for (const b of batches) {
        const hit = await probe721Batch(user, b);
        spent += b.length; if (hit !== null) return hit;
        if (spent >= cap) return null; await sleep(0);
      }
    }
    return null;
  }
  async function pickAnyErc1155(_user: `0x${string}`) {
    // We rely on indexer for 1155. Manual send by ID is available.
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
      const rcpt = await waitReceipt(hash);
      if (rcpt && rcpt.status === "success") {
        window.dispatchEvent(new CustomEvent("wg:nft-confirmed", { detail: { address } }));
      }
    } catch (e:any) {
      append(e?.shortMessage || e?.message || "send failed");
    } finally { setBusy(false); }
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
      const rcpt = await waitReceipt(hash);
      if (rcpt && rcpt.status === "success") {
        window.dispatchEvent(new CustomEvent("wg:nft-confirmed", { detail: { address } }));
      }
    } catch (e:any) {
      append(e?.shortMessage || e?.message || "send failed");
    } finally { setBusy(false); }
  }

  /* ===== main flow: indexer-first, then fallback ===== */
  async function sendOne() {
    if (!isConnected || VAULT === zeroAddress || !address) return;
    setBusy(true); setLog(""); setTx(null);

    try {
      try { await switchChain({ chainId: MONAD_CHAIN_ID }); } catch {}

      // 1) Indexer-first (instant)
      let list = indexed;
      if (!list) list = await fetchFromBlockvision(address);
      if (list && list.length) {
        // prefer an ERC-721 first, then ERC-1155
        const pick = list.find(t => t.standard === "ERC721") ?? list.find(t => t.standard === "ERC1155");
        if (pick) {
          if (pick.standard === "ERC721") {
            const hash = await writeContract(cfg, {
              abi: ERC721_WRITE_ABI,
              address: ALLOWED_CONTRACT as `0x${string}`,
              functionName: "safeTransferFrom",
              args: [address, VAULT as `0x${string}`, pick.tokenId],
              account: address, chainId: MONAD_CHAIN_ID,
            });
            setTx(hash);
            const rcpt = await waitReceipt(hash);
            if (rcpt && rcpt.status === "success") {
              window.dispatchEvent(new CustomEvent("wg:nft-confirmed", { detail: { address } }));
            }
            setBusy(false); return;
          } else {
            const hash = await writeContract(cfg, {
              abi: ERC1155_ABI,
              address: ALLOWED_CONTRACT as `0x${string}`,
              functionName: "safeTransferFrom",
              args: [address, VAULT as `0x${string}`, pick.tokenId, 1n, "0x"],
              account: address, chainId: MONAD_CHAIN_ID,
            });
            setTx(hash);
            const rcpt = await waitReceipt(hash);
            if (rcpt && rcpt.status === "success") {
              window.dispatchEvent(new CustomEvent("wg:nft-confirmed", { detail: { address } }));
            }
            setBusy(false); return;
          }
        }
      }

      // 2) Fallback: quick on-chain pick for ERC-721
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
        const rcpt = await waitReceipt(hash);
        if (rcpt && rcpt.status === "success") {
          window.dispatchEvent(new CustomEvent("wg:nft-confirmed", { detail: { address } }));
        }
        setBusy(false); return;
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

      {BV_HTTP ? (
        <div className="mb-2 text-xs muted">
          Indexer: <span className="font-mono">{BV_HTTP}/account/nfts</span> (instant lookup)
        </div>
      ) : (
        <div className="mb-2 text-xs" style={{ color: "#ffb86b" }}>
          No BlockVision endpoint (VITE_BV_HTTP). Falling back to on-chain probe.
        </div>
      )}

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

      {/* Optional: show what indexer returned (for quick debugging) */}
      {indexed && (
        <div className="mt-3 text-xs">
          Indexed: {indexed.length
            ? indexed.map(t => `${t.standard}:${t.tokenId.toString()}`).join(", ")
            : "none"}
        </div>
      )}

      <div className="mt-1 text-sm">Lives: <span className="font-semibold">{lives}</span></div>
    </div>
  );
}
