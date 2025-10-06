// src/components/VaultPanel.tsx
import React, { useMemo, useState, useEffect } from "react";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
  usePublicClient,
} from "wagmi";
import { defineChain, parseAbi, Address } from "viem";

// ===== Monad chain / ENV =====
const TARGET_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const RPC_HTTP = String(import.meta.env.VITE_RPC_URL || "https://testnet-rpc.monad.xyz");
const RPC_WSS = String(import.meta.env.VITE_RPC_WSS || "wss://testnet-rpc.monad.xyz/ws");
const EXPLORER = "https://testnet.monadexplorer.com/";

const COLLECTION_ADDRESS = String(import.meta.env.VITE_COLLECTION_ADDRESS || "").toLowerCase() as Address;
const RECIPIENT_ADDRESS  = String(import.meta.env.VITE_VAULT_ADDRESS || "").toLowerCase() as Address;

const MONAD = defineChain({
  id: TARGET_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_HTTP], webSocket: [RPC_WSS] } },
  blockExplorers: { default: { name: "Monad Explorer", url: EXPLORER } },
  testnet: true,
});

// ===== Minimal ERC721 =====
const ERC721_ABI = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function safeTransferFrom(address from, address to, uint256 tokenId) external",
]);

// ===== Utils =====
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
  if (t.includes("mismatch") || t.includes("wrong network") || t.includes("chain of the wallet")) return "Wrong network. Switch to Monad testnet (10143).";
  if (t.includes("network") || t.includes("http request failed") || t.includes("socket")) return "Network/RPC error. Check your wallet RPC.";
  if (t.includes("not token owner") || t.includes("not owner nor approved")) return "You are not the owner of this tokenId.";
  if (t.includes("non erc721receiver")) return "Vault is not ERC721Receiver or address is wrong.";
  return e?.shortMessage || e?.message || "Transfer failed.";
}

// ===== Hard switch helpers for Phantom (EIP-3085/3326) =====
async function forceSwitchMonad() {
  const provider = (window as any).ethereum;
  if (!provider?.request) throw new Error("No EVM provider found");

  const hexId = "0x279f"; // 10143
  try {
    // Try simple switch first
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexId }],
    });
    return;
  } catch (err: any) {
    // If chain is unknown (4902) — add it
    if (err?.code === 4902 || String(err?.message || "").toLowerCase().includes("unrecognized chain id")) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hexId,
          chainName: "Monad Testnet",
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          rpcUrls: [RPC_HTTP],
          blockExplorerUrls: [EXPLORER],
        }],
      });
      // After add, try switching again
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexId }],
      });
      return;
    }
    throw err;
  }
}

export default function VaultPanel() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient();

  const { writeContractAsync, data: pendingHash } = useWriteContract();

  const [rawId, setRawId] = useState("");
  const tokenId = useMemo(() => normalizeTokenId(rawId), [rawId]);

  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [step, setStep] = useState<"idle" | "checking" | "switching" | "sending" | "sent" | "confirmed" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  const { data: receipt } = useWaitForTransactionReceipt({ hash });

  const onTarget = chainId === TARGET_CHAIN_ID;
  const canSend = !!address && tokenId !== null && step !== "sending" && step !== "checking" && step !== "switching";

  useEffect(() => {
    if (pendingHash && !hash) setHash(pendingHash as `0x${string}`);
  }, [pendingHash, hash]);

  useEffect(() => {
    if (receipt && step === "sent") {
      setStep("confirmed");
      try {
        const detail = {
          tokenId: tokenId?.toString(),
          txHash: hash,
          chainId: TARGET_CHAIN_ID,
          collection: COLLECTION_ADDRESS,
        };
        window.dispatchEvent(new CustomEvent("wg:nft-confirmed", { detail }));
      } catch {}
    }
  }, [receipt, step, tokenId, hash]);

  async function preflight(owner: Address, id: bigint) {
    if (!COLLECTION_ADDRESS || !RECIPIENT_ADDRESS) throw new Error("Env addresses are not set.");
    const currentOwner = (await publicClient!.readContract({
      address: COLLECTION_ADDRESS,
      abi: ERC721_ABI,
      functionName: "ownerOf",
      args: [id],
    })) as Address;
    if (currentOwner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error("You are not the owner of this tokenId.");
    }
    // Dry-run to surface reverts early
    await publicClient!.simulateContract({
      address: COLLECTION_ADDRESS,
      abi: ERC721_ABI,
      functionName: "safeTransferFrom",
      args: [owner, RECIPIENT_ADDRESS, id],
      account: owner,
      chain: MONAD,
    });
  }

  async function onSend() {
    setErr(null);
    if (!address || tokenId === null) return;

    // Ensure wallet is actually on Monad
    if (!onTarget) {
      try {
        setStep("switching");
        // Try wagmi first (some wallets support it)
        try {
          await switchChain({ chainId: TARGET_CHAIN_ID });
        } catch {
          // Fallback to raw EIP-3085 flow (Phantom often needs this)
          await forceSwitchMonad();
        }
      } catch (e: any) {
        setStep("error");
        setErr("Unable to switch to Monad Testnet. Open your wallet and switch network manually.");
        return;
      }
    }

    try {
      setStep("checking");
      await preflight(address as Address, tokenId);

      setStep("sending");
      const tx = await writeContractAsync({
        address: COLLECTION_ADDRESS,
        abi: ERC721_ABI,
        functionName: "safeTransferFrom",
        args: [address, RECIPIENT_ADDRESS, tokenId],
        chainId: TARGET_CHAIN_ID,
        account: address,
        gas: 120_000n, // explicit gas = safer on Monad
      });
      setHash(tx as `0x${string}`);
      setStep("sent");
    } catch (e: any) {
      console.error(e);
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
          From the allowed collection → to the vault on Monad testnet.
        </div>
      </div>

      {chainId !== TARGET_CHAIN_ID && (
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
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button
              onClick={() => switchChain({ chainId: TARGET_CHAIN_ID })}
              style={{ background: "linear-gradient(90deg,#7c4dff,#00c8ff)", color: "#fff", padding: "6px 10px", borderRadius: 10 }}
            >
              Switch via wagmi
            </button>
            <button
              onClick={async () => { try { await forceSwitchMonad(); } catch (e) {} }}
              style={{ background: "#2b2b31", color: "#fff", padding: "6px 10px", borderRadius: 10, border: "1px solid #3a3a41" }}
            >
              Force switch to Monad
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
          opacity: step === "sending" || step === "checking" || step === "switching" ? 0.85 : 1,
          cursor: canSend ? "pointer" : "not-allowed",
        }}
      >
        {step === "switching" ? "Switching…" : step === "checking" ? "Checking…" : step === "sending" ? "Sending…" : "Send 1 NFT"}
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
