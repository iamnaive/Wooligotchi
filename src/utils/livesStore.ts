// src/utils/livesStore.ts
// Simple local lives store. Replace with an on-chain registry later.
// Comments in English only.

const KEY = "wg_lives_v1";

type LivesMap = Record<string, number>; // "<chainId>:<address>" -> lives

function key(chainId: number, addr: string) {
  return `${chainId}:${addr.toLowerCase()}`;
}

export function getLives(chainId: number, addr?: string | null) {
  if (!addr) return 0;
  const raw = localStorage.getItem(KEY);
  const map: LivesMap = raw ? JSON.parse(raw) : {};
  return map[key(chainId, addr)] ?? 0;
}

export function addLives(chainId: number, addr: string, delta = 1) {
  const raw = localStorage.getItem(KEY);
  const map: LivesMap = raw ? JSON.parse(raw) : {};
  const k = key(chainId, addr);
  map[k] = (map[k] ?? 0) + delta;
  localStorage.setItem(KEY, JSON.stringify(map));
  return map[k];
}
