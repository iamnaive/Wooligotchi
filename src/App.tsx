import React, { useState } from "react";
import {
  http,
  createConfig,
  WagmiProvider,
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useWriteContract,
  useSwitchChain,
} from "wagmi";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";
import { defineChain } from "viem";

// -------- Env --------
const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const RPC_URL = String(import.meta.env.VITE_RPC_URL ?? "https://testnet-rpc.monad.xyz");
const NFT_ADDRESS_RAW = (import.meta.env.VITE_NFT_ADDRESS ?? "") as string;
const NFT_ADDRESS = (NFT_ADDRESS_RAW.startsWith("0x") ? NFT_ADDRESS_RAW : "") as `0x${string}`;
const WC_ID = String(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "");

// -------- Chain (Monad testnet) --------
const MONAD_TESTNET = defineChain({
  id: CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

// -------- Connectors --------
// WalletConnect без QR-модалки (чтобы не тянуть проблемный пакет модалки).
const connectorsList = [
  injected(), // MetaMask, Phantom, OKX и др. как injected
  WC_ID
    ? walletConnect({
        projectId: WC_ID,
        showQrModal: false, // QR отключен; на мобиле открывай сайт в кошельке
        metadata: {
          name: "WoollyGotchi",
          description: "Tamagotchi mini-app on Monad testnet",
          url: typeof window !== "undefined" ? window.location.origin : "https://example.com",
          icons: ["https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f999.svg"],
        },
      })
    : null,
  coinbaseWallet({ appName: "WoollyGotchi" }),
].filter(Boolean);

// -------- wagmi config --------
const config = createConfig({
  chains: [MONAD_TESTNET],
  connectors: connectorsList as any,
  transports: { [MONAD_TESTNET.id]: http(RPC_URL) },
});

// -------- Minimal ERC-721 ABI --------
const ERC721_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ownerOf", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "burn", stateMutability: "nonpayable",
    inputs: [{ name: "tokenId", type: "uint256" }], outputs: [] },
] as const;

function AppInner() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, status: connectStatus } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const [hasAccess, setHasAccess] = useState<null | boolean>(null);
  const [tokenIdToBurn, setTokenIdToBurn] = useState("");

  const { refetch: refetchBalance, isFetching } = useReadContract({
    address: (NFT_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    abi: ERC721_ABI,
    functionName: "balanceOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: false },
  });

  const { writeContractAsync, status: writeStatus } = useWriteContract();

  const onConnect = async (connectorId?: string) => {
    try {
      const c = connectorId ? connectors.find(x => x.id === connectorId) : connectors[0];
      // если это injected и провайдера не видно — подсказка
      if (c?.id === "injected") {
        const hasProvider =
          typeof window !== "undefined" &&
          // @ts-ignore
          (window.ethereum || (window as any).coinbaseWalletExtension || (window as any).phantom?.ethereum);
        if (!hasProvider) {
          alert(
            "Браузерный кошелёк не найден/не разрешён на сайте. " +
            "Установи/разреши MetaMask/Phantom и перезагрузи страницу, либо используй WalletConnect (моб. кошелёк)."
          );
          return;
        }
      }
      await connect({ connector: c! });
      try { await switchChain({ chainId: MONAD_TESTNET.id }); } catch {}
    } catch (e: any) {
      console.error(e);
      alert(e?.shortMessage || e?.message || "Connect failed");
    }
  };

  const onCheckAccess = async () => {
    if (!NFT_ADDRESS) return alert("Set VITE_NFT_ADDRESS in Vercel → Environment Variables");
    const res = await refetchBalance();
    const v = res.data ? BigInt(res.data as any) : 0n;
    setHasAccess(v > 0n);
  };

  const onBurn = async () => {
    if (!NFT_ADDRESS) return alert("Set VITE_NFT_ADDRESS first");
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
      console.error(e);
      alert(e?.shortMessage || e?.message || "Burn failed");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#fff", padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>WoollyGotchi (Monad testnet)</h1>

      {!isConnected ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {connectors.map((c) => (
            <button
              key={c.id}
              onClick={() => onConnect(c.id)}
              disabled={connectStatus === "pending"}
              style={{ padding: "10px 14px", borderRadius: 14, background: "#222" }}
            >
              {c.name === "Injected" ? "MetaMask / Browser" : c.name}
            </button>
          ))}
          {!!WC_ID && (
            <div style={{ fontSize: 12, opacity: 0.6, width: "100%" }}>
              WalletConnect работает. Для Phantom/других мобильных кошельков открой сайт в их встроенном браузере
              и нажми WalletConnect. (QR добавим позже)
            </div>
          )}
        </div>
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
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
          Collection: {NFT_ADDRESS || "(set VITE_NFT_ADDRESS in env)"}
        </div>
        <button onClick={onCheckAccess} disabled={!isConnected || isFetching} style={{ padding: "10px 14px", borderRadius: 12, background: "#222" }}>
          {isFetching ? "Checking…" : "Check Access"}
        </button>
        {hasAccess !== null && (
          <div style={{ marginTop: 10, fontSize: 14 }}>
            Access: {hasAccess ? <span style={{ color: "#47e774" }}>granted</span> : <span style={{ color: "#ff5c5c" }}>denied</span>}
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
      </div>
    </div>
  );
}

export default function App() {
  return (
    <WagmiProvider config={config}>
      <AppInner />
    </WagmiProvider>
  );
}
