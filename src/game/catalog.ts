// src/game/catalog.ts
// Catalog that matches folder structure /public/sprites/<form>/<anim>/<NNN>.png

export type AnimKey = "idle" | "walk" | "sick" | "sad" | "sleep" | "unhappy";
export type FormKey =
  | "egg"
  | "chog_child" | "molandak_child" | "moyaki_child" | "we_child"
  | "Chog" | "Molandak" | "Moyaki" | "WE";

export type AnimSet = Partial<Record<AnimKey, string[]>>;

const f = (form: string, anim: AnimKey, frames: string[]) =>
  frames.map(n => `/sprites/${form}/${anim}/${n}.png`);

const ONE = ["000"];
const TWO = ["000", "001"]; // walk prefers 2+ frames

export const catalog: Record<FormKey, AnimSet> = {
  egg:            { idle: f("egg","idle",ONE),            walk: f("egg","walk",TWO),            sick: f("egg","sick",ONE),            sad: f("egg","sad",ONE),            sleep: f("egg","sleep",ONE) },
  chog_child:     { idle: f("chog_child","idle",ONE),     walk: f("chog_child","walk",TWO),     sick: f("chog_child","sick",ONE),     sad: f("chog_child","sad",ONE),     sleep: f("chog_child","sleep",ONE) },
  molandak_child: { idle: f("molandak_child","idle",ONE), walk: f("molandak_child","walk",TWO), sick: f("molandak_child","sick",ONE), sad: f("molandak_child","sad",ONE), sleep: f("molandak_child","sleep",ONE) },
  moyaki_child:   { idle: f("moyaki_child","idle",ONE),   walk: f("moyaki_child","walk",TWO),   sick: f("moyaki_child","sick",ONE),   sad: f("moyaki_child","sad",ONE),   sleep: f("moyaki_child","sleep",ONE) },
  we_child:       { idle: f("we_child","idle",ONE),       walk: f("we_child","walk",TWO),       sick: f("we_child","sick",ONE),       sad: f("we_child","sad",ONE),       sleep: f("we_child","sleep",ONE) },
  Chog:           { idle: f("Chog","idle",ONE),           walk: f("Chog","walk",TWO),           sick: f("Chog","sick",ONE),           sad: f("Chog","sad",ONE),           sleep: f("Chog","sleep",ONE) },
  Molandak:       { idle: f("Molandak","idle",ONE),       walk: f("Molandak","walk",TWO),       sick: f("Molandak","sick",ONE),       sad: f("Molandak","sad",ONE),       sleep: f("Molandak","sleep",ONE) },
  Moyaki:         { idle: f("Moyaki","idle",ONE),         walk: f("Moyaki","walk",TWO),         sick: f("Moyaki","sick",ONE),         sad: f("Moyaki","sad",ONE),         sleep: f("Moyaki","sleep",ONE) },
  WE:             { idle: f("WE","idle",ONE),             walk: f("WE","walk",TWO),             sick: f("WE","sick",ONE),             sad: f("WE","sad",ONE),             sleep: f("WE","sleep",ONE) },
};
