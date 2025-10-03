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

// Read lives from localStorage for current chain/account
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

// Subscribe to changes
function useLivesGate(chainId: number | undefined, address?: `0x${string}` | null) {
  const [lives, setLives] = React.useState(0);
  React.useEffect(() => {
    const cid = chainId ?? MONAD_CHAIN_ID;
    setLives(getLivesLocal(cid, address));
    const onStorage = (e: StorageEvent) => {
      if (e.key === LIVES_KEY) setLives(getLivesLocal(cid, address));
    };
    const onCustom = () => setLives(getLivesLocal(cid, address));
    window.addEventListener("storage", onStorage);
    window.addEventListener("wg:lives-changed", onCustom as any);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("wg:lives-changed", onCustom as any);
    };
  }, [chainId, address]);
  return lives;
}

// Decrease lives by one and notify listeners
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

// Increase lives and notify listeners
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

/* ===== Evolution placeholders (kept from your build) ===== */
const FORM_KEY_STORAGE = "wg_form_v1";
function loadForm(): FormKey {
  return (localStorage.getItem(FORM_KEY_STORAGE) as FormKey) || "egg";
}
function saveForm(f: FormKey) {
  localStorage.setItem(FORM_KEY_STORAGE, f);
}
function nextFormRandom(current: FormKey): FormKey {
  if (current === "egg") return "egg_adult";
  if (current === "egg_adult") {
    const pool: FormKey[] = ["char1", "char2", "char3", "char4"];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const map: Record<FormKey, FormKey> = {
    egg: "egg_adult",
    egg_adult: "char1",
    char1: "char1_adult",
    char1_adult: "char1_adult",
    char2: "char2_adult",
    char2_adult: "char2_adult",
    char3: "char3_adult",
    char3_adult: "char3_adult",
    char4: "char4_adult",
    char4_adult: "char4_adult",
  };
  return map[current] ?? current;
}

/* ===== Error Boundary ===== */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { err: any }> {
  constructor(props: any) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err: any) {
    return { err };
  }
  componentDidCatch(err: any, info: any) {
    console.error("UI crash:", err, info);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="card" style={{ margin: "16px auto", maxWidth: 880 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Render error</div>
          <div style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 12 }}>
            {String(this.state.err?.message || this.state.err)}
          </div>
        </div>
      );
    }
    return this.props.children as any;
  }
}

/* ===== Small helpers ===== */
function Splash({ children }: { children?: React.ReactNode }) {
  return (
    <section className="card splash">
      <div className="splash-inner">
        <div className="splash-title">Wooligotchi</div>
        <div className="muted">A tiny on-chain Tamagotchi</div>
        {children}
      </div>
    </section>
  );
}

function DebugHUD({
  gate,
  lives,
  isConnected,
  address,
  chainId,
}: {
  gate: "splash" | "locked" | "game";
  lives: number;
  isConnected: boolean;
  address?: `0x${string}` | null;
  chainId?: number;
}) {
  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        padding: "6px 10px",
        background: "rgba(0,0,0,0.45)",
        border: "1px solid rgba(255,255,255,0.2)",
        borderRadius: 8,
        fontSize: 12,
        zIndex: 9999,
      }}
    >
      <div>
        gate: <b>{gate}</b>
      </div>
      <div>
        lives: <b>{lives}</b> | connected: <b>{String(isConnected)}</b>
      </div>
      <div>addr: {address ?? "—"}</div>
      <div>chainId: {chainId ?? "—"}</div>
    </div>
  );
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

  // Lives from local storage
  const lives = useLivesGate(chainId, address);

  // Keep game mounted after death even if lives = 0 (so DeathOverlay is visible)
  const [forceGame, setForceGame] = useState(false);
 // Держим игру смонтированной и на новый старт фиксируем форму = "egg"
useEffect(() => {
  const onDead = () => setForceGame(true);
  const onNew = () => {
    setForceGame(false);
    setForm("egg");
    saveForm("egg"); // <- чтобы локалсторедж тоже обновился
  };
  window.addEventListener("wg:pet-dead", onDead as any);
  window.addEventListener("wg:new-game", onNew as any);
  return () => {
    window.removeEventListener("wg:pet-dead", onDead as any);
    window.removeEventListener("wg:new-game", onNew as any);
  };
}, []);


 // After on-chain confirmation of NFT transfer — grant exactly 1 life
useEffect(() => {
  const onConfirmed = (e: any) => {
    const from = (e?.detail?.address as `0x${string}` | undefined) || address;
    grantLives(chainId, from, 1);
  };
  window.addEventListener("wg:nft-confirmed", onConfirmed as any);
  return () => window.removeEventListener("wg:nft-confirmed", onConfirmed as any);
}, [chainId, address]);


  // Form state (kept as-is)
  const [form, setForm] = useState<FormKey>(() => loadForm());
  useEffect(() => {
    saveForm(form);
  }, [form]);
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
  if (next && catalog[next]) {
    setForm(next);   // сохраняем форму, пришедшую из Tamagotchi
    return next;
  }
  return next as any;
}, []);

  // Gate:
  // - splash: not connected
  // - locked: connected but no lives AND not in forceGame (first time)
  // - game: otherwise
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
        <Splash>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 10 }}>
            <button className="btn btn-primary btn-lg" onClick={() => setPickerOpen(true)}>
              Connect wallet
            </button>
          </div>
        </Splash>
      )}

      {gate === "locked" && (
        <Splash>
          <div className="muted">Send 1 NFT → get 1 life</div>
          {/* Ensure VaultPanel shows FULL contract and FULL sender address */}
          <VaultPanel mode="cta" showFullAddresses />
        </Splash>
      )}

      {gate === "game" && (
        <ErrorBoundary>
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
        </ErrorBoundary>
      )}

      <footer className="foot">
        <span className="muted">Status: {status}</span>
      </footer>

      {/* Wallet picker */}
      <div>
        {pickerOpen && !isConnected && (
          <div onClick={() => setPickerOpen(false)} className="modal">
            <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: 460, maxWidth: "92vw" }}>
              <div className="title" style={{ fontSize: 20, marginBottom: 10, color: "white" }}>
                Connect a wallet
              </div>
              <div className="wallet-grid">
                {walletItems.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => pickWallet(i.id)}
                    disabled={connectStatus === "pending"}
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
                <button onClick={() => setPickerOpen(false)} className="btn">
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Debug HUD */}
      <DebugHUD gate={gate} lives={lives} isConnected={isConnected} address={address} chainId={chainId} />
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
