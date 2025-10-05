export function emit(name: string, detail?: any) {
  try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch {}
}
export function on(name: string, cb: (ev: CustomEvent) => void) {
  const h = (ev: Event) => cb(ev as CustomEvent);
  window.addEventListener(name, h as any);
  return () => window.removeEventListener(name, h as any);
}
