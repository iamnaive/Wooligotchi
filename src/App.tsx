import React, { useState } from "react";
import {
  http,
  createConfig,
  WagmiConfig,
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useWriteContract,
  useSwitchChain,
} from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";

// ===== Chain (Monad testnet) =====
const CHAIN_ID = Number(
  (import.meta as any).env?.VITE_CHAIN_ID ??
    (globalThis as any).process?.env?.NEXT_PUBLIC_CHAIN_ID ??
    10143
);

const RPC_URL =
  (import.meta as any).env?.VITE_RPC_URL ??
  (globalThis as any).process?.env?.NEXT_PUBLIC_RPC_URL ??
  "https://testnet-rpc.monad.xyz";

const NFT_ADDRESS = (
  (import.meta as any).env?.VITE_NFT_ADDRESS ??
  (globalThis as any).process?.env?.NEXT_PUBLIC_NFT_ADDRESS ??
  ""
) as `0x${string}`;

const MONAD_TESTNET = defineChain({
  id: CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [String(RPC_URL)] } },
});

const config = createConfig({
  chains: [MONAD_TESTNET],
  connectors: [injected()],
  transports: { [MONAD_TESTNET.id]: http(RPC_URL) },
});

// ===== Minimal ERC-721 ABI =====
const ERC721_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "burn",
    stateMutability: "nonpayable",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [],
  },
  // If your collection doesn't support burn(tokenId), swap to safeTransferFrom(from, to, tokenId) → 0x...dEaD
  // { "type":"function","name":"safeTransferFrom","stateMutability":"nonpayable","inputs":[{"name":"from","type":"address"},{"name":"to","type":"address"},{"name":"tokenId","type":"uint256"}],"outputs":[] }
] as const;

function AppInner() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [hasAccess, setHasAccess] = useState<null | boolean>(null);
  const [tokenIdToBurn, setTokenIdToBurn] = useState("");

  const { refetch: refetchBalance, isFetching } = useReadContract({
    address: NFT_ADDRESS,
    abi: ERC721_ABI,
    functionName: "balanceOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: false },
  });

  const { writeContractAsync, status: writeStatus } = useWriteContract();

  const onConnect = async () => {
    await connect({ connector: connectors.find((c) => c.id === "injected") || connectors[0] });
    try {
      await switchChain({ chainId: MONAD_TESTNET.id });
    } catch {}
  };

  const onCheckAccess = async () => {
    const res = await refetchBalance();
    const v = res.data ? BigInt(res.data as any) : 0n;
    setHasAccess(v > 0n);
  };

  const onBurn = async () => {
    if (!tokenIdToBurn) return alert("Enter tokenId");
    try {
      await writeContractAsync({
        address: NFT_ADDRESS,
        abi: ERC721_ABI,
        functionName: "burn",
        args: [BigInt(tokenIdToBurn)],
        chainId: MONAD_TESTNET.id,
      });
      alert("Burn tx sent. After confirm, press Check Access again.");
    } catch (e: any) {
      alert(e?.shortMessage || e?.message || "Burn failed");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#fff", padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>WoollyGotchi (Monad testnet)</h1>

      {!isConnected ? (
        <button onClick={onConnect} style={{ padding: "10px 14px", borderRadius: 14, background: "#222", marginTop: 12 }}>
          Connect Wallet
        </button>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div style={{ opacity: 0.8, fontSize: 12, marginBottom: 8 }}>{address}</div>
          <button onClick={() => disconnect()} style={{ padding: "6px 10px", borderRadius: 12, background: "#222" }}>
            Disconnect
          </button>
        </div>
      )}

      <div style={{ marginTop: 24, background: "#111", padding: 16, borderRadius: 16, maxWidth: 560 }}>
        <h2 style={{ marginTop: 0 }}>Token Gate</h2>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>Collection: {NFT_ADDRESS}</div>
        <button onClick={onCheckAccess} disabled={!isConnected || isFetching} style={{ padding: "10px 14px", borderRadius: 12, background: "#222" }}>
          {isFetching ? "Checking…" : "Check Access"}
        </button>
        {hasAccess !== null && (
          <div style={{ marginTop: 10, fontSize: 14 }}>
            Access:{" "}
            {hasAccess ? <span style={{ color: "#47e774" }}>granted</span> : <span style={{ color: "#ff5c5c" }}>denied</span>}
          </div>
        )}
      </div>

      <div style={{ marginTop: 16, background: "#111", padding: 16, borderRadius: 16, maxWidth: 560 }}>
        <h2 style={{ marginTop: 0 }}>Burn → +1 life (prototype)</h2>
        <input
          placeholder="tokenId (e.g., 0)"
          value={tokenIdToBurn}
          onChange={(e) => setTokenIdToBurn(e.target.value)}
          style={{ width: "100%", padding: 10, borderRadius: 12, background: "#1b1b1b", color: "#fff", outline: "none", marginBottom: 10 }}
        />
        <button onClick={onBurn} disabled={!isConnected || writeStatus === "pending"} style={{ padding: "10px 14px", borderRadius: 12, background: "#222" }}>
          {writeStatus === "pending" ? "Sending…" : "Burn"}
        </button>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>
          If burn(tokenId) isn’t available, switch to safeTransferFrom(from, 0x000000000000000000000000000000000000dEaD, tokenId).
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <WagmiConfig config={config}>
      <AppInner />
    </WagmiConfig>
  );
}
