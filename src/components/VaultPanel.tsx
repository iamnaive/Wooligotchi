// src/components/VaultPanel.tsx
import React, { useMemo, useState, useEffect } from "react";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { parseAbiItem } from "viem";
import { emit } from "../utils/domEvents";

// Hardcoded (Monad testnet)
const COLLECTION_ADDRESS = "0x88c78d5852f45935324c6d100052958f694e8446" as const; // ERC-721
const RECIPIENT_ADDRESS  = "0xEb9650DDC18FF692f6224EA17f13C351A6108758" as const; // recipient

// Target chain (Monad testnet)
const TARGET_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);

// Explorer base (must be .../tx/)
function normalizeExplorerBase(raw?: string) {
  const url = (raw || "").trim().replace(/\/+$/, "");
  if (!url) return "";
  return url.endsWith("/tx") ? `${url}/` : `${url}/tx/`;
}
const EXPLORER_TX = normalizeExplorerBase(import.meta.env.VITE_EXPLORER_TX as string);

// Minimal ERC-721 ABI
const ERC721_ABI = [
  parseAbiItem("function safeTransferFrom(address from, address to, uint256 tokenId)"),
];

// utils
function normalizeTokenId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^0x[0-9a-fA-F]+$/.test(s)) return s;
  if (/^\d+$/.test(s)) return s.replace(/^0+/, "") || "0";
  return null;
}
function short(addr: string, left = 6, right = 4) {
  return `${addr.slice(0, left)}…${addr.slice(-right)}`;
}
const HashLink: React.FC<{ hash?: `0x${string}` | null }> = ({ hash }) => {
  if (!hash) return null;
  const href = EXPLORER_TX ? `${EXPLORER_TX}${hash}` : undefined;
  const text = `${hash.slice(0, 10)}…${hash.slice(-8)}`;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" style={{ color: "#9ecbff", fontSize: 12 }}>{text}</a>
  ) : (
    <code style={{ fontSize: 12, opacity: 0.85 }}>{text}</code>
  );
};
const InfoRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, alignItems: "center", marginTop: 8, fontSize: 12, opacity: 0.9 }}>
    <div style={{ color: "rgba(255,255,255,0.7)" }}>{label}</div>
    <div style={{ background: "#17171c", border: "1px solid #2b2b31", borderRadius: 12, padding: "6px 10px", color: "#fff", display: "flex", alignItems: "center", height: 32 }}>
      {children}
    </div>
  </div>
);

export default function VaultPanel() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [rawId, setRawId] = useState("");
  const tokenId = useMemo(() => normalizeTokenId(rawId), [rawId]);

  const [step, setStep] = useState<"idle" | "sending" | "sent" | "confirmed" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  const onTargetChain = chainId === TARGET_CHAIN_ID;
  const canSend = !!address && !!tokenId && onTargetChain && step !== "sending";

  useEffect(() => {
    if (receipt && step === "sent") {
      setStep("confirmed");
      emit("wg:nft-confirmed", { tokenId, txHash, chainId: TARGET_CHAIN_ID, collection: COLLECTION_ADDRESS });
    }
  }, [receipt, step, tokenId, txHash]);

  async function transfer(tid: string) {
    // Do not pass chainId here; call only when wallet is already on target chain.
    const hash = await writeContractAsync({
      address: COLLECTION_ADDRESS,
      abi: ERC721_ABI,
      functionName: "safeTransferFrom",
      args: [address!, RECIPIENT_ADDRESS, BigInt(tid)],
    });
    setTxHash(hash);
  }

  const onSend = async () => {
    setError(null);
    // Hard gate: never write on a wrong network
    if (!onTargetChain) {
      try {
        await switchChain({ chainId: TARGET_CHAIN_ID });
      } catch (e: any) {
        setStep("error");
        setError(e?.shortMessage || e?.message || "Please switch to Monad testnet");
      }
      return; // stop here; user жмёт Send ещё раз уже на нужной сети
    }
    if (!address || !tokenId) return;

    try {
      setStep("sending");
      await transfer(tokenId);
      setStep("sent");
    } catch (e: any) {
      setStep("error");
      setError(e?.shortMessage || e?.message || "Transfer failed");
    }
  };

  return (
    <div className="rounded-2xl p-5" style={{ background: "linear-gradient(180deg,#0f1117,#0b0d12)", color: "#eaeaf0", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 18px 50px rgba(0,0,0,0.55)", maxWidth: 520, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: 0.2 }}>Vault</div>
        <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
          Send 1 NFT from the allowed collection and get <b>+1 life</b>.
        </div>
      </div>

      <InfoRow label="Collection"><code style={{ opacity: 0.9 }}>{short(COLLECTION_ADDRESS)}</code></InfoRow>
      <InfoRow label="Recipient"><code style={{ opacity: 0.9 }}>{short(RECIPIENT_ADDRESS)}</code></InfoRow>

      {!onTargetChain && (
        <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(255,206,86,0.09)", border: "1px solid rgba(255,206,86,0.35)", color: "#ffce56", fontSize: 13, borderRadius: 12 }}>
          You are on the wrong network (chain {chainId}). Switch to Monad testnet (chain {TARGET_CHAIN_ID}).
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button
              onClick={() => switchChain({ chainId: TARGET_CHAIN_ID })}
              style={{ background: "linear-gradient(90deg,#7c4dff,#00c8ff)", color: "#fff", padding: "6px 10px", borderRadius: 10 }}
            >
              Switch to Monad
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <label className="text-xs opacity-80" style={{ display: "block", marginBottom: 6 }}>tokenId</label>
        <div style={{ background: "#17171c", border: "1px solid #2b2b31", borderRadius: 12, padding: "6px 10px", display: "flex", alignItems: "center" }}>
          <div style={{ background: "#222228", border: "1px solid #32323a", color: "#ddd", fontSize: 12, padding: "4px 8px", borderRadius: 8, marginRight: 8 }}>#ID</div>
          <input
            className="flex-1 outline-none text-sm"
            placeholder="e.g. 1186 or 0x4a2"
            value={rawId}
            onChange={(e) => setRawId(e.target.value)}
            spellCheck={false}
            style={{ color: "#fff", background: "transparent", border: 0, flex: 1, caretColor: "#fff" }}
          />
          <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.75, color: tokenId ? "#9fe29f" : "#ff9e9e" }}>
            {tokenId ? "ok" : "invalid"}
          </span>
        </div>
      </div>

      <button
        disabled={!address || !tokenId || step === "sending"}
        onClick={onSend}
        style={{
          width: "100%", marginTop: 14, borderRadius: 12, padding: "10px 12px",
          background: address && tokenId ? "linear-gradient(90deg,#7c4dff,#00c8ff)" : "#2a2a2f",
          color: "#fff", boxShadow: address && tokenId ? "0 8px 22px rgba(124,77,255,0.35)" : "none",
          opacity: step === "sending" ? 0.85 : 1,
        }}
        title={onTargetChain ? "" : "Switch to Monad testnet to proceed"}
      >
        {step === "sending" ? "Sending…" : "Send 1 NFT"}
      </button>

      <div style={{ marginTop: 10, fontSize: 12 }}>
        {txHash && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ opacity: 0.8 }}>Transfer tx:</span>
            <HashLink hash={txHash} />
          </div>
        )}
        {step === "sent" && !receipt && <div style={{ opacity: 0.85 }}>Waiting for confirmation…</div>}
        {step === "confirmed" && <div style={{ color: "#6adf6a" }}>Confirmed. You can continue.</div>}
        {error && <div style={{ color: "#ff6b6b" }}>{error}</div>}
      </div>

      <div style={{ marginTop: 10, fontSize: 11, opacity: 0.65 }}>
        Flow: collection.safeTransferFrom(owner, recipient, tokenId) on Monad testnet
      </div>
    </div>
  );
}
