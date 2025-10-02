// src/components/Tamagotchi.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FormKey, catalog } from "../game/catalog";

/**
 * Tamagotchi scene (stable)
 * - 3 стата: Cleanliness / Hunger / Happiness (+ внутренний Health)
 * - Болезни, какахи (png), событие 2-го дня (80% катастрофа на 1 минуту)
 * - Сон: авто 22:00–08:30 или ручная настройка ОДИН раз (Save & lock)
 * - Офлайн catch-up (пересчёт простоя)
 * - Анти-чит по времени (clamp dt)
 * - Устойчивый rAF (анимация ходьбы не замирает)
 * - Аватар рисуется в canvas сразу после BG (на «заднем фоне»)
 * - Все элементы сцены, кроме BG, опущены на 26px вниз
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
  /** ===== Consts ===== */
  const LOGICAL_W = 320;
  const LOGICAL_H = 180;
  const FPS = 6;
  const WALK_SPEED = 42; // px/s
  const MAX_W = 720;
  const CANVAS_H = 360;
  const BAR_H = 6;
  const BASE_GROUND = 48;

  const Y_SHIFT = 26;              // смещение вниз для ВСЕГО, кроме BG
  const HEAL_COOLDOWN_MS = 60_000; // перезарядка лечения

  // пер-форма тюнинги
  const SCALE: Partial<Record<FormKey, number>> = { egg: 0.66 };
  const BASELINE_NUDGE: Partial<Record<FormKey, number>> = { egg: +6 };

  // ассеты
  const BG_SRC = "/bg/BG.png";
  const POOP_SRCS = ["/sprites/poop/poop1.png", "/sprites/poop/poop2.png", "/sprites/poop/poop3.png"];
  const DEAD_MAP: Partial<Record<FormKey, string>> = {
    egg: "/sprites/dead/egg_dead.png",
  };
  const DEAD_FALLBACK = "/sprites/dead.png";

  // storage keys
  const START_TS_KEY = "wg_start_ts_v1";
  const LAST_SEEN_KEY = "wg_last_seen_v1";
  const CATA_DONE_KEY = "wg_catastrophe_done_v1";
  const SLEEP_LOCK_KEY = "wg_sleep_lock_v1";
  const SLEEP_FROM_KEY = "wg_sleep_from_v1";
  const SLEEP_TO_KEY = "wg_sleep_to_v1";

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

  // Сон: авто или ручной (Один раз — lock)
  const [useAutoTime, setUseAutoTime] = useState<boolean>(() => !localStorage.getItem(SLEEP_LOCK_KEY));
  const [sleepStart, setSleepStart] = useState<string>(() => localStorage.getItem(SLEEP_FROM_KEY) || "22:00");
  const [wakeTime, setWakeTime] = useState<string>(() => localStorage.getItem(SLEEP_TO_KEY) || "08:30");
  const [sleepLocked, setSleepLocked] = useState<boolean>(() => !!localStorage.getItem(SLEEP_LOCK_KEY));

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
  const [catastrophe, setCatastrophe] = useState<Catastrophe | null>(null);

  // Refs для устойчивого rAF
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

  // Canvas
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /** ===== Catalog / assets ===== */
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

  /** ===== Sleep calc ===== */
  function isSleepingAt(ts: number) {
    const { useAutoTime, sleepLocked, sleepStart, wakeTime } = sleepParamsRef.current;
    const d = new Date(ts);
    const H = d.getHours();
    const M = d.getMinutes();
    if (useAutoTime || sleepLocked === false) {
      // авто 22:00–08:30
      const after = H > 22 || (H === 22 && M >= 0);
      const before = H < 8 || (H === 8 && M < 30);
      return after || before;
    }
    const [ssH, ssM] = (sleepStart || "22:00").split(":").map((n) => +n || 0);
    const [wkH, wkM] = (wakeTime || "08:30").split(":").map((n) => +n || 0);
    const afterStart = H > ssH || (H === ssH && M >= ssM);
    const beforeWake = H < wkH || (H === wkH && M < wkM);
    if (ssH > wkH || (ssH === wkH && ssM > wkM)) return afterStart || beforeWake; // через полночь
    return afterStart && beforeWake;
  }

  /** ===== Day 2 catastrophe (один раз) ===== */
  const ageDays = Math.floor((Date.now() - startedAt) / (24 * 3600 * 1000));
  useEffect(() => {
    try {
      const done = localStorage.getItem(CATA_DONE_KEY);
      if (ageDays >= 2 && !done) {
        if (Math.random() < 0.8) {
          const cause = pickOne(CATASTROPHE_CAUSES);
          setCatastrophe({ cause, until: Date.now() + 60 * 1000 }); // ~1 минута
        }
        localStorage.setItem(CATA_DONE_KEY, "1");
      }
    } catch {}
  }, [ageDays]);

  /** ===== Offline catch-up ===== */
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
    const step = 60 * 1000; // 1 минута
    const cap = Math.min(ms, 48 * 60 * 60 * 1000); // не больше 48ч
    let t = 0;
    let died = false;
    setStats((s0) => {
      let s = { ...s0 };
      while (t < cap && !died) {
        const ts = Date.now() - (cap - t);
        if (!isSleepingAt(ts)) {
          // обычный дренаж
          s.cleanliness -= (1 / (12 * 60 * 60 * 1000)) * step;
          s.hunger -= (1 / (90 * 60 * 1000)) * step;
          s.happiness -= (1 / (12 * 60 * 60 * 1000)) * step;
          s.health -= (1 / (10 * 60 * 60 * 1000)) * step;
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

  /** ===== Stat ticks ===== */
  useEffect(() => {
    let lastWall = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const dt = clampDt(now - lastWall);
      lastWall = now;
      if (deadRef.current) return;
      if (!isSleepingAt(now) && dt > 0) {
        const fast = catastropheRef.current && Date.now() < (catastropheRef.current?.until ?? 0);
        const hungerPerMs = fast ? 1 / 60000 : 1 / (90 * 60 * 1000);
        const healthPerMs = (sickRef.current ? 1 / (7 * 60 * 1000) : 1 / (10 * 60 * 60 * 1000));
        const happyPerMs = sickRef.current ? 1 / (8 * 60 * 1000) : 1 / (12 * 60 * 60 * 1000);
        const dirtPerMs = (poopsRef.current.length > 0 ? 1 / (5 * 60 * 60 * 1000) : 1 / (12 * 60 * 60 * 1000));
        setStats((s) => {
          const next = clampStats({
            cleanliness: s.cleanliness - dirtPerMs * dt,
            hunger: s.hunger - hungerPerMs * dt,
            happiness: s.happiness - happyPerMs * dt,
            health: s.health - healthPerMs * dt,
          });
          if ((next.hunger <= 0 || next.health <= 0) && !deadRef.current) {
            setIsDead(true);
            setDeathReason(
              next.hunger <= 0
                ? "starvation"
                : catastropheRef.current && Date.now() < (catastropheRef.current?.until ?? 0)
                ? `fatal ${catastropheRef.current?.cause}`
                : sickRef.current
                ? "illness"
                : "collapse"
            );
          }
          return next;
        });
      }
      // poop & disease
      if (!deadRef.current && !isSleepingAt(now)) {
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
      const max = 8;
      const next = [...arr, { x, src }];
      return next.slice(-max);
    });
  }

  /** ===== Render loop (устойчивый) ===== */
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

    // размеры
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

    // параметры
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

      // очистка
      ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

      // BG без сдвига
      const bg = images[BG_SRC];
      if (bg) {
        const scaleBG = Math.max(LOGICAL_W / bg.width, LOGICAL_H / bg.height);
        const dw = Math.floor(bg.width * scaleBG);
        const dh = Math.floor(bg.height * scaleBG);
        const dx = Math.floor((LOGICAL_W - dw) / 2);
        const dy = Math.floor((LOGICAL_H - dh) / 2);
        ctx.drawImage(bg, dx, dy, dw, dh);
      }

      // всё остальное со сдвигом вниз
      ctx.save();
      ctx.translate(0, Y_SHIFT);

      // АВАТАР на заднем фоне (после BG, до сущностей)
      if (avatarSrc) {
        const av = images[avatarSrc];
        if (av) {
          const aw = 40, ah = 40, pad = 8;
          const ax = LOGICAL_W - pad - aw;
          const ay = pad;
          ctx.save();
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = "black";
          roundRect(ctx, ax - 2, ay - 2, aw + 4, ah + 4, 6);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.drawImage(av, ax, ay, aw, ah);
          ctx.restore();
        }
      }

      // поопсы
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

      // текущая анимация и кадры
      const chosenAnim = (() => {
        if (deadRef.current) return "idle";
        const nowSleeping = isSleepingAt(Date.now());
        if (nowSleeping) return def.sleep?.length ? "sleep" : "idle";
        if (sickRef.current) return def.sick?.length ? "sick" : "idle";
        if (statsRef.current.happiness < 0.35)
          return (def.sad?.length ? "sad" : def.unhappy?.length ? "unhappy" : "walk") as AnimKey;
        return animRef.current;
      })();
      const framesAll = (def[chosenAnim] ?? def.idle ?? def.walk ?? []) as string[];
      const frames = framesAll.filter((u) => !!images[u]);

      const base = frames.length ? images[frames[0]] : undefined;
      const drawW = Math.round((base?.width ?? 32) * scale);
      const drawH = Math.round((base?.height ?? 32) * scale);

      // движение
      if (!deadRef.current && !isSleepingAt(Date.now())) {
        x += (dir * WALK_SPEED * dt) / 1000;
        const minX = 0;
        const maxX = LOGICAL_W - drawW;
        if (x < minX) { x = minX; dir = 1; }
        else if (x > maxX) { x = maxX; dir = -1; }
      }

      // переключение кадров
      frameTimer += dt;
      let frameIndex = 0;
      if (frames.length) {
        const step = Math.floor(frameTimer / frameDuration);
        frameIndex = step % frames.length;
      }

      // рендер питомца / dead sprite
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
        const img = images[frames[frameIndex]];
        if (img) ctx.drawImage(img, ix, iy, drawW, drawH);
        ctx.restore();
      }

      // баннеры (тоже опущены)
      const cat = catastropheRef.current;
      if (cat && Date.now() < cat.until) drawBanner(ctx, LOGICAL_W, `⚠ ${cat.cause}! stats draining fast`);
      if (!deadRef.current && isSleepingAt(Date.now())) drawBanner(ctx, LOGICAL_W, "😴 Sleeping");

      ctx.restore(); // конец Y_SHIFT слоя
    };

    (window as any).__wg_raf = requestAnimationFrame(loop);

    // cleanup
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
  if (ms < 0) return 0; // назад — игнор
  const MAX_FORWARD = 10 * 60 * 1000; // не больше +10 минут за тик
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
