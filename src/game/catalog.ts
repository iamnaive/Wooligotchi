// src/game/catalog.ts
/** Types consumed by App and Tamagotchi */
export type AnimSet = {
  idle: string[];
  walk: string[];
};
export type FormKey =
  | "egg"
  | "egg_adult"
  | "char1"
  | "char1_adult"
  | "char2"
  | "char2_adult"
  | "char3"
  | "char3_adult"
  | "char4"
  | "char4_adult";

/** Egg uses your existing files in /public/sprites/egg/ */
const egg: AnimSet = {
  idle: ["/sprites/egg/idle_1.png"], // add more if you have
  walk: [
    "/sprites/egg/walk_1.png",
    "/sprites/egg/walk_2.png",
    "/sprites/egg/walk_3.png",
  ],
};

/** Safe stubs for not-yet-provided forms (place real files later) */
function stub(prefix: string): AnimSet {
  return {
    idle: [`${prefix}/idle_1.png`], // put a real idle_1.png later
    walk: [`${prefix}/walk_1.png`], // or reuse idle_1.png if needed
  };
}

/** Full catalog */
export const catalog: Record<FormKey, AnimSet> = {
  egg,
  egg_adult: stub("/sprites/egg_adult"),
  char1: stub("/sprites/char1"),
  char1_adult: stub("/sprites/char1_adult"),
  char2: stub("/sprites/char2"),
  char2_adult: stub("/sprites/char2_adult"),
  char3: stub("/sprites/char3"),
  char3_adult: stub("/sprites/char3_adult"),
  char4: stub("/sprites/char4"),
  char4_adult: stub("/sprites/char4_adult"),
};
