// src/App.tsx
// WC-only wagmi config to avoid injected Phantom network conflicts.
// Comments: English only.

import React, { useEffect, useMemo, useState } from "react";
import {
  WagmiProvider,
  createConfig,
  http,
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { walletConnect } from "wagmi/connectors";
import { defineChain } from "viem";

import SendByIdPanel from "./components/SendByIdPanel";
import "./styles.css";

/* ========= ENV ========= */
const MONAD_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const RPC_HTTP = String(import.meta.env.VITE_RPC_URL ?? "https://testnet-rpc.monad.xyz");
const RPC_WSS  = String(import.meta.env.VITE_RPC_WSS ?? "wss://testnet-rpc.monad.xyz/ws");
const WC_ID    = String(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "");
const APP_URL  = typeof window !== "undefined" ? window.location.origin : "https://example.com";

/* ========= CHAIN ========= */
export const MONAD = defineChain({
  id: MONAD_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_HTTP], webSocket: [RPC_WSS] } },
  blockExplorers: { default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" } },
  testnet: true,
});

/* ========= WAGMI (WalletConnect only) ========= */
if (!WC_ID) {
  // Hard error early to avoid silent blank pages on CI
  // eslint-disable-next-line no-console
  console.warn("VITE_WALLETCONNECT_PROJECT_ID is empty — WalletConnect will not work.");
}

export const wagmiConfig = createConfig({
  chains: [MONAD],
  transports: { [MONAD.id]: http(RPC_HTTP) },
  connectors: [
    walletConnect({
      projectId: WC_ID,
      showQrModal: true,
      metadata: {
        name: "Wooligotchi",
        description: "Tamagotchi mini-app on Monad",
        url: APP_URL,
        icons: ["https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f423.svg"],
      },
      // You can force requiredChains to ensure session is on 10143
      // @ts-ignore
      requiredChains: [MONAD_CHAIN_ID],
    }),
  ],
  ssr: false,
});

/* ========= UI ========= */
function AppInner() {
  const { address, isConnected, status } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, status: connectStatus } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: balance } = useBalance({
    address: address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!address },
  });

  const [pickerOpen, setPickerOpen] = useState(false);

  const walletItems = useMemo(
    () => connectors.map((c) => ({ id: c.id, label: c.name })),
    [connectors]
  );

  const pickWallet = async (connectorId: string) => {
    try {
      const c = connectors.find((x) => x.id === connectorId);
      if (!c) return;
      await connect({ connector: c });
      try { await switchChain({ chainId: MONAD_CHAIN_ID }); } catch {}
      setPickerOpen(false);
    } catch (e: any) {
      console.error(e);
      alert(e?.shortMessage || e?.message || "Connect failed");
    }
  };

  return (
    <div className="page">
      {/* Topbar */}
      <header className="topbar">
        <div className="brand">
          <div className="logo">🐣</div>
          <div className="title">Wooligotchi</div>
        </div>

        {!isConnected ? (
          <button className="btn btn-primary" onClick={() => setPickerOpen(true)}>
            Connect (WalletConnect)
          </button>
        ) : (
          <div className="walletRow">
            <span className="pill">
              {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—"}
            </span>
            <span className="pill">Chain: {chainId ?? "—"}</span>
            <span className="muted">
              {balance ? `${Number(balance.formatted).toFixed(4)} ${balance.symbol}` : "—"}
            </span>
            <button className="btn ghost" onClick={() => disconnect()}>
              Disconnect
            </button>
          </div>
        )}
      </header>

      <section className="card" style={{ maxWidth: 680, margin: "0 auto" }}>
        <div className="splash-inner">
          <div className="splash-title" style={{ marginBottom: 10 }}>Send NFT by tokenId</div>
          <div className="muted">Direct safeTransferFrom → Vault (Monad 10143)</div>
          <div style={{ marginTop: 12 }}>
            <SendByIdPanel />
          </div>
        </div>
      </section>

      <footer className="foot">
        <span className="muted">Status: {status}</span>
      </footer>

      {/* Wallet picker */}
      {pickerOpen && !isConnected && (
        <div onClick={() => setPickerOpen(false)} className="modal">
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ width: 460, maxWidth: "92vw" }}
          >
            <div className="title" style={{ fontSize: 20, marginBottom: 10, color: "white" }}>
              Connect a wallet (WalletConnect)
            </div>

            <div className="wallet-grid">
              {connectors.map((c) => (
                <button
                  key={c.id}
                  onClick={() => pickWallet(c.id)}
                  disabled={connectStatus === "pending"}
                  className="btn btn-ghost"
                  style={{ width: "100%" }}
                >
                  {c.name}
                </button>
              ))}
            </div>

            <div className="helper" style={{ marginTop: 10 }}>
              Scan the QR with Phantom / OKX / Rainbow / etc. Make sure the session is on Monad (10143).
            </div>

            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setPickerOpen(false)} className="btn">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <AppInner />
    </WagmiProvider>
  );
}
