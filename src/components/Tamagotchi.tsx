import React, { useMemo } from "react";
import { useAccount } from "wagmi";
import Sprite from "./Sprite";
import { useGame, useReviveWithLife } from "../game/useGame";
import { PetConfig } from "../game/types";

const MONAD_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);

export default function Tamagotchi() {
  const { address } = useAccount();
  const { state, dispatch, config } = useGame();
  const { can, revive } = useReviveWithLife(MONAD_CHAIN_ID, address);

  const frames = useMemo(() => {
    const a = config.anims;
    switch (state.activeAnim) {
      case "eat":   return a.eat;
      case "play":  return a.play;
      case "sleep": return a.sleep;
      case "sick":  return a.sick;
      case "poop":  return a.poop;
      case "clean": return a.clean;
      case "die":   return a.die;
      default:      return a.idle;
    }
  }, [state.activeAnim, config]);

  const stat = (label: string, v: number) => (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{
        height: 8, borderRadius: 999, background: "#14192e",
        border: "1px solid #222846", overflow: "hidden"
      }}>
        <div style={{
          width: `${Math.max(0, Math.min(100, v))}%`,
          height: "100%",
          background: `linear-gradient(90deg,#7c4dff,#22b35b)`,
          boxShadow: "0 0 10px rgba(124,77,255,.35) inset"
        }} />
      </div>
    </div>
  );

  return (
    <section className="card" style={{ marginTop: 12 }}>
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{config.name}</span>
        <span className="pill">{state.pet.toUpperCase()}</span>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "160px 1fr", gap: 16, alignItems: "center"
      }}>
        <div style={{
          display: "grid", placeItems: "center",
          borderRadius: 16, background: "linear-gradient(180deg,#12172a,#0e1426)",
          border: "1px solid #232846", height: 200
        }}>
          <Sprite frames={frames} fps={config.fps ?? 8} loop={state.pet !== "dead"} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {stat("Hunger", state.needs.hunger)}
          {stat("Hygiene", state.needs.hygiene)}
          {stat("Fun", state.needs.fun)}
          {stat("Energy", state.needs.energy)}
          {stat("Health", state.needs.health)}
          <div style={{ display: "grid", alignContent: "end" }}>
            {state.hasPoop ? <span className="pill">💩 Needs cleaning</span> : <span className="muted">All clean</span>}
          </div>
        </div>
      </div>

      {state.pet !== "dead" ? (
        <div className="mt-3" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button className="btn" onClick={() => dispatch({ type: "DO", do: "feed" })}>🍗 Feed</button>
          <button className="btn" onClick={() => dispatch({ type: "DO", do: "play" })}>🎮 Play</button>
          <button className="btn" onClick={() => dispatch({ type: "DO", do: "sleep" })}>
            {state.pet === "sleeping" ? "🌞 Wake" : "😴 Sleep"}
          </button>
          <button className="btn" onClick={() => dispatch({ type: "DO", do: "clean" })}>🧼 Clean</button>
          <button className="btn" onClick={() => dispatch({ type: "DO", do: "heal" })}>💊 Heal</button>
        </div>
      ) : (
        <div className="mt-3" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted">Your pet has passed away…</span>
          {can ? (
            <button className="btn btn-primary" onClick={() => {
              if (revive()) dispatch({ type: "REVIVE" });
            }}>❤️ Revive (–1 life)</button>
          ) : (
            <span className="pill">No lives left</span>
          )}
        </div>
      )}
    </section>
  );
}
