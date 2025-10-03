'use client';

import { useEffect, useMemo, useState } from "react";
import { zeroAddress } from "viem";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import { readContract, writeContract, getPublicClient } from "@wagmi/core";

/** VaultPanel (ID-less path for ERC-721 Enumerable)
 * - No indexer. No scanning. Minimal RPC calls.
 * - If collection supports ERC721Enumerable, grab tokenId via tokenOfOwnerByIndex(owner, 0)
 *   and send it to VAULT in one click (no ID input).
 * - Fallback: manual send by tokenId (ERC-721) or by id (ERC-1155).
 * - Emits "wg:nft-confirmed" on success (the game listens to it).
 * - Public API unchanged: <VaultPanel mode="full" | "cta" />
 */

export default function VaultPanel({ mode = "full" }: { mode?: "full" | "cta" }) {
  return <VaultPanelInner mode={mode} />;
}

/* ===== ENV / CONSTS ===== */
const MONAD_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const ALLOWED_CONTRACT = "0x88c78d5852f45935324c6d100052958f694e8446"; // your collection
const VAULT = (import.meta.env.VITE_VAULT_ADDRESS as string) || zeroAddress;
const EXPLORER = (import.meta.env.VITE_EXPLORER_URL as string | undefined) || "";

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

function VaultPanelInner({ mode }: { mode: "full" | "cta" }) {
  const cfg = useConfig();
  const pc = useMemo(() => getPublicClient(cfg, { chainId: MONAD_CHAIN_ID }), [cfg]);
  const { address, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();

  const [std, setStd] = useState<Std>("UNKNOWN");
  const [enumSupported, setEnumSupported] = useState<boolean | null>(null);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<`0x${string}` | null>(null);
  const [lives, setLives] = useState(() => getLives(MONAD_CHAIN_ID, address));

  // manual inputs
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

  // Detect token standards and enumerable support (only 2 cheap calls)
  useEffect(() => {
    (async () => {
      try {
        const [is721, is1155, isEnum] = await Promise.all([
          readContract(cfg, {
            abi: ERC165_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
            functionName: "supportsInterface", args: [IFACE_ERC721 as `0x${string}`], chainId: MONAD_CHAIN_ID,
          }).catch(()=>false),
          readContract(cfg, {
            abi: ERC165_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
            functionName: "supportsInterface", args: [IFACE_ERC1155 as `0x${string}`], chainId: MONAD_CHAIN_ID,
          }).catch(()=>false),
          readContract(cfg, {
            abi: ERC165_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
            functionName: "supportsInterface", args: [IFACE_ERC721_ENUM as `0x${string}`], chainId: MONAD_CHAIN_ID,
          }).catch(()=>false),
        ]);
        if (is721) setStd("ERC721");
        else if (is1155) setStd("ERC1155");
        else setStd("UNKNOWN");
        setEnumSupported(Boolean(is721 && isEnum));
      } catch {
        setStd("UNKNOWN");
        setEnumSupported(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ALLOWED_CONTRACT]);

  /* ===== Utils ===== */
  async function waitReceipt(hash: `0x${string}`) {
    try {
      // Non-blocking: 0 confirmations, short timeout — feel faster
      const rcpt = await pc.waitForTransactionReceipt({ hash, confirmations: 0, timeout: 45_000 });
      return rcpt;
    } catch {
      append("⏳ Still pending… you can keep playing; it should confirm shortly.");
      return null;
    }
  }
  function onSuccess(addr?: string) {
    window.dispatchEvent(new CustomEvent("wg:nft-confirmed", { detail: { address: addr || address } }));
  }

  /* ===== ID-less path (ERC-721 Enumerable) ===== */
  async function sendEnumerableFirst() {
    if (!isConnected || VAULT === zeroAddress || !address) return;
    setBusy(true); setLog(""); setTx(null);

    try {
      try { await switchChain({ chainId: MONAD_CHAIN_ID }); } catch {}

      // 1) Must be ERC-721 and support Enumerable
      if (std !== "ERC721" || !enumSupported) {
        append("This collection is not ERC-721 Enumerable. Use 'ERC-721: send by tokenId'.");
        setBusy(false);
        return;
      }

      // 2) Quick check: do you own anything?
      const bal = await readContract(cfg, {
        abi: ERC721_READ_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "balanceOf", args: [address as `0x${string}`], chainId: MONAD_CHAIN_ID,
      }) as bigint;

      if (bal === 0n) {
        append("No owned token in this collection.");
        setBusy(false);
        return;
      }

      // 3) Get the first token id
      const id0 = await readContract(cfg, {
        abi: ERC721_READ_ABI, address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "tokenOfOwnerByIndex",
        args: [address as `0x${string}`, 0n],
        chainId: MONAD_CHAIN_ID,
      }) as bigint;

      // 4) Transfer it
      const hash = await writeContract(cfg, {
        abi: ERC721_WRITE_ABI,
        address: ALLOWED_CONTRACT as `0x${string}`,
        functionName: "safeTransferFrom",
        args: [address, VAULT as `0x${string}`, id0],
        account: address, chainId: MONAD_CHAIN_ID,
      });
      setTx(hash);
      setBusy(false);

      waitReceipt(hash).then((rcpt) => {
        if (rcpt && rcpt.status === "success") onSuccess(address);
      });
    } catch (e:any) {
      setBusy(false);
      append(e?.shortMessage || e?.message || "send failed");
    }
  }

  /* ===== Manual paths ===== */
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
      setBusy(false);
      waitReceipt(hash).then((rcpt) => {
        if (rcpt && rcpt.status === "success") onSuccess(address);
      });
    } catch (e:any) {
      setBusy(false);
      append(e?.shortMessage || e?.message || "send failed");
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
      setBusy(false);
      waitReceipt(hash).then((rcpt) => {
        if (rcpt && rcpt.status === "success") onSuccess(address);
      });
    } catch (e:any) {
      setBusy(false);
      append(e?.shortMessage || e?.message || "send failed");
    }
  }

  /* ===== UI ===== */
  const txLink = tx && EXPLORER ? `${EXPLORER.replace(/\/+$/, "")}/tx/${tx}` : null;

  if (mode === "cta") {
    return (
      <div style={{ display:"grid", placeItems:"center", marginTop:8 }}>
        <button className="btn btn-primary btn-lg" onClick={sendEnumerableFirst} disabled={!canSend || busy}>
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

      <div className="mb-2 text-xs muted">
        Standard: <b>{std}</b>{' '}
        {std === "ERC721" && (
          <>• Enumerable: <b>{enumSupported === null ? "—" : enumSupported ? "yes" : "no"}</b></>
        )}
      </div>

      <div className="mb-3 text-lg card-title">Send 1 NFT to Vault → get 1 life</div>

      {/* ID-less path for ERC-721 Enumerable */}
      <button className="btn btn-primary" disabled={!canSend || busy} onClick={sendEnumerableFirst}>
        {busy ? "Sending…" : "Send automatically (ERC-721 enumerable)"}
      </button>

      {/* Manual lanes */}
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
