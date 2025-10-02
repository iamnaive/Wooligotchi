// src/components/Tamagotchi.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimSet, FormKey, catalog } from "../game/catalog";

/** Canvas renderer with edge-bounce, horizontal flip, pixel-perfect scaling, and a small status bar strip. */
export default function Tamagotchi({
  currentForm,
  onEvolve, // kept for compatibility
}: {
  currentForm: FormKey;
  onEvolve?: () => FormKey | void;
}) {
  // ===== Scene logical size (kept crisp regardless of CSS size) =====
  const LOGICAL_W = 320;
  const LOGICAL_H = 180;
  const FPS = 6;
  const WALK_SPEED = 42; // px/sec in logical units

  // Per-form visual tweaks (scale and baseline nudge in logical px)
  const SCALE_MAP: Partial<Record<FormKey, number>> = {
    egg: 0.66,          // downscale big egg sprites
  };
  const BASELINE_NUDGE: Partial<Record<FormKey, number>> = {
    egg: +24,            // push slightly down so it "sits" on ground
  };

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Optional local anim (you can wire to your Game state later)
  const [anim, setAnim] = useState<keyof AnimSet>("walk");

  // ===== Preload list: background + frames of current form =====
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
      const images: Record<string, HTMLImageElement> = {};
      res.forEach((r) => {
        if (r.status === "fulfilled") {
          const [src, img] = r.value;
          images[src] = img;
        }
      });
      run(images);
    });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls.join("|"), currentForm, anim]);

  const run = (images: Record<string, HTMLImageElement>) => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { alpha: true })!;
    (ctx as any).imageSmoothingEnabled = false;

    const def = catalog[currentForm];
    const framesAll = (def[anim]?.length ? def[anim] : def.idle).filter((u) => !!images[u]);

    // Compute sprite base size and per-form scale
    const sample = framesAll.length ? images[framesAll[0]] : undefined;
    const baseW = sample?.width ?? 32;
    const baseH = sample?.height ?? 32;
    const SCALE = SCALE_MAP[currentForm] ?? 1.0;
    const drawW = Math.round(baseW * SCALE);
    const drawH = Math.round(baseH * SCALE);

    // Movement & facing
    const BASELINE = LOGICAL_H - 48 + (BASELINE_NUDGE[currentForm] ?? 0);
    let dir: 1 | -1 = 1;   // 1 = right, -1 = left
    let x = 40;            // left when facing right
    const minX = 0;
    const maxX = LOGICAL_W - drawW;

    // Animation timers
    const frameDuration = 1000 / FPS;
    let frameTimer = 0;
    let frameIndex = 0;

    // DPR-aware resize with preserved aspect and nearest-neighbor scaling
    const resize = () => {
      const wrap = wrapRef.current!;
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      const w = wrap.clientWidth || LOGICAL_W;
      const h = wrap.clientHeight || LOGICAL_H;

      const target = LOGICAL_W / LOGICAL_H;
      const box = w / h;
      let cssW = w, cssH = h;
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

      // Clear
      ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

      // Background (cover)
      const bg = images["/bg/BG.png"];
      if (bg) {
        const scale = Math.max(LOGICAL_W / bg.width, LOGICAL_H / bg.height);
        const dw = Math.floor(bg.width * scale);
        const dh = Math.floor(bg.height * scale);
        const dx = Math.floor((LOGICAL_W - dw) / 2);
        const dy = Math.floor((LOGICAL_H - dh) / 2);
        ctx.drawImage(bg, dx, dy, dw, dh);
      }

      // Advance animation
      if (framesAll.length) {
        frameTimer += dt;
        if (frameTimer >= frameDuration) {
          frameTimer -= frameDuration;
          frameIndex = (frameIndex + 1) % framesAll.length;
        }
      }

      // Move and bounce
      x += dir * (WALK_SPEED * dt) / 1000;
      if (x < minX) { x = minX; dir = 1; }
      else if (x > maxX) { x = maxX; dir = -1; }

      // Draw current frame (with horizontal flip when facing left)
      const src = framesAll.length ? framesAll[frameIndex] : undefined;
      const img = src ? images[src] : undefined;
      if (img) {
        ctx.save();
        if (dir === -1) {
          const cx = Math.round(x + drawW / 2);
          ctx.translate(cx, 0);
          ctx.scale(-1, 1);
          ctx.translate(-cx, 0);
        }
        const ix = Math.round(x);
        const iy = Math.round(BASELINE - drawH);
        // draw scaled to keep consistent size
        ctx.drawImage(img, ix, iy, drawW, drawH);
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

  return (
    <div>
      {/* Canvas only: won't disturb your surrounding layout */}
      <div
        ref={wrapRef}
        style={{
          width: "100%",
          height: 360,               // adjust to your layout
          position: "relative",
          imageRendering: "pixelated",
          overflow: "hidden",
          background: "transparent",
          borderRadius: 12,
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
      </div>

      {/* Minimal built-in bars so UI is visible again (replace with your state later) */}
      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        <Bar label="Hygiene" value={0.78} />
        <Bar label="Energy" value={0.52} />
        <Bar label="Cleanliness" value={0.95} />
      </div>

      {/* Optional small debug row; keep if useful */}
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
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
  );
}

/** Simple inline progress bar (non-intrusive, replace with your own CSS anytime). */
function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>{label}</div>
      <div
        style={{
          height: 10,
          width: "100%",
          borderRadius: 8,
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background:
              "linear-gradient(90deg, rgba(124,77,255,0.9), rgba(0,200,255,0.9))",
          }}
        />
      </div>
    </div>
  );
}
