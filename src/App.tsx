// src/App.tsx
// WagmiProvider + connectors + auto switch/add chain + VaultPanel.
// Comments in English only.

import React, { useMemo, useState } from "react";
import {
  http,
  createConfig,
  WagmiProvider,
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  useChainId,
  useSwitchChain,
} from "wagmi";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";
import { defineChain } from "viem";
import VaultPanel from "./components/VaultPanel";

/* ===== ENV ===== */
const MONAD_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const RPC_URL = String(import.meta.env.VITE_RPC_URL ?? "https://testnet-rpc.monad.xyz");
const WC_ID = String(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "");

/* ===== CHAIN (include blockExplorers + testnet flag for addChain) ===== */
const MONAD = defineChain({
  id: MONAD_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: "Explorer", url: "https://explorer.monad.testnet" }, // placeholder ok
  },
  testnet: true,
});

/* ===== CONNECTORS ===== */
const connectorsList = [
  injected({ shimDisconnect: true }),
  WC_ID
    ? walletConnect({
        projectId: WC_ID,
        showQrModal: true,
        qrModalOptions: {
          themeMode: "dark",
          themeVariables: {
            "--wcm-accent-color": "#7c4dff",
            "--wcm-background-color": "#0b0b13",
            "--wcm-font-family":
              "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
            "--wcm-z-index": "99999",
          },
        },
        metadata: {
          name: "WoollyGotchi",
          description: "Tamagotchi mini-app on Monad testnet",
          url:
            typeof window !== "undefined"
              ? window.location.origin
              : "https://example.com",
          icons: [
            "https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f999.svg",
          ],
        },
      })
    : null,
  coinbaseWallet({ appName: "WoollyGotchi" }),
].filter(Boolean);

/* ===== WAGMI CONFIG ===== */
const config = createConfig({
  chains: [MONAD],
  connectors: connectorsList as any,
  transports: { [MONAD.id]: http(RPC_URL) },
  ssr: false,
});

/* ===== UI HELPERS ===== */
function short(addr?: `0x${string}`) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

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
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: 460, maxWidth: "92vw" }}>
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
          If Phantom doesn't switch, use MetaMask/OKX/Rabby or WalletConnect with a wallet that supports custom testnets.
        </div>
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} className="btn">Close</button>
        </div>
      </div>
    </div>
  );
}

/* ===== APP CONTENT ===== */
function AppInner() {
  const { address, isConnected, status } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, status: connectStatus } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: balance } = useBalance({ address, chainId, query: { enabled: !!address } });

  const [pickerOpen, setPickerOpen] = useState(false);

  const walletItems = useMemo(
    () =>
      connectors.map((c) => ({
        id: c.id,
        label: c.name === "Injected" ? "Browser wallet (MetaMask / Phantom / OKX …)" : c.name,
      })),
    [connectors]
  );

  const pickWallet = async (connectorId: string) => {
    try {
      const c = connectors.find((x) => x.id === connectorId);
      if (!c) return;

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

      // Try to switch/add chain
      try {
        await switchChain({ chainId: MONAD_CHAIN_ID });
      } catch (e) {
        console.warn("Chain switch/add failed (Phantom often can't add custom testnets)", e);
      }

      setPickerOpen(false);
    } catch (e: any) {
      console.error(e);
      alert(e?.shortMessage || e?.message || "Connect failed");
    }
  };

  return (
    <div className="page">
      <header className="topbar">
        <div className="title">WoollyGotchi (Monad testnet)</div>

        {!isConnected ? (
          <button className="btn btn-primary" onClick={() => setPickerOpen(true)}>
            Connect Wallet
          </button>
        ) : (
          <div className="walletRow">
            <span className="pill">{short(address)}</span>
            <span className="muted">
              {balance ? `${Number(balance.formatted).toFixed(4)} ${balance.symbol}` : "—"}
            </span>
            <span className="muted">Chain ID: {chainId ?? "—"}</span>
            <button className="btn ghost" onClick={() => disconnect()}>
              Disconnect
            </button>
          </div>
        )}
      </header>

      <VaultPanel />

      <footer className="foot">
        <span className="muted">Status: {status}</span>
      </footer>

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

/* ===== EXPORT ROOT ===== */
export default function App() {
  return (
    <WagmiProvider config={config}>
      <AppInner />
    </WagmiProvider>
  );
}
