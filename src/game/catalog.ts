// src/game/catalog.ts
export type AnimKey = "idle" | "walk" | "sick" | "sad" | "sleep" | "unhappy";
export type FormKey =
  | "egg"
  | "chog_child" | "molandak_child" | "moyaki_child" | "we_child"
  | "Chog" | "Molandak" | "Moyaki" | "WE"
  // legacy aliases:
  | "char1" | "char1_adult"
  | "char2" | "char2_adult"
  | "char3" | "char3_adult"
  | "char4" | "char4_adult";

export type AnimSet = Partial<Record<AnimKey, string[]>>;

function f(form: string, anim: AnimKey, frames: string[]) {
  return frames.map(n => `/sprites/${form}/${anim}/${n}.png`);
}

const ONE   = ["000"];
const TWO   = ["000","001"];

const egg: AnimSet = {
  idle: f("egg","idle",ONE),
  walk: f("egg","walk",TWO),
  sick: f("egg","sick",ONE),
  sad:  f("egg","sad",ONE),
  sleep:f("egg","sleep",ONE),
};

const chog_child: AnimSet      = { idle: f("chog_child","idle",ONE), walk: f("chog_child","walk",TWO), sick: f("chog_child","sick",ONE), sad: f("chog_child","sad",ONE), sleep: f("chog_child","sleep",ONE) };
const molandak_child: AnimSet  = { idle: f("molandak_child","idle",ONE), walk: f("molandak_child","walk",TWO), sick: f("molandak_child","sick",ONE), sad: f("molandak_child","sad",ONE), sleep: f("molandak_child","sleep",ONE) };
const moyaki_child: AnimSet    = { idle: f("moyaki_child","idle",ONE), walk: f("moyaki_child","walk",TWO), sick: f("moyaki_child","sick",ONE), sad: f("moyaki_child","sad",ONE), sleep: f("moyaki_child","sleep",ONE) };
const we_child: AnimSet        = { idle: f("we_child","idle",ONE),     walk: f("we_child","walk",TWO),     sick: f("we_child","sick",ONE),     sad: f("we_child","sad",ONE),     sleep: f("we_child","sleep",ONE) };

const Chog: AnimSet      = { idle: f("Chog","idle",ONE),      walk: f("Chog","walk",TWO),      sick: f("Chog","sick",ONE),      sad: f("Chog","sad",ONE),      sleep: f("Chog","sleep",ONE) };
const Molandak: AnimSet  = { idle: f("Molandak","idle",ONE),  walk: f("Molandak","walk",TWO),  sick: f("Molandak","sick",ONE),  sad: f("Molandak","sad",ONE),  sleep: f("Molandak","sleep",ONE) };
const Moyaki: AnimSet    = { idle: f("Moyaki","idle",ONE),    walk: f("Moyaki","walk",TWO),    sick: f("Moyaki","sick",ONE),    sad: f("Moyaki","sad",ONE),    sleep: f("Moyaki","sleep",ONE) };
const WE: AnimSet        = { idle: f("WE","idle",ONE),        walk: f("WE","walk",TWO),        sick: f("WE","sick",ONE),        sad: f("WE","sad",ONE),        sleep: f("WE","sleep",ONE) };

// Export with legacy aliases so old keys keep working
export const catalog: Record<FormKey, AnimSet> = {
  egg,
  chog_child, molandak_child, moyaki_child, we_child,
  Chog, Molandak, Moyaki, WE,

  // legacy → new
  char1: chog_child,
  char1_adult: Chog,
  char2: molandak_child,
  char2_adult: Molandak,
  char3: moyaki_child,
  char3_adult: Moyaki,
  char4: we_child,
  char4_adult: WE,
};
