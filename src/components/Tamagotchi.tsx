// src/components/Tamagotchi.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FormKey, catalog } from "../game/catalog";

/**
 * Wooligotchi — Canvas scene
 * - Avatar drawn over BG (no plate), in the top-right corner, with ❤️HP%
 * - Everything except BG is shifted down by 26px (Y_SHIFT)
 * - Stable rAF animation; walking never freezes (smart fallback to walk frames)
 * - Offline catch-up that respects sleep (no drain during sleep)
 * - One-time sleep window (Save & lock)
 * - Illness, poop (png), day-2 catastrophe (80% for 1 minute)
 * - 3 stat bars: Cleanliness, Hunger, Happiness (+internal Health)
 * - Actions: Feed / Play / Heal (cooldown) / Clean / Toggle Walk-Idle / Evolve(debug)
 * - Death + revive by spending a life
 * - Poops persist in localStorage and restore on reload
 */

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
  /** ===== Canvas & world constants ===== */
  const LOGICAL_W = 320;
  const LOGICAL_H = 180;
  const FPS = 6;
  const WALK_SPEED = 42;        // logical px / sec
  const MAX_W = 720;
  const CANVAS_H = 360;
  const BAR_H = 6;
  const BASE_GROUND = 48;

  // Shift everything (except BG) down by this amount
  const Y_SHIFT = 26;

  // Heal cooldown
  const HEAL_COOLDOWN_MS = 60_000;

  /** ===== Per-form tuning ===== */
  const SCALE: Partial<Record<FormKey, number>> = { egg: 0.66 };
  const BASELINE_NUDGE: Partial<Record<FormKey, number>> = { egg: +6 };

  /** ===== Assets ===== */
  const BG_SRC = "/bg/BG.png";
  const POOP_SRCS = ["/sprites/poop/poop1.png", "/sprites/poop/poop2.png", "/sprites/poop/poop3.png"];
  const DEAD_MAP: Partial<Record<FormKey, string>> = { egg: "/sprites/dead/egg_dead.png" };
  const DEAD_FALLBACK = "/sprites/dead.png";

  /** ===== LocalStorage keys ===== */
  const START_TS_KEY = "wg_start_ts_v1";
  const LAST_SEEN_KEY = "wg_last_seen_v1";
  const CATA_DONE_KEY = "wg_catastrophe_done_v1";
  const SLEEP_LOCK_KEY = "wg_sleep_lock_v1";
  const SLEEP_FROM_KEY = "wg_sleep_from_v1";
  const SLEEP_TO_KEY = "wg_sleep_to_v1";
  const POOPS_KEY = "wg_poops_v1";

  /** ===== State ===== */
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
  const [lastHealAt, setLastHealAt] = useState<number>(0);

  // Sleep window (auto OR manual; manual can be locked once)
  const [useAutoTime, setUseAutoTime] = useState<boolean>(() => !localStorage.getItem(SLEEP_LOCK_KEY));
  const [sleepStart, setSleepStart] = useState<string>(() => localStorage.getItem(SLEEP_FROM_KEY) || "22:00");
  const [wakeTime, setWakeTime] = useState<string>(() => localStorage.getItem(SLEEP_TO_KEY) || "08:30");
  const [sleepLocked, setSleepLocked] = useState<boolean>(() => !!localStorage.getItem(SLEEP_LOCK_KEY));

  // Pet age start
  const [startedAt] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(START_TS_KEY);
      if (raw) return Number(raw);
      const now = Date.now();
      localStorage.setItem(START_TS_KEY, String(now));
      return now;
    } catch {
      return Date.now();
    }
  });

  // Random catastrophe (fast drain) day-2
  const [catastrophe, setCatastrophe] = useState<Catastrophe | null>(null);

  /** ===== “Stable refs” for rAF ===== */
  const animRef = useLatest(anim);
  const statsRef = useLatest(stats);
  const sickRef = useLatest(isSick);
  const deadRef = useLatest(isDead);
  const poopsRef = useLatest(poops);
  const catastropheRef = useLatest(catastrophe);
  const sleepParamsRef = useRef({ useAutoTime, sleepStart, wakeTime, sleepLocked });
  useEffect(() => {
    sleepParamsRef.current = { useAutoTime, sleepStart, wakeTime, sleepLocked };
  }, [useAutoTime, sleepStart, wakeTime, sleepLocked]);

  /** ===== Canvas refs ===== */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /** ===== Catalog / frames ===== */
  const safeForm = (f: FormKey) => (catalog[f] ? f : ("egg" as FormKey));
  const def = useMemo(() => (catalog[safeForm(currentForm)] || {}) as AnyAnimSet, [currentForm]);
  const avatarSrc = useMemo(() => def.idle?.[0] ?? def.walk?.[0] ?? "", [def]);

  const urls = useMemo(() => {
    const set = new Set<string>();
    set.add(BG_SRC);
    (["idle", "walk", "sick", "sad", "unhappy", "sleep"] as AnimKey[]).forEach((k) => {
      (def[k] ?? []).forEach((u) => set.add(u));
    });
    if (avatarSrc) set.add(avatarSrc);
    POOP_SRCS.forEach((u) => set.add(u));
    const dead = DEAD_MAP[currentForm] ?? DEAD_FALLBACK;
    if (dead) set.add(dead);
    return Array.from(set);
  }, [def, currentForm, avatarSrc]);

  /** ===== Sleep calculation ===== */
  function isSleepingAt(ts: number) {
    const { useAutoTime, sleepLocked, sleepStart, wakeTime } = sleepParamsRef.current;
    const d = new Date(ts);
    const H = d.getHours();
    const M = d.getMinutes();
    if (useAutoTime || sleepLocked === false) {
      // Auto: 22:00..08:30
      const after = H > 22 || (H === 22 && M >= 0);
      const before = H < 8 || (H === 8 && M < 30);
      return after || before;
    }
    const [ssH, ssM] = (sleepStart || "22:00").split(":").map((n) => +n || 0);
    const [wkH, wkM] = (wakeTime || "08:30").split(":").map((n) => +n || 0);
    const afterStart = H > ssH || (H === ssH && M >= ssM);
    const beforeWake = H < wkH || (H === wkH && M < wkM);
    // If window crosses midnight
    if (ssH > wkH || (ssH === wkH && ssM > wkM)) return afterStart || beforeWake;
    return afterStart && beforeWake;
  }

  /** ===== Day-2 catastrophe (once) ===== */
  const ageDays = Math.floor((Date.now() - startedAt) / (24 * 3600 * 1000));
  useEffect(() => {
    try {
      const done = localStorage.getItem(CATA_DONE_KEY);
      if (ageDays >= 2 && !done) {
        if (Math.random() < 0.8) {
          const cause = pickOne(CATASTROPHE_CAUSES);
          setCatastrophe({ cause, until: Date.now() + 60 * 1000 }); // ≈ 1 minute
        }
        localStorage.setItem(CATA_DONE_KEY, "1");
      }
    } catch {}
  }, [ageDays]);

  /** ===== Offline catch-up (respects sleep) ===== */
  useEffect(() => {
    try {
      const now = Date.now();
      const lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY) || now);
      const elapsed = Math.max(0, now - lastSeen);
      if (elapsed > 0) catchUp(elapsed);
      localStorage.setItem(LAST_SEEN_KEY, String(now));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // Persist lastSeen while app is open
    const save = () => localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
    const id = setInterval(save, 30000);
    window.addEventListener("visibilitychange", save);
    window.addEventListener("pagehide", save);
    window.addEventListener("beforeunload", save);
    return () => {
      clearInterval(id);
      window.removeEventListener("visibilitychange", save);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("beforeunload", save);
    };
  }, []);
  function catchUp(ms: number) {
    // Simulate per-minute steps, skip drain during sleep; cap to 48h for safety
    const step = 60 * 1000;
    const cap = Math.min(ms, 48 * 60 * 60 * 1000);
    let t = 0;
    let died = false;
    setStats((s0) => {
      let s = { ...s0 };
      while (t < cap && !died) {
        const ts = Date.now() - (cap - t);
        if (!isSleepingAt(ts)) {
          s.cleanliness -= (1 / (12 * 60 * 60 * 1000)) * step;
          s.hunger      -= (1 / (90 * 60 * 1000)) * step;
          s.happiness   -= (1 / (12 * 60 * 60 * 1000)) * step;
          s.health      -= (1 / (10 * 60 * 60 * 1000)) * step;
          s = clampStats(s);
          if (s.hunger <= 0 || s.health <= 0) died = true;
        }
        t += step;
      }
      if (died) {
        setIsDead(true);
        setDeathReason("offline collapse");
      }
      return clampStats(s);
    });
  }

  /** ===== Periodic stat drains / illness / poop ===== */
  useEffect(() => {
    let lastWall = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const dt = clampDt(now - lastWall);
      lastWall = now;
      if (deadRef.current) return;

      if (!isSleepingAt(now) && dt > 0) {
        const fast = catastropheRef.current && now < (catastropheRef.current?.until ?? 0);
        const hungerPerMs = fast ? 1 / 60000 : 1 / (90 * 60 * 1000);
        const healthPerMs = (sickRef.current ? 1 / (7 * 60 * 1000) : 1 / (10 * 60 * 60 * 1000));
        const happyPerMs  = sickRef.current ? 1 / (8 * 60 * 1000) : 1 / (12 * 60 * 60 * 1000);
        const dirtPerMs   = (poopsRef.current.length > 0 ? 1 / (5 * 60 * 60 * 1000) : 1 / (12 * 60 * 60 * 1000));

        setStats((s) => {
          const next: Stats = clampStats({
            cleanliness: s.cleanliness - dirtPerMs * dt,
            hunger:      s.hunger      - hungerPerMs * dt,
            happiness:   s.happiness   - happyPerMs  * dt,
            health:      s.health      - healthPerMs * dt,
          });
          if ((next.hunger <= 0 || next.health <= 0) && !deadRef.current) {
            setIsDead(true);
            setDeathReason(
              next.hunger <= 0
                ? "starvation"
                : catastropheRef.current && now < (catastropheRef.current?.until ?? 0)
                ? `fatal ${catastropheRef.current?.cause}`
                : sickRef.current
                ? "illness"
                : "collapse"
            );
          }
          return next;
        });
      }

      if (!isSleepingAt(now) && !deadRef.current) {
        if (Math.random() < 0.07) spawnPoop();
        const dirtFactor = Math.min(1, poopsRef.current.length / 5);
        const lowClean = 1 - statsRef.current.cleanliness;
        const p = 0.02 + 0.3 * dirtFactor + 0.2 * lowClean;
        if (!sickRef.current && Math.random() < p * 0.03) setIsSick(true);
        if (sickRef.current && Math.random() < 0.015) setIsSick(false);
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ===== Poops: load from localStorage on mount; persist on change ===== */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(POOPS_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as Poop[];
        if (Array.isArray(arr)) setPoops(arr.slice(0, 12));
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(POOPS_KEY, JSON.stringify(poops.slice(-12)));
    } catch {}
  }, [poops]);

  /** ===== Actions ===== */
  const canHeal = !isDead && Date.now() - lastHealAt >= HEAL_COOLDOWN_MS;

  const act = {
    feed: () => {
      if (deadRef.current) return;
      setStats((s) => clampStats({ ...s, hunger: s.hunger + 0.25, happiness: s.happiness + 0.05 }));
      if (Math.random() < 0.7) spawnPoop();
    },
    play: () => {
      if (deadRef.current) return;
      setStats((s) => clampStats({ ...s, happiness: s.happiness + 0.2, health: Math.min(1, s.health + 0.03) }));
    },
    clean: () => {
      if (deadRef.current) return;
      setPoops([]);
      setStats((s) => clampStats({ ...s, cleanliness: Math.max(s.cleanliness, 0.92), happiness: s.happiness + 0.02 }));
    },
    heal: () => {
      if (deadRef.current || !canHeal) return;
      setIsSick(false);
      setStats((s) => clampStats({ ...s, health: Math.min(1, s.health + 0.25), happiness: s.happiness + 0.05 }));
      setLastHealAt(Date.now());
    },
  };

  const spendLifeToRevive = () => {
    if (lives <= 0) return;
    onLoseLife();
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
  };

  function spawnPoop() {
    setPoops((arr) => {
      const x = 8 + Math.random() * (LOGICAL_W - 16);
      const src = pickOne(POOP_SRCS);
      const max = 12;
      const next = [...arr, { x, src }];
      return next.slice(-max);
    });
  }

  /** ===== Render loop (stable rAF with smart animation fallback) ===== */
  useEffect(() => {
    let alive = true;

    Promise.all(urls.map(loadImageSafe)).then((pairs) => {
      if (!alive) return;
      const images: Record<string, HTMLImageElement> = {};
      for (const it of pairs) if (it && it.img) images[it.src] = it.img;
      startLoop(images);
    });

    return () => {
      alive = false;
      cancelAnimationFrame((window as any).__wg_raf || 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls.join("|"), currentForm]);

  function startLoop(images: Record<string, HTMLImageElement>) {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    (ctx as any).imageSmoothingEnabled = false;

    // Size & DPR
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
    if ("ResizeObserver" in window) {
      ro = new (window as any).ResizeObserver(resize);
      ro.observe(wrap);
    } else {
      window.addEventListener("resize", resize);
    }
    resize();

    // Per-form draw constants
    const scale = SCALE[safeForm(currentForm)] ?? 1;
    const BASELINE = LOGICAL_H - BASE_GROUND + (BASELINE_NUDGE[safeForm(currentForm)] ?? 0);

    let dir: 1 | -1 = 1;
    let x = 40;

    let last = performance.now();
    let frameTimer = 0;
    const frameDuration = 1000 / FPS;

    const loop = (ts: number) => {
      (window as any).__wg_raf = requestAnimationFrame(loop);

      const dt = Math.min(100, ts - last);
      last = ts;

      // Clear
      ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

      // BG (no shift)
      const bg = images[BG_SRC];
      if (bg) {
        const scaleBG = Math.max(LOGICAL_W / bg.width, LOGICAL_H / bg.height);
        const dw = Math.floor(bg.width * scaleBG);
        const dh = Math.floor(bg.height * scaleBG);
        const dx = Math.floor((LOGICAL_W - dw) / 2);
        const dy = Math.floor((LOGICAL_H - dh) / 2);
        ctx.drawImage(bg, dx, dy, dw, dh);
      }

      // Avatar OVER BG (no shift)
      if (avatarSrc) {
        const av = images[avatarSrc];
        if (av) {
          const aw = 40, ah = 40;
          const padX = 10, padY = 4;
          const ax = LOGICAL_W - padX - aw;
          const ay = padY;
          (ctx as any).imageSmoothingEnabled = false;
          ctx.drawImage(av, ax, ay, aw, ah);

          // ❤️ HP%
          const hp = Math.round((statsRef.current.health ?? 0) * 100);
          const label = `❤️ ${hp}%`;
          ctx.font = "10px monospace";
          ctx.textBaseline = "alphabetic";
          const tw = ctx.measureText(label).width;
          const tx = ax + aw - tw - 2;
          const ty = ay + ah - 4;
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(0,0,0,0.75)";
          ctx.strokeText(label, tx, ty);
          ctx.fillStyle = "#fff";
          ctx.fillText(label, tx, ty);
        }
      }

      // Everything else shifted down
      ctx.save();
      ctx.translate(0, Y_SHIFT);

      // Poops
      const curPoops = poopsRef.current;
      if (curPoops.length) {
        for (const p of curPoops) {
          const img = images[p.src];
          const px = Math.round(p.x);
          const py = Math.round(BASELINE - 6);
          if (img) ctx.drawImage(img, px, py - 12, 12, 12);
          else {
            ctx.font = "10px monospace";
            ctx.fillText("💩", px, py);
          }
        }
      }

      // Which animation to use
      const sleepingNow = isSleepingAt(Date.now());
      const chosenAnim = (() => {
        if (deadRef.current) return "idle";
        if (sleepingNow) return def.sleep?.length ? "sleep" : "idle";
        if (sickRef.current) return def.sick?.length ? "sick" : "idle";
        if (statsRef.current.happiness < 0.35)
          return (def.sad?.length ? "sad" : def.unhappy?.length ? "unhappy" : "walk") as AnimKey;
        return animRef.current;
      })();

      // Smart frames selection with fallback to 'walk' if <2 frames and not sleeping
      let framesAll = (def[chosenAnim] ?? def.idle ?? def.walk ?? []) as string[];
      framesAll = framesAll.filter(Boolean);
      if (!sleepingNow && framesAll.length < 2 && def.walk && def.walk.length >= 2) {
        framesAll = def.walk; // keep motion so "walk" never visually freezes
      }
      const frames = framesAll.filter((u) => !!images[u]);

      const base = frames.length ? images[frames[0]] : undefined;
      const drawW = Math.round((base?.width ?? 32) * scale);
      const drawH = Math.round((base?.height ?? 32) * scale);

      // Movement (no movement while sleeping/dead)
      if (!deadRef.current && !sleepingNow) {
        x += (dir * WALK_SPEED * dt) / 1000;
        const minX = 0;
        const maxX = LOGICAL_W - drawW;
        if (x < minX) { x = minX; dir = 1; }
        else if (x > maxX) { x = maxX; dir = -1; }
      }

      // Frame switching
      frameTimer += dt;
      if (frameTimer > 1000000) frameTimer = frameTimer % 1000000; // prevent overflow
      let frameIndex = 0;
      if (frames.length >= 2) {
        const step = Math.floor(frameTimer / frameDuration);
        frameIndex = step % frames.length;
      }

      // Draw pet or dead sprite
      if (deadRef.current) {
        const deadSrc = DEAD_MAP[currentForm] ?? DEAD_FALLBACK;
        const deadImg = images[deadSrc];
        if (deadImg) {
          const w = Math.round(deadImg.width * scale);
          const h = Math.round(deadImg.height * scale);
          const ix = Math.round((LOGICAL_W - w) / 2);
          const iy = Math.round(BASELINE - h);
          ctx.drawImage(deadImg, ix, iy, w, h);
        }
      } else if (frames.length) {
        ctx.save();
        if (dir === -1) {
          const cx = Math.round(x + drawW / 2);
          ctx.translate(cx, 0);
          ctx.scale(-1, 1);
          ctx.translate(-cx, 0);
        }
        const ix = Math.round(x);
        const iy = Math.round(BASELINE - drawH);
        const img = images[frames[Math.min(frameIndex, frames.length - 1)]];
        if (img) ctx.drawImage(img, ix, iy, drawW, drawH);
        ctx.restore();
      }

      // Banners
      const cat = catastropheRef.current;
      if (cat && Date.now() < cat.until) drawBanner(ctx, LOGICAL_W, `⚠ ${cat.cause}! stats draining fast`);
      if (!deadRef.current && sleepingNow) drawBanner(ctx, LOGICAL_W, "😴 Sleeping");

      ctx.restore(); // end Y_SHIFT layer
    };

    (window as any).__wg_raf = requestAnimationFrame(loop);

    // Cleanup
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", resize);
      cancelAnimationFrame((window as any).__wg_raf || 0);
    };
  }

  /** ===== UI ===== */
  const DeathOverlay = isDead ? (
    <OverlayCard>
      <div style={{ fontSize: 18, marginBottom: 6 }}>Your pet has died</div>
      {deathReason && <div className="muted" style={{ marginBottom: 6 }}>Cause: {deathReason}</div>}
      <div className="muted" style={{ marginBottom: 12 }}>Lives left: <b>{lives}</b></div>
      {lives > 0 ? (
        <button className="btn btn-primary" onClick={spendLifeToRevive}>
          Spend 1 life to revive
        </button>
      ) : (
        <div className="muted">Transfer 1 NFT to get a life.</div>
      )}
    </OverlayCard>
  ) : null;

  return (
    <div style={{ width: "min(92vw, 100%)", maxWidth: MAX_W, margin: "0 auto" }}>
      {/* Canvas */}
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
        <canvas ref={canvasRef} style={{ display: "block", imageRendering: "pixelated", background: "transparent", borderRadius: 12 }} />
        {DeathOverlay}
      </div>

      {/* Bars */}
      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        <Bar label="Cleanliness" value={stats.cleanliness} h={BAR_H} />
        <Bar label="Hunger" value={stats.hunger} h={BAR_H} />
        <Bar label="Happiness" value={stats.happiness} h={BAR_H} />
      </div>

      {/* Actions */}
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          justifyContent: "center",
          opacity: isDead ? 0.5 : 1,
          pointerEvents: isDead ? ("none" as const) : ("auto" as const),
        }}
      >
        <button className="btn" onClick={act.feed}>🍗 Feed</button>
        <button className="btn" onClick={act.play}>🎮 Play</button>
        <button className="btn" onClick={act.heal} disabled={!canHeal}>
          💊 Heal{!canHeal ? " (cooldown)" : ""}
        </button>
        <button className="btn" onClick={act.clean}>🧻 Clean</button>
        <button className="btn" onClick={() => setAnim((a) => (a === "walk" ? "idle" : "walk"))}>Toggle Walk/Idle</button>
        {!!onEvolve && (
          <button className="btn btn-primary" onClick={() => onEvolve()}>
            ⭐ Evolve (debug)
          </button>
        )}
        <span className="muted" style={{ alignSelf: "center" }}>
          Poop: {poops.length} | Form: {currentForm} {isSick ? " | 🤒 Sick" : ""} {catastrophe && Date.now() < catastrophe.until ? " | ⚠ Event" : ""}
        </span>
      </div>

      {/* Sleep controls (one-time setup) */}
      <div
        style={{
          marginTop: 8,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 6, opacity: sleepLocked ? 0.5 : 1 }}>
          <input type="checkbox" checked={useAutoTime} disabled={sleepLocked} onChange={(e) => setUseAutoTime(e.target.checked)} />
          Auto local sleep 22:00–08:30
        </label>
        {!useAutoTime && (
          <>
            <span className="muted">Sleep:</span>
            <input className="input" type="time" value={sleepStart} disabled={sleepLocked} onChange={(e) => setSleepStart(e.target.value)} />
            <span className="muted">Wake:</span>
            <input className="input" type="time" value={wakeTime} disabled={sleepLocked} onChange={(e) => setWakeTime(e.target.value)} />
          </>
        )}
        {!sleepLocked ? (
          <button
            className="btn"
            onClick={() => {
              localStorage.setItem(SLEEP_FROM_KEY, sleepStart);
              localStorage.setItem(SLEEP_TO_KEY, wakeTime);
              localStorage.setItem(SLEEP_LOCK_KEY, "1");
              setSleepLocked(true);
              setUseAutoTime(false);
            }}
          >
            Save & lock
          </button>
        ) : (
          <span className="muted">Sleep window locked</span>
        )}
      </div>
    </div>
  );
}

/** ===== Helpers / UI bits ===== */
type AnimKey = "idle" | "walk" | "sick" | "sad" | "unhappy" | "sleep";
type AnyAnimSet = Partial<Record<AnimKey, string[]>>;

type Stats = { cleanliness: number; hunger: number; happiness: number; health: number };
type Poop = { x: number; src: string };
type Catastrophe = { cause: string; until: number };

const CATASTROPHE_CAUSES = ["food poisoning", "mysterious flu", "meteor dust", "bad RNG", "doom day syndrome"] as const;

function useLatest<T>(v: T) {
  const r = useRef(v);
  useEffect(() => {
    r.current = v;
  }, [v]);
  return r;
}
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
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x, 6, w, 18);
  ctx.fillStyle = "white";
  ctx.fillText(text, x + pad, y);
  ctx.restore();
}
function clampDt(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  if (ms < 0) return 0; // ignore backward jumps
  const MAX_FORWARD = 10 * 60 * 1000; // cap +10 min per tick
  return Math.min(ms, MAX_FORWARD);
}
async function loadImageSafe(src: string): Promise<{ src: string; img: HTMLImageElement } | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve({ src, img });
      img.onerror = () => resolve(null);
      img.src = src;
    } catch {
      resolve(null);
    }
  });
}

/** Simple rounded-rect path helper (used previously — kept in case you need it) */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
        <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg, rgba(124,77,255,0.9), rgba(0,200,255,0.9))" }} />
      </div>
    </div>
  );
}

/** Modal-like overlay card */
function OverlayCard({ children }: { children: React.ReactNode }) {
  return (
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
        {children}
      </div>
    </div>
  );
}
