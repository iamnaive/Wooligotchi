export const DECAY_PER_MIN = {
  hunger: 8,
  hygiene: 6,
  fun: 5,
  energy: 4,
} as const;

export const HEALTH_DECAY_IF = {
  hungerBelow: 20,
  hygieneBelow: 20,
  funBelow: 10,
  energyBelow: 10,
  perMin: 10,
};

export const TICK_MS = 1000;              // игровой тик
export const POOP_CHANCE_PER_MIN = 0.6;   // шанс каки/мин
export const SAVE_KEY = "wgt_v1_game";
