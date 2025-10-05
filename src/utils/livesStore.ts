// Unified local lives store (single source of truth). Address-scoped.
// Emits 'wg:lives-changed' on updates.

const LS_KEY = "wg_lives_v1";
const LS_DEATH_SPENT_KEY = "wg_life_spent_for_death_v1";

type LivesMap = Record<string, number>;
type DeathSpentMap = Record<string, number>; // address -> last deathAt

function readAll(): LivesMap {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}") as LivesMap; } catch { return {}; }
}
function writeAll(map: LivesMap) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch {}
  try { window.dispatchEvent(new CustomEvent("wg:lives-changed")); } catch {}
}

function readSpent(): DeathSpentMap {
  try { return JSON.parse(localStorage.getItem(LS_DEATH_SPENT_KEY) || "{}") as DeathSpentMap; } catch { return {}; }
}
function writeSpent(map: DeathSpentMap) {
  try { localStorage.setItem(LS_DEATH_SPENT_KEY, JSON.stringify(map)); } catch {}
}

export function getLives(address?: string | null): number {
  const a = (address || "").toLowerCase();
  if (!a) return 0;
  const all = readAll();
  return Math.max(0, Number(all[a] || 0));
}
export function setLives(address: string | null | undefined, v: number) {
  const a = (address || "").toLowerCase();
  if (!a) return;
  const all = readAll();
  all[a] = Math.max(0, Math.floor(v));
  writeAll(all);
}
export function addLives(address: string | null | undefined, d: number) {
  setLives(address, getLives(address) + Math.floor(d));
}
export function spendLife(address: string | null | undefined): boolean {
  const cur = getLives(address);
  if (cur <= 0) return false;
  setLives(address, cur - 1);
  return true;
}

// Idempotent life spend for a specific death moment (address + deathAt)
export function spendLifeForDeath(address: string | null | undefined, deathAt: number): boolean {
  const a = (address || "").toLowerCase();
  if (!a) return false;
  const spent = readSpent();
  if (spent[a] === deathAt) return true; // already spent for this death
  const ok = spendLife(address);
  if (ok) { spent[a] = deathAt; writeSpent(spent); }
  return ok;
}

export function subscribeLivesChanged(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener("wg:lives-changed", h);
  return () => window.removeEventListener("wg:lives-changed", h);
}
