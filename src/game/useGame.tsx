import React, { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import { GameState, PetConfig } from "./types";
import { SAVE_KEY, TICK_MS, POOP_CHANCE_PER_MIN } from "./constants";
import { applyNeedsDecay, doAction } from "./petMachine";
import { useOneLife, getLives } from "./lives";

type Action =
  | { type: "TICK"; now: number }
  | { type: "DO"; do: "feed"|"play"|"sleep"|"clean"|"heal" }
  | { type: "SET_ANIM"; name: GameState["activeAnim"] }
  | { type: "REVIVE" };

function initialState(): GameState {
  const saved = localStorage.getItem(SAVE_KEY);
  if (saved) {
    try { return JSON.parse(saved) as GameState; } catch {}
  }
  return {
    version: 1,
    pet: "idle",
    hasPoop: false,
    activeAnim: "idle",
    lastTick: Date.now(),
    needs: { hunger: 80, hygiene: 80, fun: 80, energy: 80, health: 100 },
  };
}

function reducer(s: GameState, a: Action): GameState {
  const ns: GameState = { ...s, needs: { ...s.needs } };

  switch (a.type) {
    case "TICK": {
      const dtMs = a.now - ns.lastTick;
      if (dtMs <= 0) return ns;
      ns.lastTick = a.now;
      const minutes = dtMs / 60000;

      // шанс «каки»
      if (!ns.hasPoop && Math.random() < (POOP_CHANCE_PER_MIN * minutes)) {
        ns.hasPoop = true;
        ns.pet = "pooping";
        ns.activeAnim = "poop";
      }
      return applyNeedsDecay(ns, minutes);
    }
    case "DO": {
      return doAction(ns, a.do);
    }
    case "SET_ANIM": {
      ns.activeAnim = a.name; return ns;
    }
    case "REVIVE": {
      ns.pet = "idle"; ns.activeAnim = "idle";
      ns.needs = { hunger: 60, hygiene: 60, fun: 60, energy: 60, health: 60 };
      ns.hasPoop = false; ns.lastTick = Date.now();
      return ns;
    }
  }
}

const GameCtx = createContext<{
  state: GameState;
  dispatch: React.Dispatch<Action>;
  config: PetConfig;
} | null>(null);

export function GameProvider({ children, config }: { children: React.ReactNode; config: PetConfig }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  // игровой цикл
  useEffect(() => {
    let raf = 0, acc = 0, last = performance.now();
    const loop = (t: number) => {
      const dt = t - last; last = t; acc += dt;
      while (acc >= TICK_MS) {
        dispatch({ type: "TICK", now: Date.now() });
        acc -= TICK_MS;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // автосейв
  useEffect(() => {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  }, [state]);

  const value = useMemo(() => ({ state, dispatch, config }), [state, config]);
  return <GameCtx.Provider value={value}>{children}</GameCtx.Provider>;
}

export function useGame() {
  const ctx = useContext(GameCtx);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}

/** Потратить «жизнь» и воскресить */
export function useReviveWithLife(chainId: number, address?: string | null) {
  const can = getLives(chainId, address) > 0;
  const revive = () => useOneLife(chainId, address);
  return { can, revive };
}
