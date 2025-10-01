import { GameState } from "./types";
import { DECAY_PER_MIN, HEALTH_DECAY_IF } from "./constants";

export function clamp01(x: number) {
  return Math.max(0, Math.min(100, x));
}

export function applyNeedsDecay(s: GameState, minutes: number) {
  const m = minutes;

  s.needs.hunger  = clamp01(s.needs.hunger  - m * DECAY_PER_MIN.hunger);
  s.needs.hygiene = clamp01(s.needs.hygiene - m * (s.hasPoop ? DECAY_PER_MIN.hygiene * 1.6 : DECAY_PER_MIN.hygiene));
  s.needs.fun     = clamp01(s.needs.fun     - m * DECAY_PER_MIN.fun);
  s.needs.energy  = clamp01(s.needs.energy  - (s.pet === "sleeping" ? -m * 20 : m * DECAY_PER_MIN.energy)); // во сне +энергия

  const bad =
    (s.needs.hunger  < HEALTH_DECAY_IF.hungerBelow)  ||
    (s.needs.hygiene < HEALTH_DECAY_IF.hygieneBelow) ||
    (s.needs.fun     < HEALTH_DECAY_IF.funBelow)     ||
    (s.needs.energy  < HEALTH_DECAY_IF.energyBelow);

  if (bad) {
    s.needs.health = clamp01(s.needs.health - m * HEALTH_DECAY_IF.perMin);
    if (s.needs.health < 30) s.pet = "sick";
  } else {
    s.needs.health = clamp01(s.needs.health + m * 5);
    if (s.needs.health > 60 && s.pet === "sick") s.pet = "idle";
  }

  if (s.needs.health <= 0) {
    s.pet = "dead";
    s.activeAnim = "die";
  }
  return s;
}

export function doAction(s: GameState, a: "feed" | "play" | "sleep" | "clean" | "heal"): GameState {
  if (s.pet === "dead") return s;

  switch (a) {
    case "feed":
      s.needs.hunger = clamp01(s.needs.hunger + 40);
      s.pet = "eating"; s.activeAnim = "eat";
      break;
    case "play":
      s.needs.fun = clamp01(s.needs.fun + 35);
      s.needs.energy = clamp01(s.needs.energy - 10);
      s.pet = "playing"; s.activeAnim = "play";
      break;
    case "sleep":
      s.pet = s.pet === "sleeping" ? "idle" : "sleeping";
      s.activeAnim = s.pet === "sleeping" ? "sleep" : "idle";
      break;
    case "clean":
      s.hasPoop = false;
      s.needs.hygiene = clamp01(s.needs.hygiene + 45);
      s.pet = "idle"; s.activeAnim = "clean";
      break;
    case "heal":
      s.needs.health = clamp01(s.needs.health + 40);
      s.pet = "idle"; s.activeAnim = "sick";
      break;
  }
  return s;
}
