import React, { useMemo } from "react";
import { useAccount } from "wagmi";
import Sprite from "./Sprite";
import PixelViewport from "./PixelViewport";
import { useGame, useReviveWithLife } from "../game/useGame";

const MONAD_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 10143);

/** Tamagotchi scene:
 *  - .avatar (purple frame): static portrait/sprite
 *  - .stage  (red frame): PixelViewport 320×180 (upscales with integer factor)
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

        {/* Stage (red): fixed logical 320×180, integer upscaling, no blur */}
        <div className="stage">
          <PixelViewport width={320} height={180} className="stage-viewport">
            {/* This is the logical 320×180 plane. Use absolute coords in this space. */}
            {/* Example background grid (remove later): */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(#10162b 1px, transparent 1px) 0 0 / 16px 16px, linear-gradient(90deg,#10162b 1px, transparent 1px) 0 0 / 16px 16px, #0e1426",
              }}
            />
            {/* Example character placeholder at x=20,y=100: */}
            <div
              style={{
                position: "absolute",
                left: 20,
                top: 100,
                width: 32,
                height: 32,
                imageRendering: "pixelated",
              }}
            >
              <img
                src={config.anims.idle[0]}
                alt=""
                style={{ width: "100%", height: "100%", imageRendering: "pixelated" }}
              />
            </div>
          </PixelViewport>
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
