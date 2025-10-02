// src/components/Tamagotchi.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FormKey, catalog } from "../game/catalog";

/**
 * Wooligotchi — staged evolution with offline catch-up and sick avatars
 *
 * Evolution path:
 *   egg --(1 min total age)--> one of [chog_child | molandak_child | moyaki_child | we_child]
 *   *_child --(2 days total age)--> [Chog | Molandak | Moyaki | WE]   (adult)
 *
 * Rules:
 * - Age for evolution counts BOTH online (perf-based) and offline (wall-time catch-up, minute-by-minute, sleep respected).
 * - Illness and catastrophes are also simulated offline:
 *   - Catastrophes start after age >= 2 days: 90%/min; first 3 triggers are guaranteed overall (offline+online).
 * - Anti fast-forward while app is open: online aging uses performance.now(); offline catch-up clamps to 48h and simulates per minute.
 * - Sick avatars: when sick and 'sick' frames exist, the top-right avatar uses the sick frame.
 * - Comments: English only; UI text is minimal.
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
  onEvolve?: (next?: FormKey) => FormKey | void;
}) {
  /** ===== Canvas & world ===== */
  const LOGICAL_W = 320;
  const LOGICAL_H = 180;
  const FPS = 6;
  const WALK_SPEED = 42;
  const MAX_W = 720;
  const CANVAS_H = 360;
  const BAR_H = 6;
  const BASE_GROUND = 48;
  const Y_SHIFT = 26;
  const HEAL_COOLDOWN_MS = 60_000;

  /** ===== Evolution timing ===== */
  const EVOLVE_CHILD_AT = 60_000;             // 1 minute
  const EVOLVE_ADULT_AT = 2 * 24 * 3600_000;  // 2 days

  /** ===== Forms (must exist in catalog) ===== */
  const CHILD_CHOICES: FormKey[] = [
    "chog_child" as FormKey,
    "molandak_child" as FormKey,
    "moyaki_child" as FormKey,
    "we_child" as FormKey,
  ];
  const ADULT_MAP: Record<string, FormKey> = {
    chog_child: "Chog" as FormKey,
    molandak_child: "Molandak" as FormKey,
    moyaki_child: "Moyaki" as FormKey,
    we_child: "WE" as FormKey,
  };

  /** ===== Per-form tuning ===== */
  const SCALE: Partial<Record<FormKey, number>> = { egg: 0.66 };
  const BASELINE_NUDGE: Partial<Record<FormKey, number>> = { egg: +6 };

  /** ===== Assets ===== */
  const BG_SRC = "/bg/BG.png";
  const POOP_SRCS = ["/sprites/poop/poop1.png", "/sprites/poop/poop2.png", "/sprites/poop/poop3.png"];
  const DEAD_MAP: Partial<Record<FormKey, string>> = { egg: "/sprites/dead/egg_dead.png" };
  const DEAD_FALLBACK = "/sprites/dead.png";

  /** ===== Storage keys ===== */
  const LAST_SEEN_KEY = "wg_last_seen_v3";          // last wall-time seen
  const AGE_MS_KEY = "wg_age_ms_v4";                // total age (ms)
  const AGE_MAX_WALL_KEY = "wg_age_max_wall_v2";    // monotonic wall guard
  const POOPS_KEY = "wg_poops_v1";

  const SLEEP_LOCK_KEY = "wg_sleep_lock_v1";
  const SLEEP_FROM_KEY = "wg_sleep_from_v1";
  const SLEEP_TO_KEY   = "wg_sleep_to_v1";

  const CATA_COUNT_KEY = "wg_cata_count_v4";        // total catastrophe triggers (global)
  const CATA_AGE_ARMED_KEY = "wg_cata_age_armed_v1";// 1 when age >= 2d reached at least once

  /** ===== State ===== */
  const [anim, setAnim] = useState<AnimKey>("walk");
  const [stats, setStats] = useState<Stats>({ cleanliness: 0.9, hunger: 0.65, happiness: 0.6, health: 1.0 });
  const [poops, setPoops] = useState<Poop[]>([]);
  const [isSick, setIsSick] = useState(false);
  const [isDead, setIsDead] = useState(false);
  const [deathReason, setDeathReason] = useState<string | null>(null);
  const [lastHealAt, setLastHealAt] = useState<number>(0);

  // Sleep window
  const [useAutoTime, setUseAutoTime] = useState<boolean>(() => !localStorage.getItem(SLEEP_LOCK_KEY));
  const [sleepStart, setSleepStart] = useState<string>(() => localStorage.getItem(SLEEP_FROM_KEY) || "22:00");
  const [wakeTime, setWakeTime] = useState<string>(() => localStorage.getItem(SLEEP_TO_KEY) || "08:30");
  const [sleepLocked, setSleepLocked] = useState<boolean>(() => !!localStorage.getItem(SLEEP_LOCK_KEY));

  // Total age (ms)
  const [ageMs, setAgeMs] = useState<number>(() => {
    const v = Number(localStorage.getItem(AGE_MS_KEY) || 0);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  });

  // Catastrophe (online visual + fast drain window)
  const [catastrophe, setCatastrophe] = useState<Catastrophe | null>(null);

  /** ===== Stable refs ===== */
  const animRef = useLatest(anim);
  const statsRef = useLatest(stats);
  const sickRef = useLatest(isSick);
  const deadRef = useLatest(isDead);
  const poopsRef = useLatest(poops);
  const catastropheRef = useLatest(catastrophe);
  const ageRef = useLatest(ageMs);
  const sleepParamsRef = useRef({ useAutoTime, sleepStart, wakeTime, sleepLocked });
  useEffect(() => { sleepParamsRef.current = { useAutoTime, sleepStart, wakeTime, sleepLocked }; }, [useAutoTime, sleepStart, wakeTime, sleepLocked]);

  /** ===== Canvas refs ===== */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /** ===== Catalog / frames ===== */
  const safeForm = (f: FormKey) => (catalog[f] ? f : ("egg" as FormKey));
  const def = useMemo(() => (catalog[safeForm(currentForm)] || {}) as AnyAnimSet, [currentForm]);

  const urls = useMemo(() => {
    const set = new Set<string>();
    set.add(BG_SRC);
    (["idle", "walk", "sick", "sad", "unhappy", "sleep"] as AnimKey[]).forEach((k) => (def[k] ?? []).forEach((u) => set.add(u)));
    POOP_SRCS.forEach((u) => set.add(u));
    const dead = DEAD_MAP[currentForm] ?? DEAD_FALLBACK;
    if (dead) set.add(dead);
    return Array.from(set);
  }, [def, currentForm]);

  /** ===== Sleep calc ===== */
  function isSleepingAt(ts: number) {
    const { useAutoTime, sleepLocked, sleepStart, wakeTime } = sleepParamsRef.current;
    const d = new Date(ts);
    const H = d.getHours();
    const M = d.getMinutes();
    if (useAutoTime || sleepLocked === false) {
      const after = H > 22 || (H === 22 && M >= 0);
      const before = H < 8 || (H === 8 && M < 30);
      return after || before;
    }
    const [ssH, ssM] = (sleepStart || "22:00").split(":").map((n) => +n || 0);
    const [wkH, wkM] = (wakeTime || "08:30").split(":").map((n) => +n || 0);
    const afterStart = H > ssH || (H === ssH && M >= ssM);
    const beforeWake = H < wkH || (H === wkH && M < wkM);
    if (ssH > wkH || (ssH === wkH && ssM > wkM)) return afterStart || beforeWake; // crosses midnight
    return afterStart && beforeWake;
  }

  /** ===== Offline catch-up (age + stats + illness + catastrophes) ===== */
  useEffect(() => {
    try {
      const nowWall = Date.now();
      const lastWall = Number(localStorage.getItem(LAST_SEEN_KEY) || nowWall);
      const prevMax = Number(localStorage.getItem(AGE_MAX_WALL_KEY) || lastWall);
      // Monotonic guard
      const wallForElapsed = Math.max(nowWall, prevMax);
      const rawElapsed = wallForElapsed - lastWall;
      const elapsed = Math.max(0, Math.min(rawElapsed, 48 * 3600_000)); // clamp 48h

      if (elapsed > 0) {
        const startingAge = Number(localStorage.getItem(AGE_MS_KEY) || 0);
        const cataCount0 = Number(localStorage.getItem(CATA_COUNT_KEY) || 0);
        const res = simulateOffline({
          startWall: lastWall,
          minutes: Math.floor(elapsed / 60000),
          startAgeMs: startingAge,
          startStats: { ...statsRef.current },
          startSick: sickRef.current,
          cataCount0,
          sleepCheck: isSleepingAt,
        });
        // Apply final results
        setStats((_) => clampStats(res.stats));
        setIsSick(res.sick);
        // Increase catastrophe count
        if (res.cataIncrements > 0) {
          localStorage.setItem(CATA_COUNT_KEY, String(cataCount0 + res.cataIncrements));
        }
        // Age increases offline by elapsed
        setAgeMs((ms) => ms + elapsed);
      }

      localStorage.setItem(LAST_SEEN_KEY, String(nowWall));
      localStorage.setItem(AGE_MAX_WALL_KEY, String(Math.max(prevMax, nowWall)));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ===== Online age ticker (anti fast-forward while open) ===== */
  useEffect(() => {
    let lastPerf = performance.now();
    const id = window.setInterval(() => {
      const nowPerf = performance.now();
      let dt = nowPerf - lastPerf;
      if (!Number.isFinite(dt) || dt < 0) dt = 0;
      dt = Math.min(dt, 1000); // <= 1s per tick
      lastPerf = nowPerf;
      setAgeMs((v) => v + dt);
    }, 1000 / 6);
    return () => clearInterval(id);
  }, []);

  /** ===== Persist last seen and age often ===== */
  useEffect(() => {
    const save = () => {
      try {
        const now = Date.now();
        localStorage.setItem(LAST_SEEN_KEY, String(now));
        const prevMax = Number(localStorage.getItem(AGE_MAX_WALL_KEY) || now);
        localStorage.setItem(AGE_MAX_WALL_KEY, String(Math.max(prevMax, now)));
        localStorage.setItem(AGE_MS_KEY, String(ageRef.current));
      } catch {}
    };
    const id = setInterval(save, 15_000);
    window.addEventListener("visibilitychange", save);
    window.addEventListener("pagehide", save);
    window.addEventListener("beforeunload", save);
    return () => {
      clearInterval(id);
      window.removeEventListener("visibilitychange", save);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("beforeunload", save);
      try { localStorage.setItem(AGE_MS_KEY, String(ageRef.current)); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ===== Apply evolution thresholds (order-safe) ===== */
  useEffect(() => {
    if (!onEvolve) return;

    // Arm catastrophe system flag when crossing 2d at least once (for reference)
    if (ageMs >= EVOLVE_ADULT_AT && localStorage.getItem(CATA_AGE_ARMED_KEY) !== "1") {
      try { localStorage.setItem(CATA_AGE_ARMED_KEY, "1"); } catch {}
    }

    // Step 1: egg -> random child at 1 min
    if (isEgg(currentForm) && ageMs >= EVOLVE_CHILD_AT) {
      const next = pickOne(CHILD_CHOICES);
      onEvolve(next);
      return;
    }
    // Step 2: *_child -> adult at 2 days
    if (isChild(currentForm) && ageMs >= EVOLVE_ADULT_AT) {
      const adult = ADULT_MAP[String(currentForm)];
      if (adult) onEvolve(adult);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ageMs, currentForm]);

  /** ===== Online periodic drains / illness / poop / catastrophe banner ===== */
  useEffect(() => {
    let lastWall = Date.now();
    let lastMinuteGate = -1;

    const id = window.setInterval(() => {
      const now = Date.now();
      const dt = clampDt(now - lastWall);
      lastWall = now;
      if (deadRef.current) return;

      const sleeping = isSleepingAt(now);
      if (!sleeping && dt > 0) {
        const fast = catastropheRef.current && now < (catastropheRef.current?.until ?? 0);
        const hungerPerMs = fast ? 1 / 60000 : 1 / (90 * 60 * 1000);
        const healthPerMs = sickRef.current ? 1 / (7 * 60 * 1000) : 1 / (10 * 60 * 60 * 1000);
        const happyPerMs  = sickRef.current ? 1 / (8 * 60 * 1000) : 1 / (12 * 60 * 60 * 1000);
        const dirtPerMs   = (poopsRef.current.length > 0 ? 1 / (5 * 60 * 60 * 1000) : 1 / (12 * 60 * 60 * 1000));

        setStats((s) => {
          const next = clampStats({
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

      if (!sleeping && !deadRef.current) {
        if (Math.random() < 0.07) spawnPoop();
        const dirtFactor = Math.min(1, poopsRef.current.length / 5);
        const lowClean = 1 - statsRef.current.cleanliness;
        const p = 0.02 + 0.3 * dirtFactor + 0.2 * lowClean;
        if (!sickRef.current && Math.random() < p * 0.03) setIsSick(true);
        if (sickRef.current && Math.random() < 0.015) setIsSick(false);
      }

      // Catastrophe banner roll once per (approx) minute after age >= 2d
      const gateMinute = Math.floor(now / 60000);
      if (ageRef.current >= EVOLVE_ADULT_AT && gateMinute !== lastMinuteGate) {
        lastMinuteGate = gateMinute;
        const currentCount = Number(localStorage.getItem(CATA_COUNT_KEY) || 0);
        const must = currentCount < 3;
        const roll = Math.random() < 0.9;
        if ((must || roll) && !deadRef.current) {
          const cause = pickOne(CATASTROPHE_CAUSES);
          setCatastrophe({ cause, until: now + 60_000 });
          localStorage.setItem(CATA_COUNT_KEY, String(currentCount + 1));
        }
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ===== Poops load/save ===== */
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
    try { localStorage.setItem(POOPS_KEY, JSON.stringify(poops.slice(-12))); } catch {}
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

  /** ===== Render loop (with sick avatar support) ===== */
  useEffect(() => {
    let alive = true;
    const urlsFull = Array.from(new Set([...urls, BG_SRC]));
    Promise.all(urlsFull.map(loadImageSafe)).then((pairs) => {
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

    // Sizing
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

    const scale = SCALE[safeForm(currentForm)] ?? 1;
    const BASELINE = LOGICAL_H - BASE_GROUND + (BASELINE_NUDGE[safeForm(currentForm)] ?? 0);

    let dir: 1 | -1 = 1;
    let x = 40;

    let last = performance.now();
    let frameTimer = 0;

    const loop = (ts: number) => {
      (window as any).__wg_raf = requestAnimationFrame(loop);
      const dt = Math.min(100, ts - last);
      last = ts;

      // Clear
      ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

      // BG
      const bg = images[BG_SRC];
      if (bg) {
        const scaleBG = Math.max(LOGICAL_W / bg.width, LOGICAL_H / bg.height);
        const dw = Math.floor(bg.width * scaleBG);
        const dh = Math.floor(bg.height * scaleBG);
        const dx = Math.floor((LOGICAL_W - dw) / 2);
        const dy = Math.floor((LOGICAL_H - dh) / 2);
        ctx.drawImage(bg, dx, dy, dw, dh);
      }

      // Avatar (top-right) — picks sick frame if sick & available
      const now = Date.now();
      const sleepingNow = isSleepingAt(now);
      const avatarAnimKey: AnimKey = (() => {
        if (deadRef.current) return "idle";
        if (sleepingNow) return def.sleep?.length ? "sleep" : "idle";
        if (sickRef.current && (def.sick?.length ?? 0) > 0) return "sick";
        if (statsRef.current.happiness < 0.35) return (def.sad?.length ? "sad" : def.unhappy?.length ? "unhappy" : "idle") as AnimKey;
        return def.idle?.length ? "idle" : "walk";
      })();
      const avatarFrames = (def[avatarAnimKey] ?? def.idle ?? def.walk ?? []) as string[];
      const avatarSrc = avatarFrames[0];
      if (avatarSrc && images[avatarSrc]) {
        const av = images[avatarSrc];
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

      // Shifted world
      ctx.save();
      ctx.translate(0, Y_SHIFT);

      // Poops
      const curPoops = poopsRef.current;
      if (curPoops.length) {
        for (const p of curPoops) {
          const img = images[p.src];
          const px = Math.round(p.x);
          const py = Math.round(LOGICAL_H - BASE_GROUND - 6);
          if (img) ctx.drawImage(img, px, py - 12, 12, 12);
          else { ctx.font = "10px monospace"; ctx.fillText("💩", px, py); }
        }
      }

      // Main anim key (world sprite)
      const chosenAnim: AnimKey = (() => {
        if (deadRef.current) return "idle";
        if (sleepingNow) return def.sleep?.length ? "sleep" : "idle";
        if (sickRef.current) return def.sick?.length ? "sick" : "idle";
        if (statsRef.current.happiness < 0.35)
          return (def.sad?.length ? "sad" : def.unhappy?.length ? "unhappy" : "walk") as AnimKey;
        return animRef.current;
      })();

      let framesAll = (def[chosenAnim] ?? def.idle ?? def.walk ?? []) as string[];
      framesAll = framesAll.filter(Boolean);
      if (!sleepingNow && framesAll.length < 2 && def.walk && def.walk.length >= 2) {
        framesAll = def.walk; // maintain motion
      }
      const frames = framesAll.filter((u) => !!images[u]);

      const base = frames.length ? images[frames[0]] : undefined;
      const drawW = Math.round((base?.width ?? 32) * scale);
      const drawH = Math.round((base?.height ?? 32) * scale);

      // Movement
      if (!deadRef.current && !sleepingNow) {
        x += (dir * WALK_SPEED * dt) / 1000;
        const minX = 0, maxX = LOGICAL_W - drawW;
        if (x < minX) { x = minX; dir = 1; }
        else if (x > maxX) { x = maxX; dir = -1; }
      }

      // Frame switch
      frameTimer += dt;
      if (frameTimer > 1e6) frameTimer %= 1e6;
      let frameIndex = 0;
      if (frames.length >= 2) {
        const step = Math.floor(frameTimer / (1000 / FPS));
        frameIndex = step % frames.length;
      }

      // Draw pet / dead
      if (deadRef.current) {
        const deadSrc = DEAD_MAP[currentForm] ?? DEAD_FALLBACK;
        const deadImg = images[deadSrc];
        if (deadImg) {
          const w = Math.round(deadImg.width * scale);
          const h = Math.round(deadImg.height * scale);
          const ix = Math.round((LOGICAL_W - w) / 2);
          const iy = Math.round(LOGICAL_H - BASE_GROUND - h);
          ctx.drawImage(deadImg, ix, iy, w, h);
        }
      } else if (frames.length) {
        ctx.save();
        if (dir === -1) {
          const cx = Math.round(x + drawW / 2);
          ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0);
        }
        const ix = Math.round(x);
        const iy = Math.round(LOGICAL_H - BASE_GROUND - drawH);
        const img = images[frames[Math.min(frameIndex, frames.length - 1)]];
        if (img) ctx.drawImage(img, ix, iy, drawW, drawH);
        ctx.restore();
      }

      // Banners
      const cat = catastropheRef.current;
      if (cat && now < cat.until) drawBanner(ctx, LOGICAL_W, `⚠ ${cat.cause}! stats draining fast`);
      if (!deadRef.current && sleepingNow) drawBanner(ctx, LOGICAL_W, "😴 Sleeping");

      ctx.restore();
    };

    (window as any).__wg_raf = requestAnimationFrame(loop);

    return () => {
      if (ro) ro.disconnect(); else window.removeEventListener("resize", resize);
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
        <button className="btn btn-primary" onClick={spendLifeToRevive}>Spend 1 life to revive</button>
      ) : (
        <div className="muted">Transfer 1 NFT to get a life.</div>
      )}
    </OverlayCard>
  ) : null;

  return (
    <div style={{ width: "min(92vw, 100%)", maxWidth: MAX_W, margin: "0 auto" }}>
      <div
        ref={wrapRef}
        style={{
          width: "100%", height: CANVAS_H, position: "relative",
          imageRendering: "pixelated", overflow: "hidden",
          background: "transparent", borderRadius: 12, margin: "0 auto",
        }}
      >
        <canvas ref={canvasRef} style={{ display: "block", imageRendering: "pixelated", background: "transparent", borderRadius: 12 }} />
        {DeathOverlay}
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        <Bar label="Cleanliness" value={stats.cleanliness} h={BAR_H} />
        <Bar label="Hunger" value={stats.hunger} h={BAR_H} />
        <Bar label="Happiness" value={stats.happiness} h={BAR_H} />
      </div>

      <div
        style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center",
          opacity: isDead ? 0.5 : 1, pointerEvents: isDead ? ("none" as const) : ("auto" as const) }}
      >
        <button className="btn" onClick={act.feed}>🍗 Feed</button>
        <button className="btn" onClick={act.play}>🎮 Play</button>
        <button className="btn" onClick={act.heal} disabled={!canHeal}>💊 Heal{!canHeal ? " (cooldown)" : ""}</button>
        <button className="btn" onClick={act.clean}>🧻 Clean</button>
        <button className="btn" onClick={() => setAnim((a) => (a === "walk" ? "idle" : "walk"))}>Toggle Walk/Idle</button>
        {!!onEvolve && <button className="btn btn-primary" onClick={() => onEvolve()}>⭐ Evolve (debug)</button>}
        <span className="muted" style={{ alignSelf: "center" }}>
          Poop: {poops.length} | Form: {currentForm} {isSick ? " | 🤒 Sick" : ""} {catastrophe && Date.now() < catastrophe.until ? " | ⚠ Event" : ""} | Age: {(ageMs/1000|0)}s
        </span>
      </div>

      <div
        style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "center" }}
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

/** ===== Types / helpers ===== */
type AnimKey = "idle" | "walk" | "sick" | "sad" | "unhappy" | "sleep";
type AnyAnimSet = Partial<Record<AnimKey, string[]>>;
type Stats = { cleanliness: number; hunger: number; happiness: number; health: number };
type Poop = { x: number; src: string };
type Catastrophe = { cause: string; until: number };
const CATASTROPHE_CAUSES = ["food poisoning", "mysterious flu", "meteor dust", "bad RNG", "doom day syndrome"] as const;

function isEgg(f: FormKey) { return f === "egg"; }
function isChild(f: FormKey) {
  const s = String(f);
  return s.endsWith("_child");
}

function useLatest<T>(v: T) {
  const r = useRef(v);
  useEffect(() => { r.current = v; }, [v]);
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
function applyDelta(s: Stats, d: Partial<Stats>): Stats {
  return clampStats({
    cleanliness: s.cleanliness + (d.cleanliness ?? 0),
    hunger: s.hunger + (d.hunger ?? 0),
    happiness: s.happiness + (d.happiness ?? 0),
    health: s.health + (d.health ?? 0),
  });
}
function pickOne<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }
function drawBanner(ctx: CanvasRenderingContext2D, width: number, text: string) {
  const pad = 4;
  ctx.save();
  ctx.font = "12px monospace";
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const x = Math.round((width - w) / 2);
  const y = 18;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
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
      img.onerror = () => resolve(null);
      img.src = src;
    } catch {
      resolve(null);
    }
  });
}

/**
 * Offline minute-by-minute simulation.
 * - Applies stat drains only when not sleeping.
 * - Rolls illness on each active minute (probabilities align with online tick).
 * - Rolls catastrophes after age >= 2d; first 3 total are guaranteed (uses CATA_COUNT_KEY).
 */
function simulateOffline(args: {
  startWall: number;           // last seen wall time (ms)
  minutes: number;             // number of minutes to simulate
  startAgeMs: number;          // age before offline period (ms)
  startStats: Stats;           // starting stats snapshot
  startSick: boolean;          // starting sick flag
  cataCount0: number;          // initial catastrophe count from storage
  sleepCheck: (ts: number) => boolean;
}): { stats: Stats; sick: boolean; cataIncrements: number } {
  let s = { ...args.startStats };
  let sick = args.startSick;
  let cataIncrements = 0;

  // Per-minute deltas based on same rates as online interval
  const hungerPerMinNormal = 1 / (90);      // 1 per 90 min -> per minute
  const healthPerMinNormal = 1 / (10 * 60); // 1 per 600 min
  const happyPerMinNormal  = 1 / (12 * 60); // 1 per 720 min
  const dirtPerMinNormal   = 1 / (12 * 60);

  const healthPerMinSick = 1 / 7;           // ~7 min to drop 1 (fast)
  const happyPerMinSick  = 1 / 8;

  const hungerPerMinFast = 1;               // catastrophe: drains hunger to 0 in ~1 minute

  const startAge = args.startAgeMs;
  let ageAtMinuteStart = startAge;

  for (let i = 0; i < args.minutes; i++) {
    const minuteWall = args.startWall + i * 60000;
    const sleeping = args.sleepCheck(minuteWall);

    // Evolution age grows regardless of sleep (we count real elapsed minutes)
    ageAtMinuteStart += 60000;

    // Catastrophe roll gate (after 2d)
    let catastropheActive = false;
    if (ageAtMinuteStart >= 2 * 24 * 3600_000) {
      const currentCount = Number(localStorage.getItem("wg_cata_count_v4") || args.cataCount0);
      const must = currentCount + cataIncrements < 3;
      const roll = Math.random() < 0.9;
      if (must || roll) {
        catastropheActive = true;
        cataIncrements += 1;
      }
    }

    if (!sleeping) {
      const hungerDrop = catastropheActive ? hungerPerMinFast : hungerPerMinNormal;
      const healthDrop = sick ? healthPerMinSick : healthPerMinNormal;
      const happyDrop  = sick ? happyPerMinSick  : happyPerMinNormal;
      const dirtDrop   = dirtPerMinNormal;

      s = clampStats({
        cleanliness: s.cleanliness - dirtDrop,
        hunger:      s.hunger      - hungerDrop,
        happiness:   s.happiness   - happyDrop,
        health:      s.health      - healthDrop,
      });

      // Illness flip probabilities (scaled from online small-step)
      if (!sick) {
        const dirtFactor = 0.3; // coarse approximation offline
        const lowClean = 1 - s.cleanliness;
        const p = 0.02 + 0.3 * dirtFactor + 0.2 * lowClean; // base minute "pressure"
        if (Math.random() < p * 0.03 * 60) sick = true;     // integrate ~per minute
      } else {
        if (Math.random() < 0.015 * 60) sick = false;       // chance to recover over minutes
      }
    }

    // Stop early if dead offline
    if (s.hunger <= 0 || s.health <= 0) {
      // If dead offline, we keep stats clamped and break (will show dead on mount)
      s = clampStats(s);
      break;
    }
  }

  return { stats: clampStats(s), sick, cataIncrements };
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
