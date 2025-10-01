const LIVES_KEY = "wg_lives_v1";
const lKey = (cid:number, addr:string)=>`${cid}:${addr.toLowerCase()}`;

export function getLives(cid:number, addr?:string|null){
  if (!addr) return 0;
  const raw = localStorage.getItem(LIVES_KEY);
  const map = raw ? JSON.parse(raw) as Record<string, number> : {};
  return map[lKey(cid, addr)] ?? 0;
}
export function setLives(cid:number, addr:string, v:number){
  const raw = localStorage.getItem(LIVES_KEY);
  const map = raw ? JSON.parse(raw) as Record<string, number> : {};
  map[lKey(cid, addr)] = v;
  localStorage.setItem(LIVES_KEY, JSON.stringify(map));
}
export function useOneLife(cid:number, addr?:string|null){
  if (!addr) return false;
  const raw = localStorage.getItem(LIVES_KEY);
  const map = raw ? JSON.parse(raw) as Record<string, number> : {};
  const key = lKey(cid, addr);
  const cur = map[key] ?? 0;
  if (cur > 0){ map[key] = cur - 1; localStorage.setItem(LIVES_KEY, JSON.stringify(map)); return true; }
  return false;
}
