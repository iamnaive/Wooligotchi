// src/components/Tamagotchi.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FormKey, catalog } from "../game/catalog";

/** SAFE Tamagotchi: defensive against missing props/assets/observers. */
export default function Tamagotchi({
  currentForm,
  lives = 0,
  onLoseLife = () => {},
  onEvolve,
}: {
  currentForm: FormKey;
  lives?: number;
  onLoseLife?: () => void;
  onEvolve?: () => FormKey | void;
}) {
  // ---------- constants ----------
  const LOGICAL_W = 320;
  const LOGICAL_H = 180;
  const FPS = 6;
  const WALK_SPEED = 42;
  const MAX_W = 720;
  const CANVAS_H = 360;
  const BAR_H = 6;
  const BASE_GROUND = 48;

  const SCALE: Partial<Record<FormKey, number>> = { egg: 0.66 };
  const BASELINE_NUDGE: Partial<Record<FormKey, number>> = { egg: +6 };

  const POOP_SRCS = [
    "/sprites/poop/poop1.png",
    "/sprites/poop/poop2.png",
    "/sprites/poop/poop3.png",
  ];

  const DEAD_MAP: Partial<Record<FormKey, string>> = {
    egg: "/sprites/dead/egg_dead.png",
  };
  const DEAD_FALLBACK = "/sprites/dead.png";

  // ---------- state ----------
  const [anim, setAnim] = useState<AnimKey>("walk");
  const [stats, setStats] = useState<Stats>({
    cleanliness: 0.9,
    hunger: 0.65,
    happiness: 0.6,
    health: 1.0,
  });
  const [poops, setPoops] = useState<Poop[]>([]);
  const [isSick, setIsSick] = useState(false);
  const [isDead, setIsDead] = useState(false);
  const [deathReason, setDeathReason] = useState<string | null>(null);

  const [useAutoTime, setUseAutoTime] = useState(true);
  const [sleepStart, setSleepStart] = useState("22:00");
  const [wakeTime, setWakeTime] = useState("08:30");

  const [startedAt] = useState<number>(() => {
    try {
      const k = "wg_start_ts_v1";
      const raw = localStorage.getItem(k);
      if (raw) return Number(raw);
      const now = Date.now();
      localStorage.setItem(k, String(now));
      return now;
    } catch {
      return Date.now();
    }
  });
  const [catastrophe, setCatastrophe] = useState<Catastrophe | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // ---------- safe catalog access ----------
  const safeForm = (form: FormKey): FormKey =>
    catalog[form] ? form : ("egg" as FormKey);

  const urls = useMemo(() => {
    const set = new Set<string>();
    set.add("/bg/BG.png");
    const def = (catalog[safeForm(currentForm)] || {}) as AnyAnimSet;
    ["idle", "walk", "sick", "sad", "unhappy", "sleep"].forEach((k) => {
      (def[k as AnimKey] ?? []).forEach((u) => set.add(u));
    });
    POOP_SRCS.forEach((u) => set.add(u));
    const dead = DEAD_MAP[currentForm] ?? DEAD_FALLBACK;
    if (dead) set.add(dead);
    return Array.from(set);
  }, [currentForm]);

  const avatarSrc = useMemo(() => {
    const def = (catalog[safeForm(currentForm)] || {}) as AnyAnimSet;
    return (def.idle?.[0] ?? def.walk?.[0] ?? "") as string;
  }, [currentForm]);

  // ---------- sleep / age / catastrophe ----------
  const sleeping = useMemo(() => {
    try {
      const now = new Date();
      if (useAutoTime) {
        const H = now.getHours(), M = now.getMinutes();
        const afterStart = H > 22 || (H === 22 && M >= 0);
        const beforeWake = H < 8 || (H === 8 && M < 30);
        return afterStart || beforeWake;
      } else {
        const [ssH, ssM] = (sleepStart || "22:00").split(":").map((n) => +n || 0);
        const [wkH, wkM] = (wakeTime || "08:30").split(":").map((n) => +n || 0);
        const H = now.getHours(), M = now.getMinutes();
        const afterStart = H > ssH || (H === ssH && M >= ssM);
        const beforeWake = H < wkH || (H === wkH && M < wkM);
        if (ssH > wkH || (ssH === wkH && ssM > wkM)) return afterStart || beforeWake;
        return afterStart && beforeWake;
      }
    } catch { return false; }
  }, [useAutoTime, sleepStart, wakeTime]);

  const ageDays = Math.floor((Date.now() - startedAt) / (24 * 3600 * 1000));
  useEffect(() => {
    try {
      const key = "wg_catastrophe_done_v1";
      const done = localStorage.getItem(key);
      if (ageDays >= 2 && !done) {
        if (Math.random() < 0.8) {
          const cause = pickOne(CATASTROPHE_CAUSES);
          setCatastrophe({ cause, until: Date.now() + 60 * 1000 });
        }
        localStorage.setItem(key, "1");
      }
    } catch (e) {
      console.warn("catastrophe gate failed", e);
    }
  }, [ageDays]);

  // ---------- stat ticks w/ anti-cheat ----------
  useEffect(() => {
    let lastWall = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const dt = clampDt(now - lastWall);
      lastWall = now;

      if (!isDead && !sleeping && dt > 0) {
        const fast = catastrophe && Date.now() < catastrophe.until;
        const hungerPerMs = fast ? (1 / 60000) : (1 / (90 * 60 * 1000));
        const healthPerMs = (isSick ? 1 / (7 * 60 * 1000) : 1 / (10 * 60 * 60 * 1000));
        const happyPerMs  = isSick ? (1 / (8 * 60 * 1000)) : (1 / (12 * 60 * 60 * 1000));
        const dirtPerMs   = (poops.length > 0 ? 1 / (5 * 60 * 60 * 1000) : 1 / (12 * 60 * 60 * 1000));

        setStats((s) => {
          const next: Stats = clampStats({
            cleanliness: s.cleanliness - dirtPerMs * dt,
            hunger:      s.hunger      - hungerPerMs * dt,
            happiness:   s.happiness   - happyPerMs  * dt,
            health:      s.health      - healthPerMs * dt,
          });
          if ((next.hunger <= 0 || next.health <= 0) && !isDead) {
            setIsDead(true);
            setDeathReason(
              next.hunger <= 0 ? "starvation" :
              (catastrophe && Date.now() < catastrophe.until) ? `fatal ${catastrophe.cause}` :
              (isSick ? "illness" : "collapse")
            );
          }
          return next;
        });
      }

      if (!isDead && !sleeping && Math.random() < 0.07) spawnPoop();
      if (!isDead && !sleeping) {
        const dirtFactor = Math.min(1, poops.length / 5);
        const lowClean = 1 - stats.cleanliness;
        const p = 0.02 + 0.3 * dirtFactor + 0.2 * lowClean;
        if (!isSick && Math.random() < p * 0.03) setIsSick(true);
        if (isSick && Math.random() < 0.015) setIsSick(false);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [isDead, sleeping, catastrophe, poops.length, isSick, stats.cleanliness]);

  // ---------- actions ----------
  const act = {
    feed: () => {
      if (isDead) return;
      setStats((s) => clampStats({ ...s, hunger: s.hunger + 0.25, happiness: s.happiness + 0.05 }));
      if (Math.random() < 0.7) spawnPoop();
    },
    play: () => {
      if (isDead) return;
      setStats((s) => clampStats({ ...s, happiness: s.happiness + 0.2, health: Math.min(1, s.health + 0.03) }));
    },
    clean: () => {
      if (isDead) return;
      setPoops([]);
      setStats((s) => clampStats({ ...s, cleanliness: Math.max(s.cleanliness, 0.92), happiness: s.happiness + 0.02 }));
    },
  };

  const spendLifeToRevive = () => {
    try {
      if (lives! <= 0) return;
      onLoseLife!();
      setIsDead(false);
      setDeathReason(null);
      setStats((s) =>
        clampStats({
          cleanliness: Math.max(s.cleanliness, 0.7),
          hunger: 0.4,
          happiness: Math.max(s.happiness, 0.5),
          health: Math.max(s.health, 0.6),
        })
      );
      setPoops([]);
      setIsSick(false);
      setCatastrophe(null);
    } catch (e) {
      console.error("revive failed", e);
    }
  };

  // ---------- render loop (defensive) ----------
  const runOnceRef = useRef(0);
  useEffect(() => {
    let canceled = false;
    const toLoad = urls.map((src) => loadImageSafe(src));
    Promise.all(toLoad)
      .then((pairs) => {
        if (canceled) return;
        const images: Record<string, HTMLImageElement> = {};
        for (const it of pairs) {
          if (it && it.img) images[it.src] = it.img;
        }
        startLoop(images);
      })
      .catch((e) => {
        console.warn("preload error", e);
        startLoop({});
      });
    return () => {
      canceled = true;
      runOnceRef.current++;
    };
  }, [urls.join("|"), currentForm, anim, isDead, isSick, sleeping]);

  const startLoop = (images: Record<string, HTMLImageElement>) => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    (ctx as any).imageSmoothingEnabled = false;

    const def = (catalog[safeForm(currentForm)] || {}) as AnyAnimSet;

    const chosenAnim: AnimKey = (sleeping
      ? (def.sleep?.length ? "sleep" : "idle")
      : isDead
      ? "idle"
      : isSick
      ? (def.sick?.length ? "sick" : "idle")
      : (stats.happiness < 0.35
          ? (def.sad?.length ? "sad" : (def.unhappy?.length ? "unhappy" : "walk"))
          : anim)) as AnimKey;

    const framesAll = (def[chosenAnim] ?? def.idle ?? def.walk ?? []) as string[];
    const frames = framesAll.filter((u) => !!images[u]);

    const base = frames.length ? images[frames[0]] : undefined;
    const scale = SCALE[safeForm(currentForm)] ?? 1;
    const drawW = Math.round((base?.width ?? 32) * scale);
    const drawH = Math.round((base?.height ?? 32) * scale);
    const BASELINE = LOGICAL_H - BASE_GROUND + (BASELINE_NUDGE[safeForm(currentForm)] ?? 0);

    let dir: 1 | -1 = 1;
    let x = 40;
    const minX = 0;
    const maxX = LOGICAL_W - drawW;

    const frameDuration = 1000 / FPS;
    let frameTimer = 0;
    let frameIndex = 0;

    const resize = () => {
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
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

    let ro: ResizeObserver | null = null;
    const hasRO = "ResizeObserver" in window;
    if (hasRO) {
      ro = new (window as any).ResizeObserver(resize);
      ro.observe(wrap);
    } else {
      window.addEventListener("resize", resize);
    }
    resize();

    let last = performance.now();
    let raf = 0;
    const runId = runOnceRef.current;

    const loop = (ts: number) => {
      if (runOnceRef.current !== runId) return;
      const dt = Math.min(100, ts - last);
      last = ts;

      // clear
      ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

      // bg
      const bg = images["/bg/BG.png"];
      if (bg) {
        const scaleBG = Math.max(LOGICAL_W / bg.width, LOGICAL_H / bg.height);
        const dw = Math.floor(bg.width * scaleBG);
        const dh = Math.floor(bg.height * scaleBG);
        const dx = Math.floor((LOGICAL_W - dw) / 2);
        const dy = Math.floor((LOGICAL_H - dh) / 2);
        ctx.drawImage(bg, dx, dy, dw, dh);
      }

      // poops
      if (poops.length) {
        for (const p of poops) {
          const img = images[p.src];
          const px = Math.round(p.x);
          const py = Math.round(BASELINE - 6);
          if (img) {
            const w = 12, h = 12;
            ctx.drawImage(img, px, py - h, w, h);
          } else {
            ctx.font = "10px monospace";
            ctx.fillText("💩", px, py);
          }
        }
      }

      if (isDead) {
        const deadSrc = DEAD_MAP[currentForm] ?? DEAD_FALLBACK;
        const dead = deadSrc ? images[deadSrc] : undefined;
        if (dead) {
          const w = Math.round(dead.width * scale);
          const h = Math.round(dead.height * scale);
          const ix = Math.round((LOGICAL_W - w) / 2);
          const iy = Math.round(BASELINE - h);
          ctx.drawImage(dead, ix, iy, w, h);
        }
      } else {
        // advance anim
        if (frames.length) {
          frameTimer += dt;
          if (frameTimer >= frameDuration) {
            frameTimer -= frameDuration;
            frameIndex = (frameIndex + 1) % frames.length;
          }
        }

        // move
        if (!sleeping) {
          x += dir * (WALK_SPEED * dt) / 1000;
          if (x < minX) { x = minX; dir = 1; }
          else if (x > maxX) { x = maxX; dir = -1; }
        }

        const src = frames.length ? frames[frameIndex] : undefined;
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
      }

      if (catastrophe && Date.now() < catastrophe.until) {
        drawBanner(ctx, LOGICAL_W, `⚠ ${catastrophe.cause}! stats draining fast`);
      }
      if (!isDead && sleeping) drawBanner(ctx, LOGICAL_W, "😴 Sleeping");

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);

    // cleanup
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  };

  // ---------- UI ----------
  const Avatar = avatarSrc ? (
    <div
      style={{
        position: "absolute", right: 10, top: 10,
        width: 60, height: 60, borderRadius: 12,
        background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.2)",
        display: "grid", placeItems: "center", backdropFilter: "blur(4px)",
      }}
    >
      <img src={avatarSrc} alt="pet" draggable={false}
           style={{ width: 40, height: 40, imageRendering: "pixelated", display: "block" }}/>
      <div style={{ position: "absolute", bottom: 4, right: 6, fontSize: 11, opacity: 0.95 }}>
        ❤️ {Math.round(stats.health * 100)}%
      </div>
    </div>
  ) : null;

  const DeathOverlay = isDead ? (
    <div
      style={{
        position: "absolute", inset: 0, display: "grid", placeItems: "center",
        background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)",
      }}
    >
      <div className="card" style={{ padding: 14, borderRadius: 12, minWidth: 260, textAlign: "center",
        background: "rgba(10,10,18,0.85)", border: "1px solid rgba(255,255,255,0.12)" }}>
        <div style={{ fontSize: 18, marginBottom: 6 }}>Your pet has died</div>
        {deathReason && <div className="muted" style={{ marginBottom: 6 }}>Cause: {deathReason}</div>}
        <div className="muted" style={{ marginBottom: 12 }}>Lives left: <b>{lives}</b></div>
        {lives > 0
          ? <button className="btn btn-primary" onClick={spendLifeToRevive}>Spend 1 life to revive</button>
          : <div className="muted">Transfer 1 NFT to get a life.</div>}
      </div>
    </div>
  ) : null;

  return (
    <div ref={containerRef} style={{ width: "min(92vw, 100%)", maxWidth: MAX_W, margin: "0 auto" }}>
      {/* Canvas */}
      <div
        ref={wrapRef}
        style={{
          width: "100%", height: CANVAS_H, position: "relative",
          imageRendering: "pixelated", overflow: "hidden", background: "transparent", borderRadius: 12, margin: "0 auto",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: "block", imageRendering: "pixelated", background: "transparent", borderRadius: 12 }}
        />
        {Avatar}
        {DeathOverlay}
      </div>

      {/* Bars */}
      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        <Bar label="Cleanliness" value={stats.cleanliness} h={BAR_H} />
        <Bar label="Hunger" value={stats.hunger} h={BAR_H} />
        <Bar label="Happiness" value={stats.happiness} h={BAR_H} />
      </div>

      {/* Actions */}
      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center",
        opacity: isDead ? 0.5 : 1, pointerEvents: isDead ? ("none" as const) : ("auto" as const) }}>
        <button className="btn" onClick={act.feed}>🍗 Feed</button>
        <button className="btn" onClick={act.play}>🎮 Play</button>
        <button className="btn" onClick={act.clean}>🧻 Clean</button>
        <button className="btn" onClick={() => setAnim((a) => (a === "walk" ? "idle" : "walk"))}>Toggle Walk/Idle</button>
        {!!onEvolve && <button className="btn btn-primary" onClick={() => onEvolve()}>⭐ Evolve (debug)</button>}
        <span className="muted" style={{ alignSelf: "center" }}>
          Poop: {poops.length} | Form: {currentForm} {isSick ? " | 🤒 Sick" : ""} {catastrophe && Date.now()<catastrophe.until ? " | ⚠ Event" : ""}
        </span>
      </div>

      {/* Sleep controls */}
      <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={useAutoTime} onChange={(e)=>setUseAutoTime(e.target.checked)} />
          Auto local sleep 22:00–08:30
        </label>
        {!useAutoTime && (
          <>
            <span className="muted">Sleep:</span>
            <input className="input" type="time" value={sleepStart} onChange={(e)=>setSleepStart(e.target.value)} />
            <span className="muted">Wake:</span>
            <input className="input" type="time" value={wakeTime} onChange={(e)=>setWakeTime(e.target.value)} />
          </>
        )}
      </div>
    </div>
  );

  // ---------- helpers ----------
  function spawnPoop() {
    setPoops((arr) => {
      const x = 8 + Math.random() * (LOGICAL_W - 16);
      const src = pickOne(POOP_SRCS);
      const max = 8;
      const next = [...arr, { x, src }];
      return next.slice(-max);
    });
  }
}

type AnimKey = "idle" | "walk" | "sick" | "sad" | "unhappy" | "sleep";
type AnyAnimSet = Partial<Record<AnimKey, string[]>>;
type Stats = { cleanliness: number; hunger: number; happiness: number; health: number; };
type Poop = { x: number; src: string };
type Catastrophe = { cause: string; until: number };

const CATASTROPHE_CAUSES = [
  "food poisoning", "mysterious flu", "meteor dust", "bad RNG", "doom day syndrome",
] as const;

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
function clampStats(s: Stats): Stats {
  return {
    cleanliness: clamp01(s.cleanliness),
    hunger: clamp01(s.hunger),
    happiness: clamp01(s.happiness),
    health: clamp01(s.health),
  };
}
function pickOne<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }

function drawBanner(ctx: CanvasRenderingContext2D, width: number, text: string) {
  const pad = 4;
  ctx.save();
  ctx.font = "12px monospace";
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const x = Math.round((width - w) / 2);
  const y = 12 + 6;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(x, 6, w, 18);
  ctx.fillStyle = "white";
  ctx.fillText(text, x + pad, y);
  ctx.restore();
}
function clampDt(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  if (ms < 0) return 0;
  const MAX_FORWARD = 10 * 60 * 1000;
  return Math.min(ms, MAX_FORWARD);
}
async function loadImageSafe(src: string): Promise<{ src: string; img: HTMLImageElement } | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve({ src, img });
      img.onerror = () => {
        console.warn("image load failed:", src);
        resolve(null);
      };
      img.src = src;
    } catch (e) {
      console.warn("image create failed:", src, e);
      resolve(null);
    }
  });
}
