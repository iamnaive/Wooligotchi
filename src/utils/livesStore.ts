// Simple local lives store. Replace with on-chain registry later.
// Comments in English only.

const KEY = "wg_lives_v1";

export type LivesMap = Record<string, number>; // key = "<chainId>:<address>"

function k(chainId: number, address: string) {
  return `${chainId}:${address.toLowerCase()}`;
}

export function getLives(chainId: number, address?: string | null) {
  if (!address) return 0;
  const raw = localStorage.getItem(KEY);
  const map: LivesMap = raw ? JSON.parse(raw) : {};
  return map[k(chainId, address)] ?? 0;
}

export function addLives(chainId: number, address: string, delta = 1) {
  const raw = localStorage.getItem(KEY);
  const map: LivesMap = raw ? JSON.parse(raw) : {};
  const key = k(chainId, address);
  map[key] = (map[key] ?? 0) + delta;
  localStorage.setItem(KEY, JSON.stringify(map));
  return map[key];
}
