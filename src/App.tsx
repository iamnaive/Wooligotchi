// src/components/VaultAutoPanel.tsx
// Scans tokenId 0..399 and shows NFTs owned by the connected wallet.
// Allows sending selected token(s) to the Vault via safeTransferFrom.
// Comments: English only.

import React from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWriteContract,
  useSwitchChain,
} from "wagmi";
import { Address, parseAbi } from "viem";

// ====== ENV / Constants ======
const TARGET_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const COLLECTION_ADDRESS = String(import.meta.env.VITE_COLLECTION_ADDRESS || "").toLowerCase() as Address;
const VAULT_ADDRESS      = String(import.meta.env.VITE_VAULT_ADDRESS || "").toLowerCase() as Address;

// Minimal ERC-721 ABI
const ERC721_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function safeTransferFrom(address from, address to, uint256 tokenId) external",
]);

// UI helpers
function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 12,
      padding: "2px 8px",
      borderRadius: 8,
      background: "#1e1f27",
      border: "1px solid #2a2b33",
      color: "#bfc3d7"
    }}>{children}</span>
  );
}

function ErrorText({ text }: { text: string }) {
  return <div style={{ color: "#ff6b6b", fontSize: 12, marginTop: 6 }}>{text}</div>;
}

function mapError(e: any): string {
  const t = String(e?.shortMessage || e?.message || e || "").toLowerCase();
  if (e?.code === 4001 || t.includes("user rejected")) return "You rejected the transaction in wallet.";
  if (t.includes("insufficient funds")) return "Not enough MON to pay gas.";
  if (t.includes("mismatch") || t.includes("wrong network") || t.includes("chain of the wallet")) return "Wrong network. Switch to Monad testnet (10143).";
  if (t.includes("non erc721receiver")) return "Vault is not ERC721Receiver or address is wrong.";
  if (t.includes("not token owner") || t.includes("not owner nor approved")) return "You are not the owner of this tokenId.";
  return e?.shortMessage || e?.message || "Failed.";
}

export default function VaultAutoPanel() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { switchChain } = useSwitchChain();

  const { writeContractAsync } = useWriteContract();

  const [scanning, setScanning] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [owned, setOwned] = React.useState<number[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const [lastTx, setLastTx] = React.useState<string | null>(null);

  // Batch scan ownerOf for ids 0..399
  async function scanRange() {
    setErr(null);
    setOwned([]);
    if (!address) { setErr("Connect a wallet first."); return; }
    if (!publicClient) { setErr("Public client not ready."); return; }
    if (!COLLECTION_ADDRESS) { setErr("VITE_COLLECTION_ADDRESS is empty."); return; }

    setScanning(true);
    setProgress(0);

    const START = 0, END = 399;
    const BATCH = 40;
    const hits: number[] = [];

    for (let from = START; from <= END; from += BATCH) {
      const to = Math.min(from + BATCH - 1, END);
      const tasks = [];
      for (let id = from; id <= to; id++) {
        tasks.push(
          publicClient.readContract({
            address: COLLECTION_ADDRESS,
            abi: ERC721_ABI,
            functionName: "ownerOf",
            args: [BigInt(id)],
          })
          .then((owner) => ({ id, owner: (owner as Address).toLowerCase(), ok: true }))
          .catch(() => ({ id, owner: "0x0000000000000000000000000000000000000000", ok: false }))
        );
      }

      const res = await Promise.allSettled(tasks);
      for (const r of res) {
        if (r.status === "fulfilled" && r.value.ok) {
          if ((r.value.owner) === address.toLowerCase()) hits.push(r.value.id);
        }
      }
      setProgress(Math.round(((Math.min(to, END) - START + 1) / (END - START + 1)) * 100));
    }

    setOwned(hits);
    setScanning(false);
  }

  async function sendOne(tokenId: number) {
    setErr(null);
    setLastTx(null);
    if (!address) { setErr("Connect a wallet first."); return; }
    if (chainId !== TARGET_CHAIN_ID) {
      try { await switchChain({ chainId: TARGET_CHAIN_ID }); }
      catch { setErr("Wrong network. Switch to Monad testnet (10143)."); return; }
    }

    try {
      setSending(true);
      const tx = await writeContractAsync({
        address: COLLECTION_ADDRESS,
        abi: ERC721_ABI,
        functionName: "safeTransferFrom",
        args: [address, VAULT_ADDRESS, BigInt(tokenId)],
        chainId: TARGET_CHAIN_ID,
        account: address,
        // Monad: explicit gas to avoid overpay by gas_limit charging
        gas: 120_000n,
      });
      setLastTx(tx as string);
      // Remove from list optimistically
      setOwned((prev) => prev.filter((x) => x !== tokenId));
      // Fire app-level event so your game grants a life
      try {
        window.dispatchEvent(new CustomEvent("wg:nft-confirmed", {
          detail: { address, collection: COLLECTION_ADDRESS, tokenId, txHash: tx, chainId: TARGET_CHAIN_ID }
        }));
      } catch {}
    } catch (e: any) {
      setErr(mapError(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: "linear-gradient(180deg,#0f1117,#0b0d12)",
        color: "#eaeaf0",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
        maxWidth: 620,
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Vault (Auto-parser 0..399)</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Badge>Chain: {chainId ?? "?"}</Badge>
          <Badge>Target: {TARGET_CHAIN_ID}</Badge>
        </div>
      </div>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
        Collection: <code style={{ opacity: 0.9 }}>{COLLECTION_ADDRESS || "—"}</code> · Vault: <code style={{ opacity: 0.9 }}>{VAULT_ADDRESS || "—"}</code>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={scanRange}
          disabled={scanning}
          className="btn"
          style={{
            background: scanning ? "#2a2a2f" : "linear-gradient(90deg,#7c4dff,#00c8ff)",
            color: "#fff",
            padding: "8px 12px",
            borderRadius: 10,
            cursor: scanning ? "wait" : "pointer",
          }}
        >
          {scanning ? `Scanning… ${progress}%` : "Scan owned in 0..399"}
        </button>
      </div>

      {err && <ErrorText text={err} />}

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 6 }}>
          Found owned tokenIds: {owned.length > 0 ? owned.length : 0}
        </div>
        {owned.length === 0 && !scanning && (
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Nothing found in 0..399 for this wallet. Try minting or use another range.
          </div>
        )}

        {owned.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: 10,
              marginTop: 6,
            }}
          >
            {owned.sort((a, b) => a - b).map((id) => (
              <div
                key={id}
                className="card"
                style={{
                  background: "#15161c",
                  border: "1px solid #262833",
                  borderRadius: 12,
                  padding: 10,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>#{id}</div>
                <button
                  disabled={sending}
                  onClick={() => sendOne(id)}
                  className="btn"
                  style={{
                    width: "100%",
                    background: "linear-gradient(90deg,#7c4dff,#00c8ff)",
                    color: "#fff",
                    padding: "6px 10px",
                    borderRadius: 10,
                    cursor: sending ? "wait" : "pointer",
                  }}
                >
                  {sending ? "Sending…" : "Send to Vault"}
                </button>
              </div>
            ))}
          </div>
        )}

        {lastTx && (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
            Tx: <code>{lastTx.slice(0, 12)}…{lastTx.slice(-10)}</code>
          </div>
        )}
      </div>

      <div className="text-[11px] opacity-65" style={{ marginTop: 10 }}>
        Notes: Reads use your app RPC; wallet network must be Monad (10143) to send.
      </div>
    </div>
  );
}
