// src/components/Tamagotchi.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimSet, FormKey, catalog } from "../game/catalog";

/** Centered canvas renderer with 3 bars (Cleanliness/Hunger/Happiness),
 * hunger-death gating (1 NFT = 1 life), avatar overlay, and bounce movement. */
export default function Tamagotchi({
  currentForm,
  lives,                 // lives available from parent (1 NFT = 1 life)
  onLoseLife,            // callback to spend a life on revive
  onEvolve,              // optional
}: {
  currentForm: FormKey;
  lives: number;
  onLoseLife: () => void;
  onEvolve?: () => FormKey | void;
}) {
  // ===== Scene logical size =====
  const LOGICAL_W = 320;
  const LOGICAL_H = 180;
  const FPS = 6;
  const WALK_SPEED = 42;

  // Layout sizing
  const MAX_W = 720;
  const CANVAS_H = 360;
  const BAR_H = 6;

  // Per-form visual tweaks
  const SCALE_MAP: Partial<Record<FormKey, number>> = { egg: 0.66 };
  const BASELINE_NUDGE: Partial<Record<FormKey, number>> = { egg: +27 };

  // Dead sprite mapping (put your images into /public/sprites/dead/)
  const DEAD_SPRITE_MAP: Partial<Record<FormKey, string>> = {
    egg: "/sprites/dead/egg_dead.png",
    // char1: "/sprites/dead/char1_dead.png",
    // char2: "/sprites/dead/char2_dead.png",
    // char3: "/sprites/dead/char3_dead.png",
    // char4: "/sprites/dead/char4_dead.png",
  };
  const DEAD_FALLBACK = "/sprites/dead.png"; // optional common fallback

  // ===== Pet state (minimal local model) =====
  const [stats, setStats] = useState({
    cleanliness: 0.9,
    hunger: 0.65,       // when reaches 0 => death
    happiness: 0.6,
  });
  const [isDead, setIsDead] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [anim, setAnim] = useState<keyof AnimSet>("walk");

  // Preload list: BG + current frames + dead sprite
  const urls = useMemo(() => {
    const set = new Set<string>();
    set.add("/bg/BG.png");
    const def = catalog[currentForm];
    Object.values(def).forEach((frames) => frames.forEach((u) => set.add(u)));
    const deadSrc = DEAD_SPRITE_MAP[currentForm] ?? DEAD_FALLBACK;
    if (deadSrc) set.add(deadSrc);
    return Array.from(set);
  }, [currentForm]);

  // Avatar (top-right)
  const avatarSrc = useMemo(() => {
    const def = catalog[currentForm];
    return def.idle[0] ?? def.walk[0] ?? "";
  }, [currentForm]);

  // Passive decay (hunger drains faster). If hunger <= 0 => death lock.
  useEffect(() => {
    const id = setInterval(() => {
      setStats((s) => {
        const next = clampStats({
          cleanliness: s.cleanliness - 0.001,
          hunger: s.hunger - 0.006,
          happiness: s.happiness - 0.0015,
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Detect death from hunger
  useEffect(() => {
    if (!isDead && stats.hunger <= 0) {
      setIsDead(true);
    }
  }, [stats.hunger, isDead]);

  // Actions (disabled when dead)
  const act = {
    feed: () =>
      setStats((s) => clampStats({ ...s, hunger: s.hunger + 0.35, happiness: s.happiness + 0.05 })),
    play: () =>
      setStats((s) => clampStats({ ...s, happiness: s.happiness + 0.18, hunger: s.hunger - 0.08 })),
    clean: () =>
      setStats((s) => clampStats({ ...s, cleanliness: s.cleanliness + 0.25, happiness: s.happiness + 0.02 })),
  };

  // Try to revive: spend one life and reset minimal stats
  const spendLifeToRevive = () => {
    if (lives <= 0) return;
    onLoseLife(); // parent will update lives via storage + event
    setStats((s) =>
      clampStats({
        cleanliness: Math.max(s.cleanliness, 0.4),
        hunger: 0.35,
        happiness: Math.max(s.happiness, 0.4),
      })
    );
    setIsDead(false);
  };

  // ===== Sprite loop =====
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
  }, [urls.join("|"), currentForm, anim, isDead]);

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

    // DPR-aware resize (centered)
    const resize = () => {
      const wrap = wrapRef.current!;
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

      const containerW = wrap.clientWidth || LOGICAL_W;
      const containerH = CANVAS_H;

      const target = LOGICAL_W / LOGICAL_H;
      const box = containerW / containerH;
      let cssW = containerW,
        cssH = containerH;
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

      // BG
      const bg = images["/bg/BG.png"];
      if (bg) {
        const scale = Math.max(LOGICAL_W / bg.width, LOGICAL_H / bg.height);
        const dw = Math.floor(bg.width * scale);
        const dh = Math.floor(bg.height * scale);
        const dx = Math.floor((LOGICAL_W - dw) / 2);
        const dy = Math.floor((LOGICAL_H - dh) / 2);
        ctx.drawImage(bg, dx, dy, dw, dh);
      }

      // When dead: draw dead sprite overlay and halt movement/anim
      if (isDead) {
        const deadSrc = DEAD_SPRITE_MAP[currentForm] ?? DEAD_FALLBACK;
        const dead = deadSrc ? images[deadSrc] : undefined;
        if (dead) {
          const w = Math.round(dead.width * (SCALE || 1));
          const h = Math.round(dead.height * (SCALE || 1));
          const ix = Math.round((LOGICAL_W - w) / 2);
          const iy = Math.round(BASELINE - h);
          ctx.drawImage(dead, ix, iy, w, h);
        }
        // No animation/movement while dead
        raf = requestAnimationFrame(loop);
        return;
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

  // Avatar box (inside scene)
  const Avatar = avatarSrc ? (
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
  ) : null;

  // Death overlay UI
  const DeathOverlay = isDead ? (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        className="card"
        style={{
          padding: 14,
          borderRadius: 12,
          minWidth: 260,
          textAlign: "center",
          background: "rgba(10,10,18,0.85)",
          border: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        <div style={{ fontSize: 18, marginBottom: 6 }}>Your pet has died</div>
        <div className="muted" style={{ marginBottom: 12 }}>
          Lives left: <b>{lives}</b>
        </div>
        {lives > 0 ? (
          <button className="btn btn-primary" onClick={spendLifeToRevive}>
            Spend 1 life to revive
          </button>
        ) : (
          <div className="muted">
            Transfer 1 NFT to get a life. After it arrives, the game will unlock.
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div
      ref={containerRef}
      style={{ width: "min(92vw, 100%)", maxWidth: MAX_W, margin: "0 auto" }}
    >
      {/* Canvas wrapper (relative for overlays) */}
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
        {Avatar}
        {DeathOverlay}
      </div>

      {/* 3 compact bars */}
      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        <Bar label="Cleanliness" value={stats.cleanliness} h={BAR_H} />
        <Bar label="Hunger" value={stats.hunger} h={BAR_H} />
        <Bar label="Happiness" value={stats.happiness} h={BAR_H} />
      </div>

      {/* Actions (disabled when dead) */}
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          justifyContent: "center",
          opacity: isDead ? 0.5 : 1,
          pointerEvents: isDead ? "none" as const : "auto" as const,
        }}
      >
        <button className="btn" onClick={act.feed}>🍗 Feed</button>
        <button className="btn" onClick={act.play}>🎮 Play</button>
        <button className="btn" onClick={act.clean}>🧻 Clean</button>
        <button className="btn" onClick={() => setAnim((a) => (a === "walk" ? "idle" : "walk"))}>
          Toggle Walk/Idle
        </button>
        {!!onEvolve && (
          <button className="btn btn-primary" onClick={() => onEvolve()}>
            ⭐ Evolve (debug)
          </button>
        )}
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

function clampStats(s: { cleanliness: number; hunger: number; happiness: number; }) {
  const c = (x: number) => Math.max(0, Math.min(1, x));
  return { cleanliness: c(s.cleanliness), hunger: c(s.hunger), happiness: c(s.happiness) };
}
