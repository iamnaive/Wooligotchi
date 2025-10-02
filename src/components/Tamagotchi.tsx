// src/components/Tamagotchi.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimSet, FormKey, catalog } from "../game/catalog";

/** Canvas-based pixel renderer with DPR-aware scaling and alpha-safe draw. */
/** Props match your existing App.tsx usage. */
export default function Tamagotchi({
  currentForm,
  onEvolve,
}: {
  currentForm: FormKey;
  onEvolve?: () => FormKey | void;
}) {
  // Scene logical size (kept crisp regardless of CSS size)
  const LOGICAL_W = 320;
  const LOGICAL_H = 180;
  const DEFAULT_FPS = 6;
  const WALK_SPEED = 36;

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [anim, setAnim] = useState<keyof AnimSet>("walk");

  // Build URL list (BG + current form frames)
  const urls = useMemo(() => {
    const set = new Set<string>();
    set.add("/bg/BG.png"); // your public/bg/BG.png
    const def = catalog[currentForm];
    Object.values(def).forEach((frames) => frames.forEach((u) => set.add(u)));
    return Array.from(set);
  }, [currentForm]);

  const images = usePreloadedImages(urls);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { alpha: true })!;
    (ctx as any).imageSmoothingEnabled = false;

    let raf = 0;
    let running = true;

    const fps = DEFAULT_FPS;
    const frameDuration = 1000 / fps;
    let frameTimer = 0;
    let frameIndex = 0;

    let lastTs = performance.now();
    let x = 40;
    let y = LOGICAL_H - 48;

    // Resize with DPR and keep aspect (nearest neighbor)
    const resize = () => {
      const wrap = wrapperRef.current!;
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      const w = wrap.clientWidth || LOGICAL_W;
      const h = wrap.clientHeight || LOGICAL_H;

      const targetAspect = LOGICAL_W / LOGICAL_H;
      const boxAspect = w / h;
      let cssW = w;
      let cssH = h;
      if (boxAspect > targetAspect) cssW = Math.round(h * targetAspect);
      else cssH = Math.round(w / targetAspect);

      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale((cssW * dpr) / LOGICAL_W, (cssH * dpr) / LOGICAL_H);
      (ctx as any).imageSmoothingEnabled = false;
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrapperRef.current!);
    resize();

    const loop = (ts: number) => {
      if (!running) return;
      const dt = Math.min(100, ts - lastTs);
      lastTs = ts;

      // Clear
      ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

      // BG draw when loaded (cover fit)
      const bg = images["/bg/BG.png"];
      if (bg) {
        const scale = Math.max(LOGICAL_W / bg.width, LOGICAL_H / bg.height);
        const drawW = Math.floor(bg.width * scale);
        const drawH = Math.floor(bg.height * scale);
        const dx = Math.floor((LOGICAL_W - drawW) / 2);
        const dy = Math.floor((LOGICAL_H - drawH) / 2);
        ctx.drawImage(bg, dx, dy, drawW, drawH);
      }

      // Frames for current anim (fallback to idle). Skip not-yet-loaded images.
      const def = catalog[currentForm];
      const frames = ((def[anim] && def[anim].length > 0) ? def[anim] : def.idle)
        .filter((u) => !!images[u]);

      // Advance sprite frame
      if (frames.length > 0) {
        frameTimer += dt;
        if (frameTimer >= frameDuration) {
          frameTimer -= frameDuration;
          frameIndex = (frameIndex + 1) % frames.length;
        }
      }

      // Move only in walk
      if (anim === "walk") {
        x += (WALK_SPEED * dt) / 1000;
        if (x > LOGICAL_W + 16) x = -16;
      }

      // Draw sprite only if image is loaded (prevents black boxes)
      if (frames.length > 0) {
        const img = images[frames[frameIndex]];
        if (img) {
          const w = img.width;
          const h = img.height;
          const ix = Math.round(x);
          const iy = Math.round(y - h);
          ctx.drawImage(img, ix, iy, w, h);
        }
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [images, currentForm, anim]);

  return (
    <section className="card" style={{ padding: 12 }}>
      <div
        ref={wrapperRef}
        style={{
          width: "100%",
          height: 360,           // you can tweak container height
          position: "relative",
          imageRendering: "pixelated",
          overflow: "hidden",
          borderRadius: 12,
          background: "transparent",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            imageRendering: "pixelated",
            background: "transparent",
            borderRadius: 12,
          }}
        />
        {/* small debug dock like in your UI */}
        <div
          style={{
            position: "absolute",
            left: 8,
            bottom: 8,
            display: "flex",
            gap: 8,
            fontSize: 12,
            padding: 6,
            borderRadius: 8,
            background: "rgba(0,0,0,0.35)",
            backdropFilter: "blur(4px)",
          }}
        >
          <button className="btn" onClick={() => setAnim((a) => (a === "walk" ? "idle" : "walk"))}>
            Toggle Walk/Idle
          </button>
          {!!onEvolve && (
            <button className="btn btn-primary" onClick={() => onEvolve()}>
              ⭐ Evolve (debug)
            </button>
          )}
          <span className="muted">Form: {currentForm}</span>
        </div>
      </div>
    </section>
  );
}

/** Preload helper (alpha-safe) */
function usePreloadedImages(urls: string[]) {
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({});
  useEffect(() => {
    let alive = true;
    Promise.allSettled(
      urls.map(
        (src) =>
          new Promise<[string, HTMLImageElement]>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve([src, img]);
            img.onerror = reject;
            img.src = src;
          })
      )
    ).then((res) => {
      if (!alive) return;
      const map: Record<string, HTMLImageElement> = {};
      res.forEach((r) => {
        if (r.status === "fulfilled") {
          const [src, img] = r.value;
          map[src] = img;
        }
      });
      setImages(map);
    });
    return () => {
      alive = false;
    };
  }, [urls.join("|")]);
  return images;
}
