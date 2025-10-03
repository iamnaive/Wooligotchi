import React, { useMemo, useState, useEffect } from "react";
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
import Tamagotchi from "./components/Tamagotchi";
import { GameProvider } from "./game/useGame";
import { AnimSet, FormKey, catalog } from "./game/catalog";
import "./styles.css";

/* ===== ENV ===== */
const MONAD_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);
const RPC_URL = String(import.meta.env.VITE_RPC_URL ?? "https://testnet-rpc.monad.xyz");
const WC_ID = String(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "");

/* ===== CHAIN ===== */
const MONAD = defineChain({
  id: MONAD_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
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
          name: "Wooligotchi",
          description: "Tamagotchi mini-app on Monad",
          url: typeof window !== "undefined" ? window.location.origin : "https://example.com",
          icons: ["https://raw.githubusercontent.com/twitter/twemoji/master/assets/svg/1f423.svg"],
        },
      })
    : null,
  coinbaseWallet({ appName: "Wooligotchi" }),
].filter(Boolean);

/* ===== WAGMI CONFIG ===== */
const config = createConfig({
  chains: [MONAD],
  connectors: connectorsList as any,
  transports: { [MONAD.id]: http(RPC_URL) },
  ssr: false,
});

/* ===== Lives (1 NFT = 1 life) ===== */
const LIVES_KEY = "wg_lives_v1";
const lKey = (cid: number, addr: string) => `${cid}:${addr.toLowerCase()}`;

function getLivesLocal(cid: number, addr?: `0x${string}` | null) {
  if (!addr) return 0;
  try {
    const raw = localStorage.getItem(LIVES_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return map[lKey(cid, addr)] ?? 0;
  } catch {
    return 0;
  }
}
function spendOneLife(chainId: number | undefined, address?: `0x${string}` | null) {
  const cid = chainId ?? MONAD_CHAIN_ID;
  if (!address) return;
  try {
    const raw = localStorage.getItem(LIVES_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const key = lKey(cid, address);
    const cur = map[key] ?? 0;
    if (cur > 0) {
      map[key] = cur - 1;
      localStorage.setItem(LIVES_KEY, JSON.stringify(map));
      window.dispatchEvent(new Event("wg:lives-changed"));
    }
  } catch (e) {
    console.error("spendOneLife failed", e);
  }
}
function grantLives(chainId: number | undefined, address?: `0x${string}` | null, count = 1) {
  const cid = chainId ?? MONAD_CHAIN_ID;
  if (!address || count <= 0) return;
  try {
    const key = lKey(cid, address);
    const raw = localStorage.getItem(LIVES_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    map[key] = (map[key] ?? 0) + count;
    localStorage.setItem(LIVES_KEY, JSON.stringify(map));
    window.dispatchEvent(new Event("wg:lives-changed"));
  } catch (e) {
    console.error("grantLives failed", e);
  }
}

/* ===== PetConfig ===== */
type PetConfig = { name: string; fps?: number; anims: AnimSet };
function makeConfigFromForm(form: FormKey): PetConfig {
  return { name: "Tamagotchi", fps: 8, anims: catalog[form] };
}

/* ===== Evolution placeholders ===== */
const FORM_KEY_STORAGE = "wg_form_v1";
function loadForm(): FormKey {
  return (localStorage.getItem(FORM_KEY_STORAGE) as FormKey) || "egg";
}
function saveForm(f: FormKey) {
  localStorage.setItem(FORM_KEY_STORAGE, f);
}

/* ===== MAIN APP ===== */
function AppInner() {
  const { address, isConnected, status } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, status: connectStatus } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: balance } = useBalance({ address, chainId, query: { enabled: !!address } });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [vaultModal, setVaultModal] = useState(false);

  const lives = useLivesGate(chainId, address);

  // держим игру смонтированной после смерти, чтобы показать оверлей
  const [forceGame, setForceGame] = useState(false);
  useEffect(() => {
    const onDead = () => setForceGame(true);
    const onNew = () => setForceGame(false);
    const onRequestNft = () => setVaultModal(true);
    const onConfirmed = (e: any) => {
      const from = (e?.detail?.address as `0x${string}` | undefined) || address;
      grantLives(chainId, from, 1);
      setVaultModal(false);
    };
    window.addEventListener("wg:pet-dead", onDead as any);
    window.addEventListener("wg:new-game", onNew as any);
    window.addEventListener("wg:request-nft", onRequestNft as any);
    window.addEventListener("wg:nft-confirmed", onConfirmed as any);
    return () => {
      window.removeEventListener("wg:pet-dead", onDead as any);
      window.removeEventListener("wg:new-game", onNew as any);
      window.removeEventListener("wg:request-nft", onRequestNft as any);
      window.removeEventListener("wg:nft-confirmed", onConfirmed as any);
    };
  }, [chainId, address]);

  // Form state
  const [form, setForm] = useState<FormKey>(() => loadForm());
  useEffect(() => { saveForm(form); }, [form]);
  const petConfig = useMemo(() => makeConfigFromForm(form), [form]);

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
          alert("No browser wallet detected. Install MetaMask/Phantom or use WalletConnect (QR).");
          return;
        }
      }
      await connect({ connector: c });
      try {
        await switchChain({ chainId: MONAD_CHAIN_ID });
      } catch {}
      setPickerOpen(false);
    } catch (e: any) {
      console.error(e);
      alert(e?.shortMessage || e?.message || "Connect failed");
    }
  };

  const evolve = React.useCallback((next?: FormKey) => {
    const n = next ?? form;
    setForm(n);
    return n;
  }, [form]);

  // Gate:
  const gate: "splash" | "locked" | "game" =
    !isConnected ? "splash" : lives <= 0 && !forceGame ? "locked" : "game";

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
            Connect Wallet
          </button>
        ) : (
          <div className="walletRow">
            <span className="pill">Lives: {lives}</span>
            <span className="pill">
              {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—"}
            </span>
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

      {/* Gates */}
      {gate === "splash" && (
        <section className="card splash">
          <div className="splash-inner">
            <div className="splash-title">Wooligotchi</div>
            <div className="muted">A tiny on-chain Tamagotchi</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 10 }}>
              <button className="btn btn-primary btn-lg" onClick={() => setPickerOpen(true)}>
                Connect wallet
              </button>
            </div>
          </div>
        </section>
      )}

      {gate === "locked" && (
        <section className="card splash">
          <div className="splash-inner">
            <div className="splash-title">Wooligotchi</div>
            <div className="muted">Send 1 NFT → get 1 life</div>
            <VaultPanel mode="cta" />
          </div>
        </section>
      )}

      {gate === "game" && (
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          <div className="muted" style={{ margin: "8px 0" }}>
            Game mounted · form: {form}
          </div>
          <GameProvider config={petConfig}>
            <Tamagotchi
              key={address || "no-wallet"}
              currentForm={form}
              onEvolve={evolve}
              lives={lives}
              onLoseLife={() => spendOneLife(chainId, address)}
              walletAddress={address || undefined}
            />
          </GameProvider>
        </div>
      )}

      <footer className="foot">
        <span className="muted">Status: {status}</span>
      </footer>

      {/* Wallet picker */}
      {pickerOpen && !isConnected && (
        <div onClick={() => setPickerOpen(false)} className="modal">
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: 460, maxWidth: "92vw" }}>
            <div className="title" style={{ fontSize: 20, marginBottom: 10, color: "white" }}>
              Connect a wallet
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
                  {c.name === "Injected" ? "Browser wallet (MetaMask / Phantom / OKX …)" : c.name}
                </button>
              ))}
            </div>
            <div className="helper" style={{ marginTop: 10 }}>
              WalletConnect opens a QR for mobile wallets (Phantom, Rainbow, OKX, etc.).
            </div>
            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setPickerOpen(false)} className="btn">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vault CTA modal (открывается по wg:request-nft из оверлея смерти) */}
      {vaultModal && (
        <div className="modal" onClick={() => setVaultModal(false)}>
          <div className="card" style={{ width: 520, maxWidth: "92vw" }} onClick={(e)=>e.stopPropagation()}>
            <div className="title" style={{ fontSize: 18, marginBottom: 8 }}>1 NFT → +1 life</div>
            <VaultPanel mode="cta" />
            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
              <button className="btn" onClick={()=>setVaultModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== lives hook ===== */
function useLivesGate(chainId: number | undefined, address?: `0x${string}` | null) {
  const [lives, setLives] = React.useState(0);
  React.useEffect(() => {
    const cid = chainId ?? MONAD_CHAIN_ID;
    const read = () => setLives(getLivesLocal(cid, address));
    read();
    const onStorage = (e: StorageEvent) => {
      if (e.key === LIVES_KEY) read();
    };
    const onCustom = () => read();
    window.addEventListener("storage", onStorage);
    window.addEventListener("wg:lives-changed", onCustom as any);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("wg:lives-changed", onCustom as any);
    };
  }, [chainId, address]);
  return lives;
}

export default function App() {
  return (
    <WagmiProvider config={config}>
      <AppInner />
    </WagmiProvider>
  );
}
