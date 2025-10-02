// src/components/Tamagotchi.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimSet, FormKey, catalog } from "../game/catalog";

/** Centered canvas renderer with edge-bounce, avatar overlay, and compact UI. */
export default function Tamagotchi({
  currentForm,
  onEvolve,
}: {
  currentForm: FormKey;
  onEvolve?: () => FormKey | void;
}) {
  // ===== Scene logical size =====
  const LOGICAL_W = 320;
  const LOGICAL_H = 180;
  const FPS = 6;
  const WALK_SPEED = 42;

  // Centering / layout width
  const MAX_W = 720;              // px, max visual width for the scene block
  const CANVAS_H = 360;           // px, container CSS height (kept)
  const BAR_HEIGHT = 6;           // px, compact bars

  // Per-form visual tweaks
  const SCALE_MAP: Partial<Record<FormKey, number>> = { egg: 0.66 };
  const BASELINE_NUDGE: Partial<Record<FormKey, number>> = { egg: +27 };

  // Local pet stats (placeholder)
  const [stats, setStats] = useState({
    energy: 0.62,
    hygiene: 0.85,
    cleanliness: 0.95,
    mood: 0.55,
    health: 0.9,
    poop: 0,
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [anim, setAnim] = useState<keyof AnimSet>("walk");

  // Preload list
  const urls = useMemo(() => {
    const set = new Set<string>();
    set.add("/bg/BG.png");
    const def = catalog[currentForm];
    Object.values(def).forEach((frames) => frames.forEach((u) => set.add(u)));
    return Array.from(set);
  }, [currentForm]);

  // Avatar src
  const avatarSrc = useMemo(() => {
    const def = catalog[currentForm];
    return def.idle[0] ?? def.walk[0] ?? "";
  }, [currentForm]);

  // Passive drift
  useEffect(() => {
    const id = setInterval(() => {
      setStats((s) =>
        clampStats({
          ...s,
          energy: s.energy - 0.002,
          hygiene: s.hygiene - 0.0015,
          cleanliness: Math.max(0, s.cleanliness - (s.poop > 0 ? 0.003 : 0.0005)),
          mood: s.mood - 0.001,
        })
      );
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Sprite loop
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

    // Sprite size
    const sample = framesAll.length ? images[framesAll[0]] : undefined;
    const baseW = sample?.width ?? 32;
    const baseH = sample?.height ?? 32;
    const SCALE = SCALE_MAP[currentForm] ?? 1.0;
    const drawW = Math.round(baseW * SCALE);
    const drawH = Math.round(baseH * SCALE);

    // Movement & facing
    const BASELINE = LOGICAL_H - 48 + (BASELINE_NUDGE[currentForm] ?? 0);
    let dir: 1 | -1 = 1;
    let x = 40;
    const minX = 0;
    const maxX = LOGICAL_W - drawW;

    // Animation timers
    const frameDuration = 1000 / FPS;
    let frameTimer = 0;
    let frameIndex = 0;

    // DPR-aware resize (preserve aspect, center within fixed-width container)
    const resize = () => {
      const wrap = wrapRef.current!;
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

      // Width: clamp to container width; container is centered and max-width limited
      const containerW = wrap.clientWidth || LOGICAL_W;
      const containerH = CANVAS_H;

      const target = LOGICAL_W / LOGICAL_H;
      const box = containerW / containerH;
      let cssW = containerW, cssH = containerH;
      if (box > target) cssW = Math.round(containerH * target);
      else cssH = Math.round(containerW / target);

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

      // Draw sprite (flip when facing left)
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

  // Actions (placeholder)
  const act = {
    feed: () =>
      setStats((s) =>
        clampStats({ ...s, energy: s.energy + 0.25, mood: s.mood + 0.06, hygiene: s.hygiene - 0.04, poop: s.poop + 1 })
      ),
    play: () =>
      setStats((s) =>
        clampStats({ ...s, mood: s.mood + 0.18, energy: s.energy - 0.12, cleanliness: s.cleanliness - 0.03 })
      ),
    heal: () => setStats((s) => clampStats({ ...s, health: s.health + 0.3, mood: s.mood + 0.04 })),
    clean: () => setStats((s) => clampStats({ ...s, poop: Math.max(0, s.poop - 1), cleanliness: s.cleanliness + 0.22, hygiene: s.hygiene + 0.08 })),
    wash: () => setStats((s) => clampStats({ ...s, hygiene: s.hygiene + 0.25, mood: s.mood - 0.02 })),
    sleep: () => setStats((s) => clampStats({ ...s, energy: s.energy + 0.35, mood: s.mood + 0.02 })),
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: "min(92vw, 100%)",
        maxWidth: MAX_W,
        margin: "0 auto",                  // center whole block
      }}
    >
      {/* Canvas wrapper (relative for avatar) */}
      <div
        ref={wrapRef}
        style={{
          width: "100%",
          height: CANVAS_H,
          position: "relative",
          imageRendering: "pixelated",
          overflow: "hidden",
          background: "transparent",
          borderRadius: 12,
          margin: "0 auto",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            imageRendering: "pixelated",
            background: "transparent",
            borderRadius: 12,
            margin: "0 auto",
          }}
        />

        {/* Avatar stays anchored to this wrapper's top-right */}
        {avatarSrc && (
          <div
            style={{
              position: "absolute",
              right: 10,
              top: 10,
              width: 56,
              height: 56,
              borderRadius: 12,
              background: "rgba(0,0,0,0.35)",
              border: "1px solid rgba(255,255,255,0.2)",
              display: "grid",
              placeItems: "center",
              backdropFilter: "blur(4px)",
            }}
          >
            <img
              src={avatarSrc}
              alt="pet"
              draggable={false}
              style={{ width: 40, height: 40, imageRendering: "pixelated", display: "block" }}
            />
          </div>
        )}
      </div>

      {/* Compact bars (width matches scene, centered) */}
      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        <Bar label="Hygiene" value={stats.hygiene} h={BAR_HEIGHT} />
        <Bar label="Energy" value={stats.energy} h={BAR_HEIGHT} />
        <Bar label="Cleanliness" value={stats.cleanliness} h={BAR_HEIGHT} />
      </div>

      {/* Actions row centered and wrapped to scene width */}
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          justifyContent: "center",
        }}
      >
        <button className="btn" onClick={act.feed}>🍗 Feed</button>
        <button className="btn" onClick={act.play}>🎮 Play</button>
        <button className="btn" onClick={act.heal}>💊 Heal</button>
        <button className="btn" onClick={act.clean}>🧻 Clean</button>
        <button className="btn" onClick={act.wash}>🛁 Wash</button>
        <button className="btn" onClick={act.sleep}>😴 Sleep</button>
        <button className="btn btn-primary" onClick={() => setAnim((a) => (a === "walk" ? "idle" : "walk"))}>
          Toggle Walk/Idle
        </button>
        {!!onEvolve && (
          <button className="btn btn-primary" onClick={() => onEvolve()}>
            ⭐ Evolve (debug)
          </button>
        )}
        <span className="muted" style={{ alignSelf: "center" }}>
          Poop: {stats.poop} | Form: {currentForm}
        </span>
      </div>
    </div>
  );
}

/** Compact progress bar */
function Bar({ label, value, h = 6 }: { label: string; value: number; h?: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>{label}</div>
      <div
        style={{
          height: h,
          width: "100%",
          borderRadius: Math.max(6, h),
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "linear-gradient(90deg, rgba(124,77,255,0.9), rgba(0,200,255,0.9))",
          }}
        />
      </div>
    </div>
  );
}

function clampStats(s: any) {
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  return {
    ...s,
    energy: clamp(s.energy),
    hygiene: clamp(s.hygiene),
    cleanliness: clamp(s.cleanliness),
    mood: clamp(s.mood),
    health: clamp(s.health),
    poop: Math.max(0, Math.floor(s.poop ?? 0)),
  };
}
