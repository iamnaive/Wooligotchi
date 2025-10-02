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
          url:
            typeof window !== "undefined"
              ? window.location.origin
              : "https://example.com",
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

/* ===== Helpers ===== */
function short(addr?: `0x${string}`) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/* ===== Lives gate ===== */
const LIVES_KEY = "wg_lives_v1";
const lKey = (cid:number, addr:string)=>`${cid}:${addr.toLowerCase()}`;
function getLivesLocal(cid:number, addr?:`0x${string}`|null){
  if (!addr) return 0;
  try {
    const raw = localStorage.getItem(LIVES_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return map[lKey(cid, addr)] ?? 0;
  } catch { return 0; }
}
function useLivesGate(chainId:number, address?:`0x${string}`|null){
  const [lives, setLives] = React.useState(0);
  React.useEffect(()=>{
    setLives(getLivesLocal(chainId, address));
    const onStorage = (e: StorageEvent)=>{
      if (e.key === LIVES_KEY) setLives(getLivesLocal(chainId, address));
    };
    const onCustom = ()=> setLives(getLivesLocal(chainId, address));
    window.addEventListener('storage', onStorage);
    window.addEventListener('wg:lives-changed', onCustom as any);
    return ()=>{ window.removeEventListener('storage', onStorage); window.removeEventListener('wg:lives-changed', onCustom as any); };
  }, [chainId, address]);
  return lives;
}

/* ===== PetConfig adapter ===== */
type PetConfig = {
  name: string;
  fps?: number;
  anims: AnimSet;
};
function makeConfigFromForm(form: FormKey): PetConfig {
  return { name: "Tamagotchi", fps: 8, anims: catalog[form] };
}

/* ===== Evolution logic ===== */
const FORM_KEY_STORAGE = "wg_form_v1";
function loadForm(): FormKey {
  const raw = localStorage.getItem(FORM_KEY_STORAGE);
  if (raw && (raw as any)) return raw as FormKey;
  return "egg";
}
function saveForm(f: FormKey) {
  localStorage.setItem(FORM_KEY_STORAGE, f);
}
function nextFormRandom(current: FormKey): FormKey {
  // egg -> egg_adult
  if (current === "egg") return "egg_adult";
  // egg_adult -> random char1..char4
  if (current === "egg_adult") {
    const pool: FormKey[] = ["char1","char2","char3","char4"];
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return pick;
  }
  // charN -> charN_adult
  const map: Record<FormKey, FormKey> = {
    egg: "egg_adult",
    egg_adult: "char1", // not used here due to branch above
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

/* ===== Wallet Picker ===== */
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
    <div onClick={onClose} className="modal">
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: 460, maxWidth: "92vw" }}>
        <div className="title" style={{ fontSize: 20, marginBottom: 10, color: "white" }}>Connect a wallet</div>
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

/* ===== Splash ===== */
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

/* ===== MAIN APP ===== */
function AppInner() {
  const { address, isConnected, status } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, status: connectStatus } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: balance } = useBalance({ address, chainId, query: { enabled: !!address } });
  const [pickerOpen, setPickerOpen] = useState(false);
  const lives = useLivesGate(MONAD_CHAIN_ID, address);

  // Active form with persistence
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
      try { await switchChain({ chainId: MONAD_CHAIN_ID }); } catch {}
      setPickerOpen(false);
    } catch (e: any) {
      console.error(e);
      alert(e?.shortMessage || e?.message || "Connect failed");
    }
  };

  // Expose evolve action (can be called from the game UI)
  const evolve = React.useCallback(() => {
    const next = nextFormRandom(form);
    setForm(next);
    return next;
  }, [form]);

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
            <span className="pill">{address ? `${address.slice(0,6)}…${address.slice(-4)}` : "—"}</span>
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

      {/* Start / gate */}
      {!isConnected ? (
        <Splash>
          <div style={{ display:"flex", justifyContent:"center", gap:12, marginTop:10 }}>
            <button className="btn btn-primary btn-lg" onClick={()=>setPickerOpen(true)}>Connect wallet</button>
          </div>
        </Splash>
      ) : lives <= 0 ? (
        <Splash>
          <div className="muted">Send 1 NFT → get 1 life</div>
          <VaultPanel mode="cta" />
        </Splash>
      ) : (
        <>
          {/* Game */}
          <GameProvider config={petConfig}>
            <Tamagotchi
              currentForm={form}
              onEvolve={evolve}   // game can call to evolve; random branch handled here
            />
          </GameProvider>
        </>
      )}

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

export default function App() {
  return (
    <WagmiProvider config={config}>
      <AppInner />
    </WagmiProvider>
  );
}
