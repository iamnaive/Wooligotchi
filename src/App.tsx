import React, { useEffect, useState } from "react";
import Tamagotchi from "./components/Tamagotchi";
import DeathOverlay from "./components/DeathOverlay";
import VaultPanel from "./components/VaultPanel";
import { addLives, getLives, subscribeLivesChanged } from "./utils/livesStore";
import { on } from "./utils/domEvents";

// NOTE: Replace with wagmi useAccount().address in your app
function useMockAddress() {
  const [addr] = useState<string>("0xDEADBEEF0000000000000000000000000000FEED");
  return addr;
}

export default function App() {
  const address = useMockAddress();

  const [lives, setLives] = useState<number>(() => getLives(address));
  const [deadFlag, setDeadFlag] = useState(false);
  const [deathReason, setDeathReason] = useState<string | null>(null);

  // Sync lives across tabs/updates
  useEffect(() => {
    const unsub = subscribeLivesChanged(() => setLives(getLives(address)));
    return unsub;
  }, [address]);

  // Listen for pet death (show overlay)
  useEffect(() => {
    const off = on("wg:pet-dead", (ev) => {
      setDeadFlag(true);
      setDeathReason(ev.detail?.reason || null);
    });
    return off;
  }, []);

  // After NFT confirmed -> grant +1 life (consumption already happened at death)
  useEffect(() => {
    const off = on("wg:nft-confirmed", (ev) => {
      addLives(address, 1);
      setLives(getLives(address));
      // Tamagotchi listens to this too and performs hard reset.
      // Optional: you can also close overlay immediately:
      setDeadFlag(false);
      setDeathReason(null);
    });
    return off;
  }, [address]);

  function onContinueRequest() {
    // Pure UI hook: user sees overlay -> presses CTA.
    // VaultPanel is on the page; you can scroll/focus it if desired.
    const el = document.getElementById("vault-panel");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="min-h-screen w-full" style={{ background: "#0e0e10", color: "#ddd" }}>
      <div className="max-w-5xl mx-auto p-4">
        <div className="flex justify-between items-center mb-3">
          <div className="text-lg font-semibold">Wooligotchi</div>
          <div className="text-sm opacity-90">Lives: <b>{lives}</b></div>
        </div>

        <Tamagotchi walletAddress={address} />

        <div id="vault-panel" className="mt-4">
          <VaultPanel mode="full" />
        </div>

        <DeathOverlay
          visible={deadFlag}
          reason={deathReason || undefined}
          lives={lives}
          onContinueRequest={onContinueRequest}
        />
      </div>
    </div>
  );
}
