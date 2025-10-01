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

/** ---------- ENV ---------- */
const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const RPC_URL = String(import.meta.env.VITE_RPC_URL ?? "https://testnet-rpc.monad.xyz");
const NFT_ADDRESS_RAW = (import.meta.env.VITE_NFT_ADDRESS ?? "") as string;
const NFT_ADDRESS = (NFT_ADDRESS_RAW.startsWith("0x") ? NFT_ADDRESS_RAW : "") as `0x${string}`;
const WC_ID = String(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "");

/** ---------- CHAIN ---------- */
const MONAD_TESTNET = defineChain({
  id: CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

/** ---------- CONNECTORS (with WalletConnect modal theming) ---------- */
const connectorsList = [
  injected(),
  WC_ID
    ? walletConnect({
        projectId: WC_ID,
        showQrModal: true,
        // The options below customize the WalletConnect modal
        qrModalOptions: {
          themeMode: "dark",
          themeVariables: {
            "--wcm-accent-color": "#7c4dff",
            "--wcm-background-color": "#0b0b13",
            "--wcm-font-family": "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
            "--wcm-z-index": "99999"
          }
        },
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

/** ---------- WAGMI CONFIG ---------- */
const config = createConfig({
  chains: [MONAD_TESTNET],
  connectors: connectorsList as any,
  transports: { [MONAD_TESTNET.id]: http(RPC_URL) },
});

/** ---------- MINIMAL ERC-721 ABI ---------- */
const ERC721_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "burn", stateMutability: "nonpayable", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [] },
] as const;

/** ---------- Simple wallet picker modal ---------- */
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
        className="card"
        style={{ width: 460, maxWidth: "92vw" }}
      >
        <div className="title" style={{ fontSize: 20, marginBottom: 10 }}>Connect a wallet</div>
        <div className="wallet-grid">
          {items.map((i) => (
            <button
              key={i.id}
              onClick={() => onPick(i.id)}
              disabled={pending}
              className="btn btn-ghost"
              style={{ width: "100%" }}
            >
              {i.label}
            </button>
          ))}
        </div>
        <div className="helper" style={{ marginTop: 10 }}>
          WalletConnect opens a QR for mobile wallets (Phantom, Rainbow, OKX, etc.).
        </div>
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} className="btn">Close</button>
        </div>
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

      // Extra hint when no injected provider is present
      if (c.id === "injected") {
        const hasProvider =
          typeof window !== "undefined" &&
          // @ts-ignore
          (window.ethereum ||
            (window as any).coinbaseWalletExtension ||
            (window as any).phantom?.ethereum);
        if (!hasProvider) {
          alert("No browser wallet detected. Install/enable MetaMask/Phantom or use WalletConnect (QR).");
          return;
        }
      }

      await connect({ connector: c });
      setPickerOpen(false);
      try { await switchChain({ chainId: MONAD_TESTNET.id }); } catch {}
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
    <div className="container">
      <header className="header">
        <div className="title">WoollyGotchi (Monad testnet)</div>
        {!isConnected ? (
          <button className="btn btn-primary" onClick={() => setPickerOpen(true)}>
            Connect Wallet
          </button>
        ) : (
          <button className="btn" onClick={() => disconnect()}>Disconnect</button>
        )}
      </header>

      {/* Token gate card */}
      <section className="card" style={{ marginTop: 18 }}>
        <h2 className="card-title">Token Gate</h2>
        <div className="helper" style={{ marginBottom: 10 }}>
          Collection: {NFT_ADDRESS || "(set VITE_NFT_ADDRESS in env)"}
        </div>
        <button
          className="btn btn-ghost"
          onClick={onCheckAccess}
          disabled={!isConnected || isFetching}
        >
          {isFetching ? "Checking…" : "Check Access"}
        </button>
        {hasAccess !== null && (
          <div className="helper" style={{ marginTop: 10 }}>
            Access: {hasAccess ? "granted ✅" : "denied ❌"}
          </div>
        )}
      </section>

      {/* Burn card */}
      <section className="card">
        <h2 className="card-title">Burn → +1 life (prototype)</h2>
        <input
          className="input"
          placeholder="tokenId (e.g., 0)"
          value={tokenIdToBurn}
          onChange={(e) => setTokenIdToBurn(e.target.value)}
        />
        <div style={{ height: 10 }} />
        <button
          className="btn btn-ghost"
          onClick={onBurn}
          disabled={!isConnected || writeStatus === "pending"}
        >
          {writeStatus === "pending" ? "Sending…" : "Burn"}
        </button>
      </section>

      {/* Wallet picker modal */}
      <WalletPicker
        open={pickerOpen && !isConnected}
        onClose={() => setPickerOpen(false)}
        onPick={pickWallet}
        items={walletItems}
        pending={connectStatus === "pending"}
      />
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
