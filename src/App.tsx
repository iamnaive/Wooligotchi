import React, { useMemo, useState } from "react";
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

// ---------- ENV ----------
const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const RPC_URL = String(import.meta.env.VITE_RPC_URL ?? "https://testnet-rpc.monad.xyz");
const NFT_ADDRESS_RAW = (import.meta.env.VITE_NFT_ADDRESS ?? "") as string;
const NFT_ADDRESS = (NFT_ADDRESS_RAW.startsWith("0x") ? NFT_ADDRESS_RAW : "") as `0x${string}`;
const WC_ID = String(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "");

// ---------- CHAIN ----------
const MONAD_TESTNET = defineChain({
  id: CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

// ---------- CONNECTORS ----------
// ВКЛЮЧАЕМ QR-модалку WalletConnect (рабочая стабильная версия пакета).
const baseConnectors = [
  injected(),
  WC_ID
    ? walletConnect({
        projectId: WC_ID,
        showQrModal: true, // ← теперь при клике откроется QR
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

// ---------- WAGMI CONFIG ----------
const config = createConfig({
  chains: [MONAD_TESTNET],
  connectors: baseConnectors as any,
  transports: { [MONAD_TESTNET.id]: http(RPC_URL) },
});

// ---------- MINIMAL ERC721 ABI ----------
const ERC721_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "burn", stateMutability: "nonpayable", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [] },
] as const;

// ---------- SIMPLE WALLET PICKER (overlay modal) ----------
function WalletPicker({
  open,
  onClose,
  onPick,
  items,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
  items: { id: string; label: string }[];
  pending: boolean;
}) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: "90vw",
          background: "#111",
          border: "1px solid #222",
          borderRadius: 16,
          padding: 16,
          color: "#fff",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Connect a wallet</div>
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((i) => (
            <button
              key={i.id}
              onClick={() => onPick(i.id)}
              disabled={pending}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                background: "#1a1a1a",
                textAlign: "left",
                border: "1px solid #2a2a2a",
              }}
            >
              {i.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.6 }}>
          WalletConnect покажет QR для мобильных кошельков (Phantom, Rainbow, OKX и т.д.).
        </div>
        <button
          onClick={onClose}
          style={{ marginTop: 12, padding: "8px 12px", borderRadius: 10, background: "#222" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function AppInner() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, status: connectStatus } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [hasAccess, setHasAccess] = useState<null | boolean>(null);
  const [tokenIdToBurn, setTokenIdToBurn] = useState("");

  const walletItems = useMemo(
    () =>
      connectors.map((c) => ({
        id: c.id,
        label: c.name === "Injected" ? "Browser wallet (MetaMask / Phantom / OKX …)" : c.name,
      })),
    [connectors]
  );

  const { refetch: refetchBalance, isFetching } = useReadContract({
    address: (NFT_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    abi: ERC721_ABI,
    functionName: "balanceOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: false },
  });

  const { writeContractAsync, status: writeStatus } = useWriteContract();

  const pickWallet = async (connectorId: string) => {
    try {
      const c = connectors.find((x) => x.id === connectorId);
      if (!c) return;

      // Подсказка, если инжекта нет
      if (c.id === "injected") {
        const hasProvider =
          typeof window !== "undefined" &&
          // @ts-ignore
          (window.ethereum ||
            (window as any).coinbaseWalletExtension ||
            (window as any).phantom?.ethereum);
        if (!hasProvider) {
          alert("Браузерный кошелёк не найден/не разрешён. Установи MetaMask/Phantom или используй WalletConnect (QR).");
          return;
        }
      }

      await connect({ connector: c });
      setPickerOpen(false);
      try {
        await switchChain({ chainId: MONAD_TESTNET.id });
      } catch {}
    } catch (e: any) {
      console.error(e);
      alert(e?.shortMessage || e?.message || "Connect failed");
    }
  };

  const onCheckAccess = async () => {
    if (!NFT_ADDRESS) return alert("Set VITE_NFT_ADDRESS in env");
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
        <>
          <button
            onClick={() => setPickerOpen(true)}
            style={{ padding: "10px 14px", borderRadius: 14, background: "#222", marginTop: 12 }}
          >
            Connect Wallet
          </button>
          <WalletPicker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onPick={pickWallet}
            items={walletItems}
            pending={connectStatus === "pending"}
          />
        </>
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
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>Collection: {NFT_ADDRESS || "(set VITE_NFT_ADDRESS in env)"}</div>
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
