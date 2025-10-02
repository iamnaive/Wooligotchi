// src/game/catalog.ts
// Forms + animation sets that match folder structure /sprites/<form>/<anim>/<NNN>.png

export type AnimKey = "idle" | "walk" | "sick" | "sad" | "sleep" | "unhappy";
export type FormKey =
  | "egg"
  | "chog_child" | "molandak_child" | "moyaki_child" | "we_child"
  | "Chog" | "Molandak" | "Moyaki" | "WE";

// Each form can have a partial set of animations
export type AnimSet = Partial<Record<AnimKey, string[]>>;

/** Build frame paths like /sprites/<form>/<anim>/000.png, 001.png, ... */
function frames(form: string, anim: AnimKey, names: string[]): string[] {
  return names.map((n) => `/sprites/${form}/${anim}/${n}.png`);
}

// Convenience for common patterns
const ONE   = ["000"];              // single frame
const TWO   = ["000", "001"];       // 2-frame walk
const THREE = ["000", "001", "002"];

// ==== EGG (you have /sprites/egg/idle/000.png, /sprites/egg/walk/000.png, etc.)
const egg: AnimSet = {
  idle: frames("egg", "idle", ONE),
  walk: frames("egg", "walk", TWO),      // если нет 001.png — не страшно
  sick: frames("egg", "sick", ONE),      // если нет — можешь удалить строку
  sad:  frames("egg", "sad",  ONE),
  sleep:frames("egg", "sleep", ONE),
};

// ==== CHILD FORMS
const chog_child: AnimSet = {
  idle: frames("chog_child", "idle", ONE),
  walk: frames("chog_child", "walk", TWO),
  sick: frames("chog_child", "sick", ONE),
  sad:  frames("chog_child", "sad",  ONE),
  sleep:frames("chog_child", "sleep", ONE),
};
const molandak_child: AnimSet = {
  idle: frames("molandak_child", "idle", ONE),
  walk: frames("molandak_child", "walk", TWO),
  sick: frames("molandak_child", "sick", ONE),
  sad:  frames("molandak_child", "sad",  ONE),
  sleep:frames("molandak_child", "sleep", ONE),
};
const moyaki_child: AnimSet = {
  idle: frames("moyaki_child", "idle", ONE),
  walk: frames("moyaki_child", "walk", TWO),
  sick: frames("moyaki_child", "sick", ONE),
  sad:  frames("moyaki_child", "sad",  ONE),
  sleep:frames("moyaki_child", "sleep", ONE),
};
const we_child: AnimSet = {
  idle: frames("we_child", "idle", ONE),
  walk: frames("we_child", "walk", TWO),
  sick: frames("we_child", "sick", ONE),
  sad:  frames("we_child", "sad",  ONE),
  sleep:frames("we_child", "sleep", ONE),
};

// ==== ADULT FORMS
const Chog: AnimSet = {
  idle: frames("Chog", "idle", ONE),
  walk: frames("Chog", "walk", TWO),
  sick: frames("Chog", "sick", ONE),
  sad:  frames("Chog", "sad",  ONE),
  sleep:frames("Chog", "sleep", ONE),
};
const Molandak: AnimSet = {
  idle: frames("Molandak", "idle", ONE),
  walk: frames("Molandak", "walk", TWO),
  sick: frames("Molandak", "sick", ONE),
  sad:  frames("Molandak", "sad",  ONE),
  sleep:frames("Molandak", "sleep", ONE),
};
const Moyaki: AnimSet = {
  idle: frames("Moyaki", "idle", ONE),
  walk: frames("Moyaki", "walk", TWO),
  sick: frames("Moyaki", "sick", ONE),
  sad:  frames("Moyaki", "sad",  ONE),
  sleep:frames("Moyaki", "sleep", ONE),
};
const WE: AnimSet = {
  idle: frames("WE", "idle", ONE),
  walk: frames("WE", "walk", TWO),
  sick: frames("WE", "sick", ONE),
  sad:  frames("WE", "sad",  ONE),
  sleep:frames("WE", "sleep", ONE),
};

// ==== Export full catalog
export const catalog: Record<FormKey, AnimSet> = {
  egg,
  chog_child,
  molandak_child,
  moyaki_child,
  we_child,
  Chog,
  Molandak,
  Moyaki,
  WE,
};
