// src/components/VaultPanel.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWalletClient,
} from "wagmi";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  parseAbiItem,
  defineChain,
  Hex,
} from "viem";
import { emit } from "../utils/domEvents";

/* ================== Constants (Monad testnet) ================== */
// Allowed ERC-721 collection (only from this contract)
const COLLECTION_ADDRESS = "0x88c78d5852f45935324c6d100052958f694e8446" as const;
// Recipient (vault)
const RECIPIENT_ADDRESS  = "0xEb9650DDC18FF692f6224EA17f13C351A6108758" as const;

// Target chain / RPC
const TARGET_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const RPC_URL = String(import.meta.env.VITE_RPC_URL || "");

// viem chain (our read/sim RPC)
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
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
);

/* ================== Helpers ================== */
// Normalize tokenId entered as decimal or hex
function normalizeTokenId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^0x[0-9a-fA-F]+$/.test(s)) return s;
  if (/^\d+$/.test(s)) return s.replace(/^0+/, "") || "0";
  return null;
}

// Friendly errors
function mapErrorMessage(e: any): string {
  const text = String(e?.shortMessage || e?.message || e || "").toLowerCase();
  if (e?.code === 4001 || text.includes("user rejected")) return "Transaction rejected in wallet.";
  if (text.includes("insufficient funds")) return "Not enough MON to cover gas.";
  if (text.includes("chain") && text.includes("mismatch")) return "Wrong network. Switch to Monad testnet (10143).";
  if (text.includes("http request failed") || text.includes("network error")) return "Network/RPC error. Check Monad RPC in your wallet.";
  return e?.shortMessage || e?.message || "Transfer failed";
}

// Add Monad with our Alchemy RPC (best-effort)
async function ensureMonadNetwork(): Promise<void> {
  // @ts-ignore
  const eth = window?.ethereum;
  if (!eth || !RPC_URL) return;
  try {
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0x" + TARGET_CHAIN_ID.toString(16),
        chainName: "Monad Testnet",
        nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
        rpcUrls: [RPC_URL],
      }],
    });
  } catch {}
}

/* ================== Component ================== */
export default function VaultPanel() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  // Wallet client that will sign the tx
  const { data: walletClient } = useWalletClient({
    account: address as `0x${string}` | undefined,
    chainId: TARGET_CHAIN_ID,
  });

  // Our read/sim client (Alchemy RPC)
  const publicClient = useMemo(
    () => createPublicClient({ chain: MONAD, transport: http(RPC_URL) }),
    []
  );

  const [rawId, setRawId] = useState("");
  const tokenId = useMemo(() => normalizeTokenId(rawId), [rawId]);

  const [owned, setOwned] = useState<bigint[]>([]);
  const [finding, setFinding] = useState(false);

  const [step, setStep] = useState<"idle" | "sending" | "sent" | "confirmed" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });
  const onTargetChain = chainId === TARGET_CHAIN_ID;

  // Pick actual signer address from wallet client
  function pickFrom(): `0x${string}` | null {
    const fromClient = walletClient?.account?.address as `0x${string}` | undefined;
    return fromClient ?? (address as `0x${string}` | undefined) ?? null;
  }

  // Emit after confirmation
  useEffect(() => {
    if (receipt && step === "sent") {
      setStep("confirmed");
      emit("wg:nft-confirmed", { tokenId, txHash, chainId: TARGET_CHAIN_ID, collection: COLLECTION_ADDRESS });
    }
  }, [receipt, step, tokenId, txHash]);

  // === Auto-discover owned tokenIds by Transfer logs ===
  useEffect(() => {
    let stop = false;
    async function fetchOwned() {
      if (!address) { setOwned([]); return; }
      setFinding(true);
      setError(null);
      try {
        // Get all incoming to "address"
        const inLogs = await publicClient.getLogs({
          address: COLLECTION_ADDRESS,
          event: TRANSFER_EVENT,
          args: { to: address as `0x${string}` },
          fromBlock: 0n,
          toBlock: "latest",
        });

        // Get all outgoing from "address"
        const outLogs = await publicClient.getLogs({
          address: COLLECTION_ADDRESS,
          event: TRANSFER_EVENT,
          args: { from: address as `0x${string}` },
          fromBlock: 0n,
          toBlock: "latest",
        });

        // Build current ownership set = incoming - outgoing by tokenId
        const inc = new Map<bigint, number>();
        for (const l of inLogs) {
          const id = (l.args?.tokenId ?? 0n) as bigint;
          inc.set(id, (inc.get(id) || 0) + 1);
        }
        for (const l of outLogs) {
          const id = (l.args?.tokenId ?? 0n) as bigint;
          inc.set(id, (inc.get(id) || 0) - 1);
        }

        const have = Array.from(inc.entries())
          .filter(([, c]) => c > 0)
          .map(([id]) => id)
          .sort((a, b) => (a < b ? -1 : 1));

        if (!stop) {
          setOwned(have);
          // Autofill first token if input is empty or invalid
          if (have.length && !normalizeTokenId(rawId)) {
            setRawId(have[0].toString());
          }
        }
      } catch (e: any) {
        if (!stop) setError("Failed to scan owned NFTs (logs). Try again.");
      } finally {
        if (!stop) setFinding(false);
      }
    }
    fetchOwned();
    return () => { stop = true; };
  }, [address]); // re-scan on wallet change

  // Build tx using our RPC (encode + gas via simulate)
  const buildTx = async (from: `0x${string}`, tid: string) => {
    const data = encodeFunctionData({
      abi: ERC721_ABI,
      functionName: "safeTransferFrom",
      args: [from, RECIPIENT_ADDRESS, BigInt(tid)],
    });

    const sim = await publicClient.simulateContract({
      address: COLLECTION_ADDRESS,
      abi: ERC721_ABI,
      functionName: "safeTransferFrom",
      args: [from, RECIPIENT_ADDRESS, BigInt(tid)],
      account: from,
    });

    return {
      to: COLLECTION_ADDRESS as `0x${string}`,
      data: data as `0x${string}`,
      gas: sim.request.gas,
    };
  };

  const onSend = async () => {
    setError(null);
    const from = pickFrom();
    if (!from) return;
    if (!tokenId) { setError("No tokenId selected."); return; }

    // If chosen token is not in discovered list, still allow (manual case)
    if (owned.length && !owned.some((x) => x === BigInt(tokenId))) {
      // Gentle warning, but do not block
      setError("Selected tokenId is not detected on this wallet (continuing anyway).");
    }

    if (!onTargetChain) {
      await ensureMonadNetwork();
      try { await switchChain({ chainId: TARGET_CHAIN_ID }); }
      catch (e: any) { setStep("error"); setError(mapErrorMessage(e)); return; }
    }
    if (!walletClient) {
      setStep("error");
      setError("Wallet client is not ready. Reconnect the wallet.");
      return;
    }

    try {
      setStep("sending");
      const tx = await buildTx(from, tokenId);
      const hash = await walletClient.sendTransaction({
        account: from,
        chain: MONAD,
        to: tx.to,
        data: tx.data,
        gas: tx.gas,
      });
      setTxHash(hash);
      setStep("sent");
    } catch (e: any) {
      setStep("error");
      setError(mapErrorMessage(e));
    }
  };

  /* ================== Minimal UI ================== */
  const canClick = !!pickFrom() && !!tokenId && step !== "sending";

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

      {/* tokenId (auto-filled from owned NFTs) */}
      <div>
        <label className="text-xs opacity-80" style={{ display: "block", marginBottom: 6 }}>
          tokenId {finding ? "(scanning…)" : owned.length ? `(${owned.length} found)` : ""}
        </label>
        <div className="flex items-center rounded-xl px-3 py-2" style={{ background: "#17171c", border: "1px solid #2b2b31" }}>
          <div className="text-xs mr-2 px-2 py-1 rounded-lg" style={{ background: "#222228", border: "1px solid #32323a", color: "#ddd" }}>
            #ID
          </div>
          <input
            className="flex-1 outline-none text-sm"
            placeholder="auto"
            value={rawId}
            onChange={(e) => setRawId(e.target.value)}
            spellCheck={false}
            style={{ color: "#fff", background: "transparent", border: 0, caretColor: "#fff" }}
          />
          <span className="text-[11px] ml-2" style={{ opacity: 0.75, color: tokenId ? "#9fe29f" : "#ff9e9e" }}>
            {tokenId ? "ok" : "invalid"}
          </span>
        </div>

        {/* quick picker of first few owned ids (if many, keep it small) */}
        {owned.length > 1 && (
          <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11, opacity: 0.85 }}>
            {owned.slice(0, 10).map((id) => (
              <button
                key={id.toString()}
                onClick={() => setRawId(id.toString())}
                className="btn"
                style={{
                  background: "#1a1a20",
                  borderRadius: 10,
                  padding: "4px 8px",
                  color: "#ddd",
                  border: "1px solid #2b2b31",
                }}
              >
                #{id.toString()}
              </button>
            ))}
            {owned.length > 10 && <span style={{ opacity: 0.6 }}>… +{owned.length - 10} more</span>}
          </div>
        )}

        <div className="muted" style={{ fontSize: 11, opacity: 0.65, marginTop: 6 }}>
          Auto-detected from the allowed collection → vault on Monad testnet.
        </div>
      </div>

      <button
        disabled={!canClick}
        onClick={onSend}
        className="w-full rounded-xl py-3 transition"
        style={{
          marginTop: 12,
          background: canClick ? "linear-gradient(90deg,#7c4dff,#00c8ff)" : "#2a2a2f",
          color: "#fff",
          boxShadow: canClick ? "0 8px 22px rgba(124,77,255,0.35)" : "none",
          opacity: step === "sending" ? 0.85 : 1,
        }}
      >
        {step === "sending" ? "Sending…" : "Send 1 NFT"}
      </button>

      <div style={{ marginTop: 10, fontSize: 12 }}>
        {txHash && !receipt && <div style={{ opacity: 0.85 }}>Waiting for confirmation…</div>}
        {step === "confirmed" && <div style={{ color: "#6adf6a" }}>Confirmed. You can continue.</div>}
        {error && (
          <>
            <div style={{ color: "#ff6b6b" }}>{error}</div>
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={async () => { await ensureMonadNetwork(); try { await switchChain({ chainId: TARGET_CHAIN_ID }); } catch {} }}
                className="btn"
                style={{ background: "#2a2a2f", borderRadius: 10, padding: "6px 10px", color: "#fff" }}
              >
                Fix network (add Alchemy RPC)
              </button>
              <button
                onClick={() => { if (address) { setRawId(""); setOwned([]); } }}
                className="btn"
                style={{ background: "#2a2a2f", borderRadius: 10, padding: "6px 10px", color: "#fff" }}
              >
                Clear & rescan
              </button>
            </div>
          </>
        )}
      </div>

      <div className="text-[11px] opacity-65" style={{ marginTop: 8 }}>
        Flow: ERC721.safeTransferFrom(owner → vault, tokenId) on Monad testnet
      </div>
    </div>
  );
}
