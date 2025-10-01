export type NeedKey = "hunger" | "hygiene" | "fun" | "energy" | "health";

export type PetState =
  | "idle"
  | "eating"
  | "playing"
  | "pooping"
  | "dirty"
  | "sleeping"
  | "sick"
  | "dead";

export type AnimMap = {
  idle: string[];
  eat: string[];
  play: string[];
  sleep: string[];
  sick: string[];
  poop: string[];
  clean: string[];
  die: string[];
  // можешь добавлять свои ключи
};

export type GameState = {
  version: 1;
  pet: PetState;
  needs: Record<NeedKey, number>;  // 0..100
  hasPoop: boolean;
  lastTick: number;                // ms
  activeAnim: keyof AnimMap;
};

export type PetConfig = {
  name: string;
  fps?: number;
  anims: AnimMap;
};
