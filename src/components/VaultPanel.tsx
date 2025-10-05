import React, { useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { isAddress, parseAbiItem } from "viem";
import { emit } from "../utils/domEvents";

const ENV_VAULT_ADDRESS = (import.meta.env.VITE_VAULT_ADDRESS || "").trim();
const ENV_COLLECTION_ADDRESS = (import.meta.env.VITE_COLLECTION_ADDRESS || "").trim();
const VAULT_FN = (import.meta.env.VITE_VAULT_FN || "deposit").trim(); // "" => режим direct transfer
const EXPLORER_TX = (import.meta.env.VITE_EXPLORER_TX || "").trim();


const ERC721_ABI = [
  parseAbiItem("function approve(address to, uint256 tokenId)"),
  parseAbiItem("function safeTransferFrom(address from, address to, uint256 tokenId)"),
];


const VAULT_ABI = [
  parseAbiItem("function deposit(address collection, uint256 tokenId)"),
];

function normalizeTokenId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^0x[0-9a-fA-F]+$/.test(s)) return s;      // hex ok
  if (/^\d+$/.test(s)) return s.replace(/^0+/, "") || "0"; // dec ok
  return null;
}

export default function VaultPanel() {
  const chainId = useChainId();
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  // UI state
  const [collectionAddr, setCollectionAddr] = useState<string>(
    isAddress(ENV_COLLECTION_ADDRESS as `0x${string}`) ? ENV_COLLECTION_ADDRESS : ""
  );
  const [vaultAddr, setVaultAddr] = useState<string>(
    (VAULT_FN ? ENV_VAULT_ADDRESS : ENV_VAULT_ADDRESS) 
  );

  const [rawId, setRawId] = useState("");
  const tokenId = useMemo(() => normalizeTokenId(rawId), [rawId]);

  const [step, setStep] = useState<
    "idle" | "approving" | "approved" | "sending" | "sent" | "confirmed" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [approveHash, setApproveHash] = useState<`0x${string}` | null>(null);
  const [actionHash, setActionHash] = useState<`0x${string}` | null>(null);

  const { data: approveReceipt } = useWaitForTransactionReceipt({ hash: approveHash });
  const { data: actionReceipt } = useWaitForTransactionReceipt({ hash: actionHash });

  // Валидность адресов
  const collectionOK = isAddress(collectionAddr as `0x${string}`);
  const vaultOK = VAULT_FN
    ? isAddress(vaultAddr as `0x${string}`) // ваулт обязателен в режиме deposit
    : isAddress(vaultAddr as `0x${string}`) || true; // в direct-режиме vaultAddr тоже нужен как получатель; можно оставить из ENV или ввести

  const canSend =
    !!address &&
    !!tokenId &&
    collectionOK &&
    vaultOK &&
    step !== "approving" &&
    step !== "sending";

  // по финальному receipt — эмитим событие для App/Tamagotchi
  React.useEffect(() => {
    if (actionReceipt && step === "sent") {
      setStep("confirmed");
      emit("wg:nft-confirmed", { tokenId, txHash: actionHash, chainId, collection: collectionAddr });
    }
  }, [actionReceipt, step, tokenId, actionHash, chainId, collectionAddr]);

  async function approveIfNeeded(tid: string) {
    const hash = await writeContractAsync({
      address: collectionAddr as `0x${string}`,
      abi: ERC721_ABI,
      functionName: "approve",
      args: [vaultAddr as `0x${string}`, BigInt(tid)],
    });
    setApproveHash(hash);
  }

  async function doVaultDeposit(tid: string) {
    const hash = await writeContractAsync({
      address: vaultAddr as `0x${string}`,
      abi: VAULT_ABI,
      functionName: (VAULT_FN || "deposit") as "deposit",
      args: [collectionAddr as `0x${string}`, BigInt(tid)],
    });
    setActionHash(hash);
  }

  async function doDirectTransfer(tid: string) {
    // Прямой перевод NFT на адрес ваулта/получателя
    const hash = await writeContractAsync({
      address: collectionAddr as `0x${string}`,
      abi: ERC721_ABI,
      functionName: "safeTransferFrom",
      args: [address as `0x${string}`, (vaultAddr || ENV_VAULT_ADDRESS) as `0x${string}`, BigInt(tid)],
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

    // Дождёмся хотя бы несколько секунд (хуки тоже подтянут receipt)
    try {
      let guard = 0;
      while (!approveReceipt && guard++ < 200) {
        // ~ до 20s
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 100));
      }
      setStep("approved");
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

  // ===== UI =====
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: "linear-gradient(180deg,#111216,#0c0d10)",
        color: "#e9e9ee",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
        maxWidth: 560,
        margin: "0 auto",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: 0.2 }}>Vault</div>
        <div className="muted" style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
          Send 1 NFT to {VAULT_FN ? "vault (deposit)" : "recipient (direct transfer)"} and get <b>+1 life</b>.
        </div>
      </div>

      {/* COLLECTION ADDRESS */}
      <div style={{ marginTop: 10 }}>
        <label className="text-xs opacity-80" style={{ display: "block", marginBottom: 6 }}>
          Collection address (ERC-721)
        </label>
        <div
          className="flex items-center rounded-xl px-3 py-2"
          style={{ background: "#17171c", border: "1px solid #2b2b31" }}
        >
          <input
            className="flex-1 bg-transparent outline-none text-sm"
            placeholder="0x… (ERC-721 contract)"
            value={collectionAddr}
            onChange={(e) => setCollectionAddr(e.target.value.trim())}
            spellCheck={false}
            style={{ color: "#fff" }}
          />
          <span className="text-[11px] ml-2" style={{ opacity: 0.75 }}>
            {collectionOK ? "ok" : "invalid"}
          </span>
        </div>
        {!collectionOK && (
          <div style={{ color: "#ff6b6b", fontSize: 12, marginTop: 6 }}>
            Please enter a valid ERC-721 contract address.
          </div>
        )}
      </div>

      {/* VAULT / RECIPIENT ADDRESS (редактируемо на всякий случай) */}
      <div style={{ marginTop: 10 }}>
        <label className="text-xs opacity-80" style={{ display: "block", marginBottom: 6 }}>
          {VAULT_FN ? "Vault address" : "Recipient address"}
        </label>
        <div
          className="flex items-center rounded-xl px-3 py-2"
          style={{ background: "#17171c", border: "1px solid #2b2b31" }}
        >
          <input
            className="flex-1 bg-transparent outline-none text-sm"
            placeholder="0x…"
            value={vaultAddr}
            onChange={(e) => setVaultAddr(e.target.value.trim())}
            spellCheck={false}
            style={{ color: "#fff" }}
          />
          <span className="text-[11px] ml-2" style={{ opacity: 0.75 }}>
            {vaultOK ? "ok" : "invalid"}
          </span>
        </div>
        {!vaultOK && (
          <div style={{ color: "#ff6b6b", fontSize: 12, marginTop: 6 }}>
            Please enter a valid {VAULT_FN ? "vault" : "recipient"} address.
          </div>
        )}
      </div>

      {/* TOKEN ID */}
      <div style={{ marginTop: 10 }}>
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
          opacity: step === "approving" || step === "sending" ? 0.8 : 1,
        }}
      >
        {step === "approving" ? "Approving…" : step === "sending" ? "Sending…" : "Send 1 NFT"}
      </button>

      {/* STATUS */}
      <div className="mt-3 space-y-1 text-xs" style={{ marginTop: 10 }}>
        {approveHash && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ opacity: 0.8 }}>Approve tx:</span>
            <HashLink hash={approveHash} />
          </div>
        )}
        {actionHash && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ opacity: 0.8 }}>{VAULT_FN ? "Deposit tx:" : "Transfer tx:"}</span>
            <HashLink hash={actionHash} />
          </div>
        )}
        {step === "sent" && !actionReceipt && (
          <div style={{ opacity: 0.85 }}>Waiting for confirmation…</div>
        )}
        {step === "confirmed" && (
          <div style={{ color: "#6adf6a" }}>Confirmed. You can continue.</div>
        )}
        {error && <div style={{ color: "#ff6b6b" }}>{error}</div>}
      </div>

      {/* Legend */}
      <div className="text-[11px] opacity-65" style={{ marginTop: 10 }}>
        {VAULT_FN
          ? "Flow: approve(collection → vault) → vault.deposit(collection, tokenId)"
          : "Flow: approve(collection → recipient) → collection.safeTransferFrom(owner, recipient, tokenId)"}
      </div>
    </div>
  );
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
