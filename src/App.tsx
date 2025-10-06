// src/App.tsx
// WalletConnect-only + inline SendByIdPanel.
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
  useWriteContract,
} from "wagmi";
import { walletConnect } from "wagmi/connectors";
import { defineChain, Address, parseAbi } from "viem";

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
      // @ts-ignore enforce 10143 for the session
      requiredChains: [MONAD_CHAIN_ID],
    }),
  ],
  ssr: false,
});

/* ========= INLINE: SendByIdPanel ========= */
function SendByIdPanel() {
  // env addresses
  const COLLECTION_ADDRESS = String(import.meta.env.VITE_COLLECTION_ADDRESS || "").toLowerCase() as Address;
  const VAULT_ADDRESS      = String(import.meta.env.VITE_VAULT_ADDRESS || "").toLowerCase() as Address;

  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const ERC721_ABI = parseAbi([
    "function safeTransferFrom(address from, address to, uint256 tokenId) external"
  ]);

  const [rawId, setRawId] = useState("");
  const tokenId = useMemo(() => {
    const s = rawId.trim();
    if (!s) return null;
    if (/^0x[0-9a-fA-F]+$/.test(s)) return BigInt(s);
    if (/^\d+$/.test(s)) return BigInt(s.replace(/^0+/, "") || "0");
    return null;
  }, [rawId]);

  const [sending, setSending] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function mapError(e: any): string {
    const t = String(e?.shortMessage || e?.message || e || "").toLowerCase();
    if (e?.code === 4001 || t.includes("user rejected")) return "You rejected the transaction in wallet.";
    if (t.includes("insufficient funds")) return "Not enough MON to pay gas.";
    if (t.includes("mismatch") || t.includes("wrong network") || t.includes("chain of the wallet"))
      return "Wrong network. Switch to Monad testnet (10143).";
    if (t.includes("non erc721receiver")) return "Vault is not ERC721Receiver or wrong address.";
    if (t.includes("not token owner") || t.includes("not owner nor approved"))
      return "You are not the owner of this tokenId.";
    return e?.shortMessage || e?.message || "Failed.";
  }

  async function onSend() {
    setErr(null);
    setHash(null);
    if (!address) { setErr("Connect a wallet first."); return; }
    if (!COLLECTION_ADDRESS || !VAULT_ADDRESS) { setErr("Env addresses are not set."); return; }
    if (tokenId === null) { setErr("Invalid tokenId."); return; }

    if (chainId !== MONAD_CHAIN_ID) {
      try { await switchChain({ chainId: MONAD_CHAIN_ID }); }
      catch { setErr("Wrong network. Switch to Monad testnet (10143)."); return; }
    }

    try {
      setSending(true);
      const tx = await writeContractAsync({
        address: COLLECTION_ADDRESS,
        abi: ERC721_ABI,
        functionName: "safeTransferFrom",
        args: [address, VAULT_ADDRESS, tokenId],
        chainId: MONAD_CHAIN_ID,
        account: address,
        gas: 120_000n, // explicit gas for Monad
      });
      setHash(tx as string);

      try {
        window.dispatchEvent(
          new CustomEvent("wg:nft-confirmed", {
            detail: { address, collection: COLLECTION_ADDRESS, tokenId: Number(tokenId), txHash: tx, chainId: MONAD_CHAIN_ID }
          })
        );
      } catch {}
    } catch (e: any) {
      setErr(mapError(e));
    } finally {
      setSending(false);
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
        <div style={{ fontWeight: 800, fontSize: 18 }}>Send NFT by ID</div>
        <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
          Collection → Vault on Monad Testnet (10143)
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
          Make sure your WalletConnect session is on Monad Testnet.
        </div>
      </div>

      <button
        disabled={!address || tokenId === null || sending}
        onClick={onSend}
        className="w-full rounded-xl py-3 transition"
        style={{
          marginTop: 12,
          background: !address || tokenId === null || sending ? "#2a2a2f" : "linear-gradient(90deg,#7c4dff,#00c8ff)",
          color: "#fff",
          boxShadow: !address || tokenId === null || sending ? "none" : "0 8px 22px rgba(124,77,255,0.35)",
          opacity: sending ? 0.85 : 1,
          cursor: !address || tokenId === null || sending ? "not-allowed" : "pointer",
        }}
      >
        {sending ? "Sending…" : "Send to Vault"}
      </button>

      {hash && (
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
          Tx: <code>{hash.slice(0, 12)}…{hash.slice(-10)}</code>
        </div>
      )}
      {err && <div style={{ color: "#ff6b6b", fontSize: 12, marginTop: 6 }}>{err}</div>}
    </div>
  );
}

/* ========= UI shell ========= */
function AppInner() {
  const { address, isConnected, status } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, status: connectStatus } = useConnect();
  const { disconnect } = useDisconnect();
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
      setPickerOpen(false);
    } catch (e: any) {
      console.error(e);
      alert(e?.shortMessage || e?.message || "Connect failed");
    }
  };

  return (
    <div className="page">
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
              Scan the QR with Phantom / OKX / Rainbow / etc. The session will target chain 10143.
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

/* ========= Root ========= */
export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <AppInner />
    </WagmiProvider>
  );
}
