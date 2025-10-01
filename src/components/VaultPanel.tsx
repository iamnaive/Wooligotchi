// VaultPanel.tsx
// Transfer user's NFT to our VAULT address and grant 1 life per NFT.
// Comments in English only.

'use client';

import { useState } from "react";
import { isAddress, zeroAddress } from "viem";
import { useAccount, useChainId } from "wagmi";
import { readContract, simulateContract, writeContract } from "@wagmi/core";
import { wagmiConfigLike } from "../wagmiConfigLike";
import { ERC721_ABI } from "../abi/erc721";
import { ERC1155_ABI } from "../abi/erc1155";
import { addLives, getLives } from "../utils/livesStore";

type Std = "ERC721" | "ERC1155";

const VAULT = (import.meta.env.VITE_VAULT_ADDRESS as string) || zeroAddress;

export default function VaultPanel() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const [std, setStd] = useState<Std>("ERC721");
  const [contract, setContract] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [amount, setAmount] = useState("1"); // for 1155
  const [log, setLog] = useState("");
  const [lives, setLives] = useState<number>(() => getLives(chainId ?? 0, address));

  function append(s: string) {
    setLog((p) => (p ? p + "\n" : "") + s);
  }

  const valid = isAddress(contract) && isAddress(VAULT) && !!address;

  async function ensureApproval721() {
    if (!address) return false;
    const isAll = await readContract(wagmiConfigLike, {
      abi: ERC721_ABI,
      address: contract as `0x${string}`,
      functionName: "isApprovedForAll",
      args: [address, VAULT as `0x${string}`],
    });
    if (isAll) return true;

    append("Requesting setApprovalForAll for VAULT...");
    const sim = await simulateContract(wagmiConfigLike, {
      abi: ERC721_ABI,
      address: contract as `0x${string}`,
      functionName: "setApprovalForAll",
      args: [VAULT as `0x${string}`, true],
      account: address,
      chainId,
    });
    const tx = await writeContract(wagmiConfigLike, sim.request);
    append(`Approval tx sent: ${tx}`);
    return true;
  }

  async function ensureApproval1155() {
    if (!address) return false;
    const isAll = await readContract(wagmiConfigLike, {
      abi: ERC1155_ABI,
      address: contract as `0x${string}`,
      functionName: "isApprovedForAll",
      args: [address, VAULT as `0x${string}`],
    });
    if (isAll) return true;

    append("Requesting setApprovalForAll for VAULT (1155)...");
    const sim = await simulateContract(wagmiConfigLike, {
      abi: ERC1155_ABI,
      address: contract as `0x${string}`,
      functionName: "setApprovalForAll",
      args: [VAULT as `0x${string}`, true],
      account: address,
      chainId,
    });
    const tx = await writeContract(wagmiConfigLike, sim.request);
    append(`Approval tx sent: ${tx}`);
    return true;
  }

  async function sendToVault721() {
    if (!address) return;
    await ensureApproval721();

    const id = BigInt(tokenId);
    append(`Transferring token #${id} to VAULT...`);

    const sim = await simulateContract(wagmiConfigLike, {
      abi: ERC721_ABI,
      address: contract as `0x${string}`,
      functionName: "safeTransferFrom",
      args: [address, VAULT as `0x${string}`, id],
      account: address,
      chainId,
    });

    const hash = await writeContract(wagmiConfigLike, sim.request);
    append(`✅ Sent: ${hash}`);

    // Grant 1 life locally
    const total = addLives(chainId, address, 1);
    setLives(total);
    append(`🎁 Granted 1 life. Total lives: ${total}`);
  }

  async function sendToVault1155() {
    if (!address) return;
    await ensureApproval1155();

    const id = BigInt(tokenId);
    const qty = BigInt(amount);
    append(`Transferring ${qty} of id #${id} to VAULT...`);

    const sim = await simulateContract(wagmiConfigLike, {
      abi: ERC1155_ABI,
      address: contract as `0x${string}`,
      functionName: "safeTransferFrom",
      args: [address, VAULT as `0x${string}`, id, qty, "0x"],
      account: address,
      chainId,
    });

    const hash = await writeContract(wagmiConfigLike, sim.request);
    append(`✅ Sent: ${hash}`);

    // 1 life per NFT item moved (you can change this rule later)
    const total = addLives(chainId, address, Number(qty));
    setLives(total);
    append(`🎁 Granted +${qty} lives. Total lives: ${total}`);
  }

  return (
    <div className="mx-auto mt-6 max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="mb-2 text-sm text-zinc-400">
        Vault: <span className="font-mono">{VAULT}</span>
      </div>

      <div className="mb-3 text-lg font-semibold">Send NFT to Vault → get lives</div>
      <div className="mb-3 text-sm text-zinc-400">Rule: 1 NFT = 1 life</div>

      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <select className="rounded-lg bg-zinc-900 px-3 py-2 text-sm" value={std} onChange={(e) => setStd(e.target.value as Std)}>
            <option>ERC721</option>
            <option>ERC1155</option>
          </select>

          <input
            className="flex-1 rounded-lg bg-zinc-900 px-3 py-2 text-sm"
            placeholder="Contract 0x..."
            value={contract}
            onChange={(e) => setContract(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg bg-zinc-900 px-3 py-2 text-sm"
            placeholder="Token ID"
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value)}
          />
          {std === "ERC1155" && (
            <input
              className="w-40 rounded-lg bg-zinc-900 px-3 py-2 text-sm"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </div>

        {std === "ERC721" ? (
          <button
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
            disabled={!isConnected || !valid || !tokenId}
            onClick={sendToVault721}
          >
            Send 721 to Vault
          </button>
        ) : (
          <button
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
            disabled={!isConnected || !valid || !tokenId || !amount}
            onClick={sendToVault1155}
          >
            Send 1155 to Vault
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
