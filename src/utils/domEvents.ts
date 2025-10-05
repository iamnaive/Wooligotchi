// Tiny helpers to emit/listen custom DOM events consistently.

export function emit(name: string, detail?: any) {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {}
}

export function on(name: string, cb: (ev: CustomEvent) => void) {
  const handler = (ev: Event) => cb(ev as CustomEvent);
  window.addEventListener(name, handler as any);
  return () => window.removeEventListener(name, handler as any);
}
