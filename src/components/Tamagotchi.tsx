// src/components/Tamagotchi.tsx
import React, { useEffect, useMemo, useRef } from "react";
import { AnimSet, FormKey, catalog } from "../game/catalog";

/** Canvas-only renderer with bounce + horizontal flip at edges. */
export default function Tamagotchi({
  currentForm,
  onEvolve, // kept for compatibility (not used here)
}: {
  currentForm: FormKey;
  onEvolve?: () => FormKey | void;
}) {
  // Logical scene size (kept crisp with DPR scaling)
  const LOGICAL_W = 320;
  const LOGICAL_H = 180;
  const FPS = 6;
  const WALK_SPEED = 42;        // px/sec in logical units
  const GROUND_OFFSET = 48;     // distance from bottom to sprite baseline

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Preload list: background + frames of current form
  const urls = useMemo(() => {
    const set = new Set<string>();
    set.add("/bg/BG.png");
    const def = catalog[currentForm];
    Object.values(def).forEach((frames) => frames.forEach((u) => set.add(u)));
    return Array.from(set);
  }, [currentForm]);

  useEffect(() => {
    let alive = true;
    const loaders = urls.map(
      (src) =>
        new Promise<[string, HTMLImageElement]>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve([src, img]);
          img.onerror = reject;
          img.src = src;
        })
    );

    Promise.allSettled(loaders).then((res) => {
      if (!alive) return;

      const imgMap: Record<string, HTMLImageElement> = {};
      res.forEach((r) => {
        if (r.status === "fulfilled") {
          const [src, img] = r.value;
          imgMap[src] = img;
        }
      });

      run(imgMap);
    });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls.join("|")]);

  const run = (images: Record<string, HTMLImageElement>) => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { alpha: true })!;
    (ctx as any).imageSmoothingEnabled = false;

    // Animation state
    const frameDuration = 1000 / FPS;
    let frameTimer = 0;
    let frameIndex = 0;

    // Movement & facing
    let dir: 1 | -1 = 1; // 1 = right, -1 = left
    let x = 40;          // sprite anchor X (left when facing right)
    const y = LOGICAL_H - GROUND_OFFSET;

    // Safe drawing bounds (so sprite не «вылетает» за края)
    const def = catalog[currentForm];
    const sampleImg =
      images[(def.walk[0] ?? def.idle[0]) as string] ||
      images["/bg/BG.png"]; // just to have width/height for calc
    const spriteW = sampleImg ? sampleImg.width : 32;
    const minX = 0;
    const maxX = LOGICAL_W - spriteW;

    // Prepare frame URLs filtered by loaded images
    const walkFrames = (def.walk.length ? def.walk : def.idle).filter(
      (u) => !!images[u]
    );
    const idleFrames = def.idle.filter((u) => !!images[u]);
    const frames = walkFrames.length ? walkFrames : idleFrames;

    // Resize with DPR and keep aspect
    const resize = () => {
      const wrap = wrapRef.current!;
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      const w = wrap.clientWidth || LOGICAL_W;
      const h = wrap.clientHeight || LOGICAL_H;

      const target = LOGICAL_W / LOGICAL_H;
      const box = w / h;
      let cssW = w;
      let cssH = h;
      if (box > target) cssW = Math.round(h * target);
      else cssH = Math.round(w / target);

      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale((cssW * dpr) / LOGICAL_W, (cssH * dpr) / LOGICAL_H);
      (ctx as any).imageSmoothingEnabled = false;
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current!);
    resize();

    let last = performance.now();
    let raf = 0;

    const loop = (ts: number) => {
      const dt = Math.min(100, ts - last);
      last = ts;

      // Clear scene
      ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

      // Draw background (cover fit)
      const bg = images["/bg/BG.png"];
      if (bg) {
        const scale = Math.max(LOGICAL_W / bg.width, LOGICAL_H / bg.height);
        const dw = Math.floor(bg.width * scale);
        const dh = Math.floor(bg.height * scale);
        const dx = Math.floor((LOGICAL_W - dw) / 2);
        const dy = Math.floor((LOGICAL_H - dh) / 2);
        ctx.drawImage(bg, dx, dy, dw, dh);
      }

      // Advance frame timer
      if (frames.length) {
        frameTimer += dt;
        if (frameTimer >= frameDuration) {
          frameTimer -= frameDuration;
          frameIndex = (frameIndex + 1) % frames.length;
        }
      }

      // Move and bounce
      x += dir * (WALK_SPEED * dt) / 1000;
      if (x < minX) {
        x = minX;
        dir = 1; // turn right
      } else if (x > maxX) {
        x = maxX;
        dir = -1; // turn left
      }

      // Draw sprite (with horizontal flip when dir = -1)
      const img = frames.length ? images[frames[frameIndex]] : undefined;
      if (img) {
        const w = img.width;
        const h = img.height;

        ctx.save();
        if (dir === -1) {
          // Flip around sprite center for crisp pixels
          const cx = Math.round(x + w / 2);
          ctx.translate(cx, 0);
          ctx.scale(-1, 1);
          ctx.translate(-cx, 0);
        }
        const ix = Math.round(x);
        const iy = Math.round(y - h);
        ctx.drawImage(img, ix, iy, w, h);
        ctx.restore();
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  };

  // IMPORTANT: no extra wrappers/controls — so your old UI stays intact
  return (
    <div
      ref={wrapRef}
      style={{
        width: "100%",
        height: 360,           // keep your layout; adjust if needed
        position: "relative",
        imageRendering: "pixelated",
        overflow: "hidden",
        background: "transparent",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          imageRendering: "pixelated",
          background: "transparent",
        }}
      />
    </div>
  );
}
