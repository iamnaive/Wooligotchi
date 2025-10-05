// src/game/useGame.tsx
import React, { createContext, useContext } from "react";
import type { AnimSet } from "./catalog";

export type GameConfig = { name: string; fps?: number; anims: AnimSet };

const GameCtx = createContext<GameConfig | null>(null);

export function GameProvider({
  config,
  children,
}: {
  config: GameConfig;
  children: React.ReactNode;
}) {
  return <GameCtx.Provider value={config}>{children}</GameCtx.Provider>;
}

export function useGame(): GameConfig {
  const ctx = useContext(GameCtx);
  if (!ctx) throw new Error("useGame must be used within <GameProvider>");
  return ctx;
}
