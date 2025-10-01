// src/components/VaultPanel.tsx
// Accept ONLY from the allowed contract; transfer to VAULT; +1 life per NFT.
// Uses the same wagmi config as your Provider via useConfig().
// Comments in English only.

'use client';

import { useEffect, useState } from "react";
import { zeroAddress } from "viem";
import { useAccount, useChainId, useConfig } from "wagmi";
import { readContract, simulateContract, writeContract } from "@wagmi/core";
import { ERC721_ABI } from "../abi/erc721";
import { ERC1155_ABI } from "../abi/erc1155";
import { ERC165_ABI, IFACE_ERC1155, IFACE_ERC721 } from "../abi/erc165";
import { addLives, getLives } from "../utils/livesStore";

type Std = "ERC721" | "ERC1155" | "UNKNOWN";

// Hard-locked allowed NFT contract (Monad testnet)
const ALLOWED_CONTRACT = "0x88c78d5852f45935324c6d100052958f694e8446";
// Vault address (must be able to receive NFTs)
const VAULT = (import.meta.env.VITE_VAULT_ADDRESS as string) || zeroAddress;

export default function VaultPanel() {
  const cfg = useConfig(); // <-- use the same config as WagmiProvider
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const [std, setStd] = useState<Std>("UNKNOWN");
  const [tokenId, setTokenId] = useState("");
  const [amount, setAmount] = useState("1"); // for 1155
  const [log, setLog] = useState("");
  const [lives, setLives] = useState<number>(() => getLives(chainId ?? 0, address));

  function append(s: string) {
    setLog((p) => (p ? p + "\n" : "") + s);
  }

  // Auto-detect standard with ERC-165 using the same config
  useEffect(() => {
    (async () => {
      try {
        setStd("UNKNOWN");
        setLog("");
        append("Detecting token standard via ERC-165...");
        const is721 = await readContract(cfg, {
          abi: ERC165_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "supportsInterface",
          args: [IFACE_ERC721 as `0x${string}`],
        });
        if (is721) {
          setStd("ERC721");
          append("✓ Detected ERC-721");
          return;
        }
        const is1155 = await readContract(cfg, {
          abi: ERC165_ABI,
          address: ALLOWED_CONTRACT as `0x${string}`,
          functionName: "supportsInterface",
          args: [IFACE_ERC1155 as `0x${string}`],
        });
        if (is1155) {
          setStd("ERC1155");
          append("✓ Detected ERC-1155");
          return;
        }
        append("⚠️ Unknown standard (neither 721 nor 1155); fallback enabled.");
      } catch (e) {
        append("ℹ️ ERC-165 detection failed; you can still try transfer.");
        console.error(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId]);

  const canSend = isConnected && VAULT !== zeroAddress && tokenId.trim().length > 0;

  async function send721() {
    if (!address) return;
    const id = BigInt(tokenId);
    append(`Transferring ERC-721 #${id} → VAULT...`);

    // Use the same config; include account so wallet client is used
    const sim = await simulateContract(cfg, {
      abi: ERC721_ABI,
      address: ALLOWED_CONTRACT as `0x${string}`,
      functionName: "safeTransferFrom",
      args: [address, VAULT as `0x${string}`, id],
      account: address,
      chainId,
    });

    const txHash = await writeContract(cfg, sim.request);
    append(`✅ Sent: ${txHash}`);

    const total = addLives(chainId, address, 1);
    setLives(total);
    append(`🎁 Granted 1 life. Total lives: ${total}`);
  }

  async function send1155() {
    if (!address) return;
    const id = BigInt(tokenId);
    const qty = BigInt(amount || "1");
    append(`Transferring ERC-1155 id=${id} x${qty} → VAULT...`);

    const sim = await simulateContract(cfg, {
      abi: ERC1155_ABI,
      address: ALLOWED_CONTRACT as `0x${string}`,
      functionName: "safeTransferFrom",
      args: [address, VAULT as `0x${string}`, id, qty, "0x"],
      account: address,
      chainId,
    });

    const txHash = await writeContract(cfg, sim.request);
    append(`✅ Sent: ${txHash}`);

    const total = addLives(chainId, address, Number(qty));
    setLives(total);
    append(`🎁 Granted +${qty} lives. Total lives: ${total}`);
  }

  async function sendUnknownTry721Then1155() {
    try {
      await send721();
    } catch (e1) {
      append("ERC-721 path failed; trying ERC-1155...");
      try {
        await send1155();
      } catch (e2) {
        append("❌ Both paths failed. Check token ID and contract.");
        console.error(e1, e2);
      }
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="mb-2 text-sm text-zinc-400">
        Vault: <span className="font-mono">{VAULT}</span>
      </div>
      <div className="mb-2 text-sm text-zinc-400">
        Allowed contract: <span className="font-mono">{ALLOWED_CONTRACT}</span>
      </div>

      <div className="mb-3 text-lg font-semibold">Send NFT to Vault → get lives</div>
      <div className="mb-3 text-sm text-zinc-400">Rule: 1 NFT = 1 life</div>

      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg bg-zinc-900 px-3 py-2 text-sm"
            placeholder="Token ID"
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value)}
          />
          {std !== "ERC721" && (
            <input
              className="w-40 rounded-lg bg-zinc-900 px-3 py-2 text-sm"
              placeholder="Amount (for 1155)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </div>

        {std === "ERC721" && (
          <button
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
            disabled={!canSend}
            onClick={send721}
          >
            Send 721 to Vault
          </button>
        )}

        {std === "ERC1155" && (
          <button
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
            disabled={!canSend || !amount}
            onClick={send1155}
          >
            Send 1155 to Vault
          </button>
        )}

        {std === "UNKNOWN" && (
          <button
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
            disabled={!canSend}
            onClick={sendUnknownTry721Then1155}
          >
            Try Transfer (detect failed)
          </button>
        )}

        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
          <div className="mb-1 font-medium">Log</div>
          <pre className="whitespace-pre-wrap break-all">{log || "—"}</pre>
        </div>

        <div className="mt-1 text-sm">
          Lives: <span className="font-semibold">{lives}</span>
        </div>
      </div>
    </div>
  );
}
