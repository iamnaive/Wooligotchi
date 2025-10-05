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
  isHex,
} from "viem";
import { emit } from "../utils/domEvents";

/* ================ Constants (Monad testnet) ================ */
const COLLECTION_ADDRESS = "0x88c78d5852f45935324c6d100052958f694e8446" as const;
const RECIPIENT_ADDRESS  = "0xEb9650DDC18FF692f6224EA17f13C351A6108758" as const;

const TARGET_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const RPC_URL = String(import.meta.env.VITE_RPC_URL || "");

const MONAD = defineChain({
  id: TARGET_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  testnet: true,
});

/* ================ ABIs ================ */
// Minimal ERC-721
const ERC721_TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
);
const ERC721_ABI = [
  parseAbiItem("function safeTransferFrom(address from, address to, uint256 tokenId)"),
  parseAbiItem("function balanceOf(address owner) view returns (uint256)"),
  parseAbiItem("function ownerOf(uint256 tokenId) view returns (address)"),
  // ERC721Enumerable
  parseAbiItem("function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)"),
  // ERC165
  parseAbiItem("function supportsInterface(bytes4 interfaceId) view returns (bool)"),
];

/* ================ Helpers ================ */
function normalizeTokenId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (isHex(s)) return s;
  if (/^\d+$/.test(s)) return s.replace(/^0+/, "") || "0";
  return null;
}
function mapErrorMessage(e: any): string {
  const text = String(e?.shortMessage || e?.message || e || "").toLowerCase();
  if (e?.code === 4001 || text.includes("user rejected")) return "Transaction rejected in wallet.";
  if (text.includes("insufficient funds")) return "Not enough MON to cover gas.";
  if (text.includes("mismatch") && text.includes("chain")) return "Wrong network. Switch to Monad testnet (10143).";
  if (text.includes("http request failed") || text.includes("network error")) return "Network/RPC error. Check Monad RPC in your wallet.";
  if (text.includes("too many results") || text.includes("range"))
    return "RPC range too wide. Try again (the app will scan in smaller windows).";
  return e?.shortMessage || e?.message || "Transfer failed";
}
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

/* ================ Component ================ */
export default function VaultPanel() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { data: walletClient } = useWalletClient({
    account: address as `0x${string}` | undefined,
    chainId: TARGET_CHAIN_ID,
  });

  const publicClient = useMemo(
    () => createPublicClient({ chain: MONAD, transport: http(RPC_URL) }),
    []
  );

  const [rawId, setRawId] = useState("");
  const tokenId = useMemo(() => normalizeTokenId(rawId), [rawId]);

  const [owned, setOwned] = useState<bigint[]>([]);
  const [finding, setFinding] = useState(false);

  const [step, setStep] = useState<"idle"|"sending"|"sent"|"confirmed"|"error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  const onTargetChain = chainId === TARGET_CHAIN_ID;
  const signer = walletClient?.account?.address as `0x${string}` | undefined;
  const from = (signer ?? (address as `0x${string}` | undefined)) || null;

  useEffect(() => {
    if (receipt && step === "sent") {
      setStep("confirmed");
      emit("wg:nft-confirmed", { tokenId, txHash, chainId: TARGET_CHAIN_ID, collection: COLLECTION_ADDRESS });
    }
  }, [receipt, step, tokenId, txHash]);

  // -------- OWNED TOKENS DISCOVERY --------
  useEffect(() => {
    let stop = false;
    async function scan() {
      if (!address) { setOwned([]); return; }
      setFinding(true);
      setError(null);
      try {
        // 1) Try ERC721Enumerable
        let enumerable = false;
        try {
          // ERC721Enumerable interfaceId = 0x780e9d63
          enumerable = await publicClient.readContract({
            address: COLLECTION_ADDRESS,
            abi: ERC721_ABI,
            functionName: "supportsInterface",
            args: ["0x780e9d63"],
          });
        } catch {}

        if (enumerable) {
          const bal = await publicClient.readContract({
            address: COLLECTION_ADDRESS,
            abi: ERC721_ABI,
            functionName: "balanceOf",
            args: [address],
          }) as bigint;

          const maxToFetch = bal > 50n ? 50n : bal; // safety cap for UI
          const list: bigint[] = [];
          for (let i = 0n; i < maxToFetch; i++) {
            try {
              const id = await publicClient.readContract({
                address: COLLECTION_ADDRESS,
                abi: ERC721_ABI,
                functionName: "tokenOfOwnerByIndex",
                args: [address, i],
              }) as bigint;
              list.push(id);
            } catch {
              break; // not enumerable actually
            }
          }
          if (list.length) {
            if (!stop) {
              setOwned(list);
              if (!tokenId) setRawId(list[0].toString());
              setFinding(false);
              return;
            }
          }
        }

        // 2) Fallback: paginated getLogs backward
        const latest = await publicClient.getBlockNumber();
        const window = 20_000n;            // blocks per page
        const maxWindows = 300;            // ~6M blocks cap
        const found = new Set<bigint>();

        let to = latest;
        for (let w = 0; w < maxWindows && to > 0n; w++) {
          const fromBlock = to > window ? to - window + 1n : 0n;
          try {
            const logsIn = await publicClient.getLogs({
              address: COLLECTION_ADDRESS,
              event: ERC721_TRANSFER,
              args: { to: address as `0x${string}` },
              fromBlock,
              toBlock: to,
            });
            const logsOut = await publicClient.getLogs({
              address: COLLECTION_ADDRESS,
              event: ERC721_TRANSFER,
              args: { from: address as `0x${string}` },
              fromBlock,
              toBlock: to,
            });

            for (const l of logsIn) found.add((l.args?.tokenId ?? 0n) as bigint);
            for (const l of logsOut) found.delete((l.args?.tokenId ?? 0n) as bigint);

            if (found.size && !stop) break; // enough
          } catch (e: any) {
            // ignore page errors and continue with smaller window
          }
          if (to === 0n) break;
          to = fromBlock > 0n ? fromBlock - 1n : 0n;
        }

        const final = Array.from(found).sort((a, b) => (a < b ? -1 : 1));
        if (!stop) {
          setOwned(final);
          if (final.length && !tokenId) setRawId(final[0].toString());
        }
      } catch (e: any) {
        if (!stop) setError("Failed to scan owned NFTs. " + (e?.shortMessage || e?.message || ""));
      } finally {
        if (!stop) setFinding(false);
      }
    }
    scan();
    return () => { stop = true; };
  }, [address]); // re-scan on wallet change

  // -------- Build & send tx --------
  const buildTx = async (sender: `0x${string}`, tid: string) => {
    const data = encodeFunctionData({
      abi: ERC721_ABI,
      functionName: "safeTransferFrom",
      args: [sender, RECIPIENT_ADDRESS, BigInt(tid)],
    });
    const sim = await publicClient.simulateContract({
      address: COLLECTION_ADDRESS,
      abi: ERC721_ABI,
      functionName: "safeTransferFrom",
      args: [sender, RECIPIENT_ADDRESS, BigInt(tid)],
      account: sender,
    });
    return { to: COLLECTION_ADDRESS as `0x${string}`, data: data as `0x${string}`, gas: sim.request.gas };
  };

  const onSend = async () => {
    setError(null);
    if (!from) { setError("No wallet account."); return; }
    if (!tokenId) { setError("No tokenId selected."); return; }

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

  /* ================ UI (compact) ================ */
  const canClick = !!from && !!tokenId && step !== "sending";

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

        {owned.length > 1 && (
          <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11, opacity: 0.85 }}>
            {owned.slice(0, 12).map((id) => (
              <button
                key={id.toString()}
                onClick={() => setRawId(id.toString())}
                className="btn"
                style={{ background: "#1a1a20", borderRadius: 10, padding: "4px 8px", color: "#ddd", border: "1px solid #2b2b31" }}
              >
                #{id.toString()}
              </button>
            ))}
            {owned.length > 12 && <span style={{ opacity: 0.6 }}>… +{owned.length - 12} more</span>}
          </div>
        )}

        <div className="muted" style={{ fontSize: 11, opacity: 0.65, marginTop: 6 }}>
          Auto-detected on the allowed collection → vault (Monad testnet).
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
                onClick={() => { setOwned([]); setRawId(""); }}
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
