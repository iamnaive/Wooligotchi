// src/components/VaultPanel.tsx
import React, { useMemo, useState, useEffect } from "react";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { defineChain, parseAbiItem } from "viem";
import { emit } from "../utils/domEvents";

/* ===== Constants (Monad testnet) ===== */
// Allowed ERC-721 collection
const COLLECTION_ADDRESS = "0x88c78d5852f45935324c6d100052958f694e8446" as const;
// Recipient (vault)
const RECIPIENT_ADDRESS  = "0xEb9650DDC18FF692f6224EA17f13C351A6108758" as const;

// Target chain
const TARGET_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const RPC_URL = String(import.meta.env.VITE_RPC_URL || "https://testnet-rpc.monad.xyz");

// viem chain (hint for wallets; dApp reads can use this too)
const MONAD = defineChain({
  id: TARGET_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  testnet: true,
});

// Minimal ERC-721 ABI
const ERC721_ABI = [
  parseAbiItem("function safeTransferFrom(address from, address to, uint256 tokenId)"),
];

/* ===== Helpers ===== */
function normalizeTokenId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^0x[0-9a-fA-F]+$/.test(s)) return s;
  if (/^\d+$/.test(s)) return s.replace(/^0+/, "") || "0";
  return null;
}
function mapError(e: any): string {
  const t = String(e?.shortMessage || e?.message || e || "").toLowerCase();
  if (e?.code === 4001 || t.includes("user rejected")) return "You rejected the transaction in wallet.";
  if (t.includes("insufficient funds")) return "Not enough MON to pay gas.";
  if (t.includes("chain") && t.includes("mismatch")) return "Wrong network. Switch to Monad testnet (10143).";
  if (t.includes("http request failed") || t.includes("network")) return "Network/RPC error in wallet.";
  return e?.shortMessage || e?.message || "Transfer failed.";
}

/* ===== Component ===== */
export default function VaultPanel() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const { writeContractAsync, data: pendingHash } = useWriteContract();
  const [rawId, setRawId] = useState("");
  const tokenId = useMemo(() => normalizeTokenId(rawId), [rawId]);

  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [step, setStep] = useState<"idle" | "sending" | "sent" | "confirmed" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  const { data: receipt } = useWaitForTransactionReceipt({ hash });

  const onTarget = chainId === TARGET_CHAIN_ID;
  const canSend = !!address && !!tokenId && onTarget && step !== "sending";

  useEffect(() => {
    if (pendingHash && !hash) setHash(pendingHash as `0x${string}`);
  }, [pendingHash, hash]);

  useEffect(() => {
    if (receipt && step === "sent") {
      setStep("confirmed");
      emit("wg:nft-confirmed", {
        tokenId,
        txHash: hash,
        chainId: TARGET_CHAIN_ID,
        collection: COLLECTION_ADDRESS,
      });
    }
  }, [receipt, step, tokenId, hash]);

  async function onSend() {
    setErr(null);
    if (!address || !tokenId) return;
    if (!onTarget) return;

    try {
      setStep("sending");
      // direct write via wallet; wallet uses its own RPC and gas estimation
      const tx = await writeContractAsync({
        address: COLLECTION_ADDRESS,
        abi: ERC721_ABI,
        functionName: "safeTransferFrom",
        args: [address, RECIPIENT_ADDRESS, BigInt(tokenId)],
        chainId: TARGET_CHAIN_ID, // hint
        account: address,         // signer
      });
      setHash(tx as `0x${string}`);
      setStep("sent");
    } catch (e: any) {
      setStep("error");
      setErr(mapError(e));
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
        <div style={{ fontWeight: 800, fontSize: 18 }}>Vault</div>
        <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
          Send 1 NFT → get <b>+1 life</b>
        </div>
      </div>

      {/* tokenId only */}
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
          <span className="text-[11px] ml-2" style={{ opacity: 0.75, color: tokenId ? "#9fe29f" : "#ff9e9e" }}>
            {tokenId ? "ok" : "invalid"}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 11, opacity: 0.65, marginTop: 6 }}>
          From the allowed collection → to the vault on Monad testnet.
        </div>
      </div>

      {/* network guard */}
      {!onTarget && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            background: "rgba(255,206,86,0.09)",
            border: "1px solid rgba(255,206,86,0.35)",
            color: "#ffce56",
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          Wrong network (chain {chainId ?? "?"}). Switch to Monad testnet (chain {TARGET_CHAIN_ID}).
          <div style={{ marginTop: 8 }}>
            <button
              className="btn"
              onClick={() => switchChain({ chainId: TARGET_CHAIN_ID })}
              style={{ background: "linear-gradient(90deg,#7c4dff,#00c8ff)", color: "#fff", padding: "6px 10px", borderRadius: 10 }}
            >
              Switch to Monad
            </button>
          </div>
        </div>
      )}

      <button
        disabled={!canSend}
        onClick={onSend}
        className="w-full rounded-xl py-3 transition"
        style={{
          marginTop: 12,
          background: canSend ? "linear-gradient(90deg,#7c4dff,#00c8ff)" : "#2a2a2f",
          color: "#fff",
          boxShadow: canSend ? "0 8px 22px rgba(124,77,255,0.35)" : "none",
          opacity: step === "sending" ? 0.85 : 1,
          cursor: canSend ? "pointer" : "not-allowed",
        }}
      >
        {step === "sending" ? "Sending…" : "Send 1 NFT"}
      </button>

      <div style={{ marginTop: 10, fontSize: 12 }}>
        {hash && <div style={{ opacity: 0.85 }}>Tx hash: <code style={{ opacity: 0.9 }}>{hash.slice(0,10)}…{hash.slice(-8)}</code></div>}
        {step === "sent" && !receipt && <div style={{ opacity: 0.85 }}>Waiting for confirmation…</div>}
        {step === "confirmed" && <div style={{ color: "#6adf6a" }}>Confirmed. You can continue.</div>}
        {err && <div style={{ color: "#ff6b6b" }}>{err}</div>}
      </div>

      <div className="text-[11px] opacity-65" style={{ marginTop: 8 }}>
        Flow: ERC721.safeTransferFrom(owner → vault, tokenId) on Monad testnet
      </div>
    </div>
  );
}
