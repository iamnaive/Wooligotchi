// src/components/SendByIdPanel.tsx
// Simple "send by tokenId" flow for ERC-721 -> Vault on Monad Testnet.
// Uses wagmi writeContract with explicit gas; no pre-scan, no extra checks.
// Comments: English only.

import React, { useMemo, useState } from "react";
import { useAccount, useChainId, useSwitchChain, useWriteContract } from "wagmi";
import { Address, parseAbi } from "viem";

const TARGET_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const COLLECTION_ADDRESS = String(import.meta.env.VITE_COLLECTION_ADDRESS || "").toLowerCase() as Address;
const VAULT_ADDRESS      = String(import.meta.env.VITE_VAULT_ADDRESS || "").toLowerCase() as Address;

const ERC721_ABI = parseAbi([
  "function safeTransferFrom(address from, address to, uint256 tokenId) external"
]);

function normalizeTokenId(raw: string): bigint | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^0x[0-9a-fA-F]+$/.test(s)) return BigInt(s);
  if (/^\d+$/.test(s)) return BigInt(s.replace(/^0+/, "") || "0");
  return null;
}

function mapError(e: any): string {
  const t = String(e?.shortMessage || e?.message || e || "").toLowerCase();
  if (e?.code === 4001 || t.includes("user rejected")) return "You rejected the transaction in wallet.";
  if (t.includes("insufficient funds")) return "Not enough MON to pay gas.";
  if (t.includes("mismatch") || t.includes("wrong network") || t.includes("chain of the wallet"))
    return "Wrong network. Switch to Monad testnet (10143).";
  if (t.includes("non erc721receiver")) return "Vault is not ERC721Receiver or wrong address.";
  if (t.includes("not token owner") || t.includes("not owner nor approved"))
    return "You are not the owner of this tokenId.";
  return e?.shortMessage || e?.message || "Failed.";
}

export default function SendByIdPanel() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [rawId, setRawId] = useState("");
  const tokenId = useMemo(() => normalizeTokenId(rawId), [rawId]);

  const [sending, setSending] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onSend() {
    setErr(null);
    setHash(null);
    if (!address) { setErr("Connect a wallet first."); return; }
    if (!COLLECTION_ADDRESS || !VAULT_ADDRESS) { setErr("Env addresses are not set."); return; }
    if (tokenId === null) { setErr("Invalid tokenId."); return; }

    // Force wallet to target chain
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
        args: [address, VAULT_ADDRESS, tokenId],
        chainId: TARGET_CHAIN_ID,
        account: address,
        gas: 120_000n, // explicit gas for Monad
      });
      setHash(tx as string);

      // Fire app-level event so your game grants a life (optional)
      try {
        window.dispatchEvent(
          new CustomEvent("wg:nft-confirmed", {
            detail: { address, collection: COLLECTION_ADDRESS, tokenId: Number(tokenId), txHash: tx, chainId: TARGET_CHAIN_ID }
          })
        );
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
        maxWidth: 520,
        margin: "0 auto",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Send NFT by ID</div>
        <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
          Collection → Vault on Monad Testnet (10143)
        </div>
      </div>

      <div>
        <label className="text-xs opacity-80" style={{ display: "block", marginBottom: 6 }}>
          tokenId
        </label>
        <div className="flex items-center rounded-xl px-3 py-2" style={{ background: "#17171c", border: "1px solid #2b2b31" }}>
          <div className="text-xs mr-2 px-2 py-1 rounded-lg" style={{ background: "#222228", border: "1px solid #32323a", color: "#ddd" }}>
            #ID
          </div>
          <input
            className="flex-1 outline-none text-sm"
            placeholder="e.g. 1186 or 0x4a2"
            value={rawId}
            onChange={(e) => setRawId(e.target.value)}
            spellCheck={false}
            style={{ color: "#fff", background: "transparent", border: 0, caretColor: "#fff" }}
          />
          <span className="text-[11px] ml-2" style={{ opacity: 0.75, color: tokenId !== null ? "#9fe29f" : "#ff9e9e" }}>
            {tokenId !== null ? "ok" : "invalid"}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 11, opacity: 0.65, marginTop: 6 }}>
          Make sure your wallet is on Monad Testnet before sending.
        </div>
      </div>

      <button
        disabled={!address || tokenId === null || sending}
        onClick={onSend}
        className="w-full rounded-xl py-3 transition"
        style={{
          marginTop: 12,
          background: !address || tokenId === null || sending ? "#2a2a2f" : "linear-gradient(90deg,#7c4dff,#00c8ff)",
          color: "#fff",
          boxShadow: !address || tokenId === null || sending ? "none" : "0 8px 22px rgba(124,77,255,0.35)",
          opacity: sending ? 0.85 : 1,
          cursor: !address || tokenId === null || sending ? "not-allowed" : "pointer",
        }}
      >
        {sending ? "Sending…" : "Send to Vault"}
      </button>

      {hash && (
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
          Tx: <code>{hash.slice(0, 12)}…{hash.slice(-10)}</code>
        </div>
      )}
      {err && <div style={{ color: "#ff6b6b", fontSize: 12, marginTop: 6 }}>{err}</div>}
    </div>
  );
}
