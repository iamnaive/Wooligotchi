import React, { useMemo } from "react";
import { useAccount } from "wagmi";
import Sprite from "./Sprite";
import PixelViewport from "./PixelViewport";
import StageWalker from "./StageWalker";
import { useGame, useReviveWithLife } from "../game/useGame";
import { STAGE_BG } from "../game/catalog";

/** Props allow App to control evolution branching and persistence */
export default function Tamagotchi({
  currentForm,
  onEvolve,
}: {
  currentForm: string;
  onEvolve?: () => string; // returns new form
}) {
  const { address } = useAccount();
  const { state, dispatch, config } = useGame();
  const { can, revive } = useReviveWithLife(Number(import.meta.env.VITE_CHAIN_ID ?? 10143), address);

  const frames = useMemo(() => {
    const a = config.anims;
    switch (state.activeAnim) {
      case "eat":   return a.eat ?? a.idle;
      case "play":  return a.play ?? a.idle;
      case "sleep": return a.sleep ?? a.idle;
      case "sick":  return a.sick ?? a.idle;
      case "poop":  return a.poop ?? a.idle;
      case "clean": return a.clean ?? a.idle;
      case "die":   return a.die ?? a.idle;
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
          <Sprite frames={config.anims.avatar ?? config.anims.idle} fps={config.fps ?? 8} loop />
        </div>

        {/* Stage (red): 320×180, background + walking actor */}
        <div className="stage">
          <PixelViewport width={320} height={180} className="stage-viewport">
            <img
              src={STAGE_BG}
              alt=""
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "fill",
                imageRendering: "pixelated",
              }}
            />

            <StageWalker
              frames={config.anims.walk ?? config.anims.idle}
              spriteW={32}
              spriteH={32}
              speed={26}
              left={8}
              right={312}
              y={164}
              auto
              fps={8}
            />
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

              {/* Temporary debug: force evolution to next stage (random branching is in App) */}
              {onEvolve && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const nf = onEvolve();
                    console.log("Evolved to:", nf);
                  }}
                >
                  ⭐ Evolve (debug)
                </button>
              )}
              <span className="pill">Form: {currentForm}</span>
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
