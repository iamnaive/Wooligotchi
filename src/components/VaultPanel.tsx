'use client';

import { useState } from "react";
import type { Address } from "viem";
import { zeroAddress } from "viem";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import { writeContract, getPublicClient } from "@wagmi/core";

/**
 * VaultPanel (ONE-LINE, ERC-721 only)
 * - Single input for tokenId + Send button in one row.
 * - Sends ERC-721 via safeTransferFrom(owner -> VAULT).
 * - On success dispatches "wg:nft-confirmed" (game listens to it).
 * - Comments in English only.
 *
 * ENV required:
 *  - VITE_CHAIN_ID
 *  - VITE_VAULT_ADDRESS
 *
 * NOTE: Collection address kept hardcoded to avoid breaking current logic.
 *       Change ALLOWED_CONTRACT if your 721 address moves.
 */

/* ===== ENV / CONSTS ===== */
const MONAD_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const VAULT: Address = (import.meta.env.VITE_VAULT_ADDRESS as Address) ?? zeroAddress;

// Keep current collection hardcoded for compatibility
const ALLOWED_CONTRACT: Address = "0x88c78d5852f45935324c6d100052958f694e8446";

// Minimal 721 ABI (transfer only)
const ERC721_WRITE_ABI = [
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export default function VaultPanel() {
  const { address, isConnected, chainId } = useAccount();
  const cfg = useConfig();
  const pc = getPublicClient(cfg);
  const { switchChain } = useSwitchChain();

  const [idStr, setIdStr] = useState("");
  const [busy, setBusy] = useState(false);

  // Send 721 by tokenId
  async function send() {
    if (!isConnected || !address || VAULT === zeroAddress) return;
    const idNum = Number(idStr);
    if (!Number.isFinite(idNum) || idNum < 0 || idNum > 10000) return; // guard per your range

    try {
      // Ensure correct chain
      if (chainId !== MONAD_CHAIN_ID) {
        try { await switchChain({ chainId: MONAD_CHAIN_ID }); } catch { /* ignore */ }
      }

      setBusy(true);
      const { hash } = await writeContract(cfg, {
        abi: ERC721_WRITE_ABI,
        address: ALLOWED_CONTRACT,
        functionName: "safeTransferFrom",
        args: [address as Address, VAULT, BigInt(idNum)],
        account: address as Address,
        chainId: MONAD_CHAIN_ID,
      });

      // Non-blocking confirm; fire event on success when mined
      pc.waitForTransactionReceipt({ hash, confirmations: 0, timeout: 45_000 })
        .then((rcpt) => {
          if (rcpt && rcpt.status === "success") {
            window.dispatchEvent(new CustomEvent("wg:nft-confirmed"));
          }
        })
        .catch(() => { /* optional: swallow */ })
        .finally(() => setBusy(false));

      // Optional UX: clear input immediately
      setIdStr("");
    } catch {
      setBusy(false);
    }
  }

  const disabled = !isConnected || VAULT === zeroAddress || busy;

  // One line: [input][button]
  return (
    <div className="w-full flex items-center gap-2">
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="NFT id (0..10000)"
        value={idStr}
        onChange={(e) => setIdStr(e.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={(e) => { if (e.key === "Enter" && !disabled) send(); }}
        className="px-3 py-2 rounded-xl bg-black/30 border border-white/10 w-full"
      />
      <button
        disabled={disabled || idStr.length === 0}
        onClick={send}
        className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 disabled:opacity-50"
        title="Send 1 NFT → get 1 life"
      >
        Send
      </button>
    </div>
  );
}
