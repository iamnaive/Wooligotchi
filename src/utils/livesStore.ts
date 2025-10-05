// Unified local lives store (single source of truth).
// Keyed by lowercase wallet address. Emits 'wg:lives-changed' on updates.

const LS_KEY = "wg_lives_v1";
const LS_DEATH_SPENT_KEY = "wg_life_spent_for_death_v1";

type LivesMap = Record<string, number>;
type DeathSpentMap = Record<string, number>; // address -> last deathAt timestamp

function readAll(): LivesMap {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return typeof obj === "object" && obj ? (obj as LivesMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: LivesMap) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {}
  dispatchLivesChanged();
}

function readSpent(): DeathSpentMap {
  try {
    return JSON.parse(localStorage.getItem(LS_DEATH_SPENT_KEY) || "{}") as DeathSpentMap;
  } catch {
    return {};
  }
}

function writeSpent(map: DeathSpentMap) {
  try {
    localStorage.setItem(LS_DEATH_SPENT_KEY, JSON.stringify(map));
  } catch {}
}

function dispatchLivesChanged() {
  try {
    window.dispatchEvent(new CustomEvent("wg:lives-changed"));
  } catch {}
}

export function getLives(address?: string | null): number {
  const addr = (address || "").toLowerCase();
  if (!addr) return 0;
  const all = readAll();
  return Math.max(0, Number(all[addr] || 0));
}

export function setLives(address: string | null | undefined, value: number) {
  const addr = (address || "").toLowerCase();
  if (!addr) return;
  const all = readAll();
  all[addr] = Math.max(0, Math.floor(value));
  writeAll(all);
}

export function addLives(address: string | null | undefined, delta: number) {
  const current = getLives(address);
  setLives(address, current + Math.floor(delta));
}

export function spendLife(address: string | null | undefined): boolean {
  const current = getLives(address);
  if (current <= 0) return false;
  setLives(address, current - 1);
  return true;
}

// Spend exactly one life for a concrete death moment (idempotent per address+deathAt)
export function spendLifeForDeath(address: string | null | undefined, deathAt: number): boolean {
  const addr = (address || "").toLowerCase();
  if (!addr) return false;
  const spent = readSpent();
  if (spent[addr] === deathAt) return true; // already accounted

  const ok = spendLife(address);
  if (ok) {
    spent[addr] = deathAt;
    writeSpent(spent);
  }
  return ok;
}

export function subscribeLivesChanged(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener("wg:lives-changed", handler);
  return () => window.removeEventListener("wg:lives-changed", handler);
}
