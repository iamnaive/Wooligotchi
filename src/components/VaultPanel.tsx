import React, { useMemo, useState } from "react";
import { useAccount, useChainId, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { encodeFunctionData, isAddress, parseAbiItem } from "viem";
import { emit } from "../utils/domEvents";

/**
 * ENV:
 *  - VITE_VAULT_ADDRESS: string (required)
 *  - VITE_COLLECTION_ADDRESS: string (required)
 *  - VITE_VAULT_FN: string ("deposit" by default; leave empty to use safeTransferFrom instead of vault)
 *  - VITE_EXPLORER_TX: string (optional, e.g. "https://testnet.monadscan.io/tx/")
 */

const VAULT_ADDRESS = (import.meta.env.VITE_VAULT_ADDRESS || "").toLowerCase();
const COLLECTION_ADDRESS = (import.meta.env.VITE_COLLECTION_ADDRESS || "").toLowerCase();
const VAULT_FN = (import.meta.env.VITE_VAULT_FN || "deposit").trim(); // set "" to use safeTransferFrom
const EXPLORER_TX = (import.meta.env.VITE_EXPLORER_TX || "").trim();

// Minimal ERC721 ABI (approve, getApproved, isApprovedForAll, ownerOf, safeTransferFrom)
const ERC721_ABI = [
  parseAbiItem("function approve(address to, uint256 tokenId)"),
  parseAbiItem("function getApproved(uint256 tokenId) view returns (address)"),
  parseAbiItem("function isApprovedForAll(address owner, address operator) view returns (bool)"),
  parseAbiItem("function ownerOf(uint256 tokenId) view returns (address)"),
  parseAbiItem("function safeTransferFrom(address from, address to, uint256 tokenId)"),
];

// Generic vault ABI: deposit(address collection, uint256 tokenId)
// If your method signature differs, set VITE_VAULT_FN accordingly and adapt args below.
const VAULT_ABI = [
  parseAbiItem("function deposit(address collection, uint256 tokenId)"),
];

function normalizeTokenId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^0x[0-9a-fA-F]+$/.test(s)) return s;
  if (/^\d+$/.test(s)) return s.replace(/^0+/, "") || "0";
  return null;
}

export default function VaultPanel() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();

  const [rawId, setRawId] = useState("");
  const tokenId = useMemo(() => normalizeTokenId(rawId), [rawId]);

  const [step, setStep] = useState<"idle" | "approving" | "approved" | "sending" | "sent" | "confirmed" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [approveHash, setApproveHash] = useState<`0x${string}` | null>(null);
  const [actionHash, setActionHash] = useState<`0x${string}` | null>(null);

  const { data: approveReceipt } = useWaitForTransactionReceipt({ hash: approveHash });
  const { data: actionReceipt } = useWaitForTransactionReceipt({ hash: actionHash });

  const canSend = !!address && !!tokenId && isAddress(VAULT_ADDRESS) && isAddress(COLLECTION_ADDRESS) && step !== "approving" && step !== "sending";

  // When final receipt arrives -> emit confirmed
  React.useEffect(() => {
    if (actionReceipt && step === "sent") {
      setStep("confirmed");
      emit("wg:nft-confirmed", { tokenId, txHash: actionHash, chainId });
    }
  }, [actionReceipt, step, tokenId, actionHash, chainId]);

  // Basic validation
  const configError = React.useMemo(() => {
    if (!isAddress(VAULT_ADDRESS as `0x${string}`)) return "Invalid VITE_VAULT_ADDRESS";
    if (!isAddress(COLLECTION_ADDRESS as `0x${string}`)) return "Invalid VITE_COLLECTION_ADDRESS";
    return null;
  }, []);

  async function approveIfNeeded(tid: string) {
    // Simple unconditional approve (id-based). For gas saving you could check getApproved first.
    const hash = await writeContractAsync({
      address: COLLECTION_ADDRESS as `0x${string}`,
      abi: ERC721_ABI,
      functionName: "approve",
      args: [VAULT_ADDRESS as `0x${string}`, BigInt(tid)],
    });
    setApproveHash(hash);
  }

  async function doVaultDeposit(tid: string) {
    // Call the vault method. Default signature: deposit(address,uint256)
    const hash = await writeContractAsync({
      address: VAULT_ADDRESS as `0x${string}`,
      abi: VAULT_ABI,
      functionName: VAULT_FN as "deposit",
      args: [COLLECTION_ADDRESS as `0x${string}`, BigInt(tid)],
    });
    setActionHash(hash);
  }

  async function doDirectTransfer(tid: string) {
    // Fallback mode: directly safeTransferFrom(owner -> vault)
    const hash = await writeContractAsync({
      address: COLLECTION_ADDRESS as `0x${string}`,
      abi: ERC721_ABI,
      functionName: "safeTransferFrom",
      args: [address as `0x${string}`, VAULT_ADDRESS as `0x${string}`, BigInt(tid)],
    });
    setActionHash(hash);
  }

  const onSend = async () => {
    setError(null);
    if (!canSend || !tokenId) return;
    try {
      setStep("approving");
      await approveIfNeeded(tokenId);
    } catch (e: any) {
      setStep("error");
      setError(e?.shortMessage || e?.message || "Approve failed");
      return;
    }

    // Wait approve receipt (UI-friendly)
    try {
      // quick wait until approveReceipt arrives via hook
      // Not strictly necessary to await here; UX is better if we show linear steps.
      let guard = 0;
      while (!approveReceipt && guard++ < 300) {
        // ~ up to 30s
        // small delay
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch {}

    try {
      setStep("sending");
      if (VAULT_FN) {
        await doVaultDeposit(tokenId);
      } else {
        await doDirectTransfer(tokenId);
      }
      setStep("sent");
    } catch (e: any) {
      setStep("error");
      setError(e?.shortMessage || e?.message || "Transaction failed");
      return;
    }
  };

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

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "linear-gradient(180deg,#141416,#111113)",
        color: "#e8e8ea",
        border: "1px solid #2a2a2e",
        boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
      }}
    >
      <div className="font-semibold mb-2">Vault</div>
      <div className="text-sm opacity-85 mb-3">
        Send 1 NFT to {VAULT_FN ? "vault (deposit)" : "vault (direct transfer)"} and get +1 life.
      </div>

      {/* Config warnings */}
      {configError && (
        <div className="text-xs mb-3" style={{ color: "#ff6b6b" }}>
          {configError}
        </div>
      )}

      <label className="text-xs opacity-80">tokenId</label>
      <div
        className="flex items-center rounded-xl mt-1 mb-3 px-3 py-2"
        style={{ background: "#1b1b1f", border: "1px solid #2e2e33" }}
      >
        <div
          className="text-xs mr-2 px-2 py-1 rounded-lg"
          style={{ background: "#242428", border: "1px solid #36363a" }}
        >
          #ID
        </div>
        <input
          className="flex-1 bg-transparent outline-none text-sm"
          placeholder="e.g. 12345 or 0xABC..."
          value={rawId}
          onChange={(e) => setRawId(e.target.value)}
          spellCheck={false}
        />
        <span className="text-[11px] opacity-70 ml-2">{tokenId ? "ok" : "invalid"}</span>
      </div>

      <button
        disabled={!canSend || !!configError}
        className="w-full rounded-xl py-2.5 transition"
        style={{
          background: canSend && !configError ? "#3b3b3f" : "#26262a",
          color: "#fff",
          opacity: step === "approving" || step === "sending" ? 0.7 : 1,
        }}
        onClick={onSend}
      >
        {step === "approving" ? "Approving..." : step === "sending" ? "Sending..." : "Send 1 NFT"}
      </button>

      {/* Status area */}
      <div className="mt-3 space-y-1 text-xs">
        {approveHash && (
          <div>
            Approve tx: <HashLink hash={approveHash} />
          </div>
        )}
        {actionHash && (
          <div>
            {VAULT_FN ? "Deposit tx:" : "Transfer tx:"} <HashLink hash={actionHash} />
          </div>
        )}
        {step === "sent" && !actionReceipt && <div className="opacity-80">Waiting for confirmation…</div>}
        {step === "confirmed" && <div style={{ color: "#6adf6a" }}>Confirmed. You can continue.</div>}
        {error && <div style={{ color: "#ff6b6b" }}>{error}</div>}
      </div>

      {/* Tiny legend */}
      <div className="text-[11px] opacity-65 mt-3">
        {VAULT_FN
          ? "Flow: approve(collection → vault) → vault.deposit(collection, tokenId)"
          : "Flow: approve(collection → vault) → collection.safeTransferFrom(owner, vault, tokenId)"}
      </div>
    </div>
  );
}
