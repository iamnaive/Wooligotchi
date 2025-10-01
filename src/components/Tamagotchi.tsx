import React, { useMemo } from "react";
import { useAccount } from "wagmi";
import Sprite from "./Sprite";
import { useGame, useReviveWithLife } from "../game/useGame";

const MONAD_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);

/** Tamagotchi scene composed of:
 *  - .avatar (purple frame): static portrait/sprite
 *  - .stage  (red frame): background area for walk cycles
 *  - .hud    (yellow frame): actions and status bars
 */
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

  const Stat = ({ label, v }: { label:string; v:number }) => (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-bar">
        <div className="stat-fill" style={{width:`${Math.max(0, Math.min(100, v))}%`}} />
      </div>
    </div>
  );

  return (
    <section className="game-shell">
      <div className="card-title">Tamagotchi</div>

      <div className="game-grid">
        {/* Avatar (purple) */}
        <div className="avatar">
          <Sprite frames={config.anims.idle} fps={config.fps ?? 8} loop />
        </div>

        {/* Stage (red) — place walking/background here later */}
        <div className="stage">
          {/* Placeholder for future walking animation */}
          <div style={{
            position:"absolute", inset:0, display:"grid", placeItems:"center",
            color:"#a3a7be", fontSize:12
          }}>
            Stage / background (character will walk here)
          </div>
        </div>

        {/* HUD (yellow) */}
        <div className="hud">
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12}}>
            <Stat label="Hunger"  v={state.needs.hunger} />
            <Stat label="Hygiene" v={state.needs.hygiene} />
            <Stat label="Fun"     v={state.needs.fun} />
            <Stat label="Energy"  v={state.needs.energy} />
            <Stat label="Health"  v={state.needs.health} />
            <div style={{ display:"grid", alignContent:"end" }}>
              {state.hasPoop ? <span className="pill">💩 Needs cleaning</span> : <span className="muted">All clean</span>}
            </div>
          </div>

          {state.pet !== "dead" ? (
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              <button className="btn" onClick={() => dispatch({ type: "DO", do: "feed" })}>🍗 Feed</button>
              <button className="btn" onClick={() => dispatch({ type: "DO", do: "play" })}>🎮 Play</button>
              <button className="btn" onClick={() => dispatch({ type: "DO", do: "sleep" })}>
                {state.pet === "sleeping" ? "🌞 Wake" : "😴 Sleep"}
              </button>
              <button className="btn" onClick={() => dispatch({ type: "DO", do: "clean" })}>🧼 Clean</button>
              <button className="btn" onClick={() => dispatch({ type: "DO", do: "heal" })}>💊 Heal</button>
            </div>
          ) : (
            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
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
        </div>
      </div>
    </section>
  );
}
