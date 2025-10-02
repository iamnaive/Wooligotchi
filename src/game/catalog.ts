// Catalog of all forms and their animations.
// Put PNGs into public/sprites/<form>/... so they are available by /sprites/<form>/...
// Example:
//   public/sprites/egg_idle_1.png   ← (you can also group in subfolders like /egg/idle_1.png)
//   but recommended structure:
//   public/sprites/egg/idle_1.png
//   public/sprites/egg/walk_1.png
//   public/bg/BG.png

export type AnimSet = {
  idle: string[];
  walk?: string[];
  eat?: string[];
  play?: string[];
  sleep?: string[];
  sick?: string[];
  poop?: string[];
  clean?: string[];
  die?: string[];
  avatar?: string[]; // optional distinct portrait/loop for the Avatar tile
};

export type FormKey =
  | "egg"
  | "egg_adult"
  | "char1" | "char1_adult"
  | "char2" | "char2_adult"
  | "char3" | "char3_adult"
  | "char4" | "char4_adult";

export type PetCatalog = Record<FormKey, AnimSet>;

// Helper to make path arrays shorter
const P = (form: string, base: string, n: number) =>
  Array.from({ length: n }, (_, i) => `/sprites/${form}/${base}_${i + 1}.png`);

export const catalog: PetCatalog = {
  // Egg (baby)
  egg: {
    idle: P("egg", "idle", 2),            // /sprites/egg/idle_1.png, idle_2.png
    walk: P("egg", "walk", 3),            // /sprites/egg/walk_1.png .. walk_3.png
    avatar: P("egg", "idle", 2),
    // you can add more: eat/play/clean...
  },
  // Egg adult
  egg_adult: {
    idle: P("egg_adult", "idle", 2),
    walk: P("egg_adult", "walk", 3),
    avatar: P("egg_adult", "idle", 2),
  },

  // Character 1
  char1: {
    idle: P("char1", "idle", 2),
    walk: P("char1", "walk", 3),
    avatar: P("char1", "idle", 2),
  },
  char1_adult: {
    idle: P("char1_adult", "idle", 2),
    walk: P("char1_adult", "walk", 3),
    avatar: P("char1_adult", "idle", 2),
  },

  // Character 2
  char2: {
    idle: P("char2", "idle", 2),
    walk: P("char2", "walk", 3),
    avatar: P("char2", "idle", 2),
  },
  char2_adult: {
    idle: P("char2_adult", "idle", 2),
    walk: P("char2_adult", "walk", 3),
    avatar: P("char2_adult", "idle", 2),
  },

  // Character 3
  char3: {
    idle: P("char3", "idle", 2),
    walk: P("char3", "walk", 3),
    avatar: P("char3", "idle", 2),
  },
  char3_adult: {
    idle: P("char3_adult", "idle", 2),
    walk: P("char3_adult", "walk", 3),
    avatar: P("char3_adult", "idle", 2),
  },

  // Character 4
  char4: {
    idle: P("char4", "idle", 2),
    walk: P("char4", "walk", 3),
    avatar: P("char4", "idle", 2),
  },
  char4_adult: {
    idle: P("char4_adult", "idle", 2),
    walk: P("char4_adult", "walk", 3),
    avatar: P("char4_adult", "idle", 2),
  },
};

// Background of the stage.
// Put your file at public/bg/BG.png
export const STAGE_BG = "/bg/BG.png";
