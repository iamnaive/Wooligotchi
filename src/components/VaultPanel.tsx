// src/components/VaultPanel.tsx
import React, { useMemo, useState, useEffect } from "react";
import {
  useAccount,
  useChainId,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { parseAbiItem } from "viem";
import { emit } from "../utils/domEvents";

// Hardcoded addresses (as requested)
const COLLECTION_ADDRESS = "0x88c78d5852f45935324c6d100052958f694e8446" as const; // ERC-721
const VAULT_ADDRESS      = "0xEb9650DDC18FF692f6224EA17f13C351A6108758" as const; // recipient

// Explorer base (optional). Prefer VITE_EXPLORER_TX that ends with /tx/
const EXPLORER_TX =
  (import.meta.env.VITE_EXPLORER_TX as string | undefined)?.trim() ||
  (
    (import.meta.env.VITE_EXPLORER_URL as string | undefined)?.trim()
      ? `${(import.meta.env.VITE_EXPLORER_URL as string).trim().replace(/\/+$/, "")}/tx/`
      : ""
  );

// Minimal ERC-721 ABI
const ERC721_ABI = [
  parseAbiItem("function approve(address to, uint256 tokenId)"),
  parseAbiItem("function safeTransferFrom(address from, address to, uint256 tokenId)"),
];

function normalizeTokenId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^0x[0-9a-fA-F]+$/.test(s)) return s;               // hex
  if (/^\d+$/.test(s)) return s.replace(/^0+/, "") || "0"; // decimal
  return null;
}

function short(addr: string, left = 6, right = 4) {
  return `${addr.slice(0, left)}…${addr.slice(-right)}`;
}

const HashLink: React.FC<{ hash?: `0x${string}` | null; label?: string }> = ({ hash, label }) => {
  if (!hash) return null;
  const text = label || `${hash.slice(0, 10)}…${hash.slice(-8)}`;
  const href = EXPLORER_TX ? `${EXPLORER_TX}${hash}` : undefined;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="text-[12px]" style={{ color: "#9ecbff" }}>
      {text}
    </a>
  ) : (
    <code style={{ fontSize: 12, opacity: 0.85 }}>{text}</code>
  );
};

const InfoRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "120px 1fr",
      gap: 8,
      alignItems: "center",
      marginTop: 8,
      fontSize: 12,
      opacity: 0.9,
    }}
  >
    <div style={{ color: "rgba(255,255,255,0.7)" }}>{label}</div>
    <div
      style={{
        background: "#17171c",
        border: "1px solid #2b2b31",
        borderRadius: 12,
        padding: "6px 10px",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        height: 32,
      }}
    >
      {children}
    </div>
  </div>
);

export default function VaultPanel() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();

  const [rawId, setRawId] = useState("");
  const tokenId = useMemo(() => normalizeTokenId(rawId), [rawId]);

  const [step, setStep] = useState<"idle" | "approving" | "approved" | "sending" | "sent" | "confirmed" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [approveHash, setApproveHash] = useState<`0x${string}` | null>(null);
  const [transferHash, setTransferHash] = useState<`0x${string}` | null>(null);

  const { data: approveReceipt } = useWaitForTransactionReceipt({ hash: approveHash });
  const { data: transferReceipt } = useWaitForTransactionReceipt({ hash: transferHash });

  const canSend = !!address && !!tokenId && step !== "approving" && step !== "sending";

  // Emit confirmation for App/Tamagotchi once transfer is confirmed
  useEffect(() => {
    if (transferReceipt && step === "sent") {
      setStep("confirmed");
      emit("wg:nft-confirmed", { tokenId, txHash: transferHash, chainId, collection: COLLECTION_ADDRESS });
    }
  }, [transferReceipt, step, tokenId, transferHash, chainId]);

  async function approve(tid: string) {
    const hash = await writeContractAsync({
      address: COLLECTION_ADDRESS,
      abi: ERC721_ABI,
      functionName: "approve",
      args: [VAULT_ADDRESS, BigInt(tid)],
    });
    setApproveHash(hash);
  }

  async function transfer(tid: string) {
    const hash = await writeContractAsync({
      address: COLLECTION_ADDRESS,
      abi: ERC721_ABI,
      functionName: "safeTransferFrom",
      args: [address!, VAULT_ADDRESS, BigInt(tid)],
    });
    setTransferHash(hash);
  }

  const onSend = async () => {
    setError(null);
    if (!canSend || !tokenId) return;

    try {
      setStep("approving");
      await approve(tokenId);
    } catch (e: any) {
      setStep("error");
      setError(e?.shortMessage || e?.message || "Approve failed");
      return;
    }

    // Give hooks time to catch the approve receipt for smoother UX
    try {
      let guard = 0;
      while (!approveReceipt && guard++ < 150) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 100)); // up to ~15s
      }
      setStep("approved");
    } catch {}

    try {
      setStep("sending");
      await transfer(tokenId);
      setStep("sent");
    } catch (e: any) {
      setStep("error");
      setError(e?.shortMessage || e?.message || "Transfer failed");
      return;
    }
  };

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
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: 0.2 }}>Vault</div>
        <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
          Send 1 NFT from the allowed collection and get <b>+1 life</b>.
        </div>
      </div>

      {/* Read-only info */}
      <InfoRow label="Collection">
        <code style={{ opacity: 0.9 }}>{short(COLLECTION_ADDRESS)}</code>
      </InfoRow>
      <InfoRow label="Recipient">
        <code style={{ opacity: 0.9 }}>{short(VAULT_ADDRESS)}</code>
      </InfoRow>

      {/* Token ID input */}
      <div style={{ marginTop: 12 }}>
        <label className="text-xs opacity-80" style={{ display: "block", marginBottom: 6 }}>
          tokenId
        </label>
        <div
          className="flex items-center rounded-xl px-3 py-2"
          style={{ background: "#17171c", border: "1px solid #2b2b31" }}
        >
          <div
            className="text-xs mr-2 px-2 py-1 rounded-lg"
            style={{ background: "#222228", border: "1px solid #32323a" }}
          >
            #ID
          </div>
          <input
            className="flex-1 bg-transparent outline-none text-sm"
            placeholder="e.g. 1186 or 0x4a2"
            value={rawId}
            onChange={(e) => setRawId(e.target.value)}
            spellCheck={false}
            style={{ color: "#fff" }}
          />
          <span className="text-[11px] ml-2" style={{ opacity: 0.75 }}>
            {tokenId ? "ok" : "invalid"}
          </span>
        </div>
      </div>

      {/* CTA */}
      <button
        disabled={!canSend}
        onClick={onSend}
        className="w-full rounded-xl py-3 transition"
        style={{
          marginTop: 14,
          background: canSend ? "linear-gradient(90deg,#7c4dff,#00c8ff)" : "#2a2a2f",
          color: "#fff",
          boxShadow: canSend ? "0 8px 22px rgba(124,77,255,0.35)" : "none",
          opacity: step === "approving" || step === "sending" ? 0.85 : 1,
        }}
      >
        {step === "approving" ? "Approving…" : step === "sending" ? "Sending…" : "Send 1 NFT"}
      </button>

      {/* Status */}
      <div className="mt-3 space-y-1 text-xs" style={{ marginTop: 10 }}>
        {approveHash && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ opacity: 0.8 }}>Approve tx:</span>
            <HashLink hash={approveHash} />
          </div>
        )}
        {transferHash && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ opacity: 0.8 }}>Transfer tx:</span>
            <HashLink hash={transferHash} />
          </div>
        )}
        {step === "sent" && !transferReceipt && (
          <div style={{ opacity: 0.85 }}>Waiting for confirmation…</div>
        )}
        {step === "confirmed" && (
          <div style={{ color: "#6adf6a" }}>Confirmed. You can continue.</div>
        )}
        {error && <div style={{ color: "#ff6b6b" }}>{error}</div>}
      </div>

      <div className="text-[11px] opacity-65" style={{ marginTop: 10 }}>
        Flow: approve(collection → recipient) → collection.safeTransferFrom(owner, recipient, tokenId)
      </div>
    </div>
  );
}
