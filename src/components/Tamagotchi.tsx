// src/components/Tamagotchi.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { catalog, type FormKey, type AnimSet as AnyAnimSet } from "../game/catalog";

/** ===== Visual & behavior constants ===== */
const DEAD_FALLBACK = "/sprites/dead.png";

/** Avatar scaling in HUD (top-right):
 * - If AVATAR_SCALE_CAP is a number, avatar is only scaled DOWN to fit the cap.
 * - If AVATAR_SCALE_CAP is null, avatar is never scaled (original pixel size).
 */
const AVATAR_SCALE_CAP: number | null = null; // no autoscale per user request

/** World sprite scaling (stage, not HUD):
 * - EGG_SCALE shrinks the egg sprite.
 * - NON_EGG_SCALE shrinks non-egg forms relative to egg raw height (keeps a consistent world size).
 */
const EGG_SCALE = 0.50;     // smaller egg in the world
const NON_EGG_SCALE = 0.62; // tuned to keep parity vs egg target height
const INVERT_WALK_FACING = false;

/** Evolution timing */
const EVOLVE_CHILD_AT = 60_000;             // egg -> child after 1 minute total age
const EVOLVE_ADULT_AT = 2 * 24 * 3600_000;  // child -> adult after 2 days total age

/** Asset constants (UI helpers) */
const BG_SRC = "/bg/BG.png";
const POOP_SRCS = ["/sprites/poop/poop1.png", "/sprites/poop/poop2.png", "/sprites/poop/poop3.png"];

/** Food throw (3-frame) animation assets.
 * Drop your files here (any size). Fallbacks (emoji) are used if missing.
 * Folder suggestions:
 *   /public/sprites/ui/food/burger/000.png,001.png,002.png
 *   /public/sprites/ui/food/cake/000.png,001.png,002.png
 */
const FEED_FRAMES = {
  burger: ["/sprites/ui/food/burger/000.png", "/sprites/ui/food/burger/001.png", "/sprites/ui/food/burger/002.png"],
  cake:   ["/sprites/ui/food/cake/000.png",   "/sprites/ui/food/cake/001.png",   "/sprites/ui/food/cake/002.png"],
} as const;

/** Scoop (cleaning) sprite.
 * Put image to: /public/sprites/ui/scoop.png
 * Any aspect ratio is fine; will be autoscaled to reasonable height.
 */
const SCOOP_SRC = "/sprites/ui/scoop.png";

/** Storage keys */
const START_TS_KEY = "wg_start_ts_v2";
const LAST_SEEN_KEY = "wg_last_seen_v3";
const AGE_MS_KEY = "wg_age_ms_v4";
const AGE_MAX_WALL_KEY = "wg_age_max_wall_v2";
const POOPS_KEY = "wg_poops_v1";
const SLEEP_LOCK_KEY = "wg_sleep_lock_v1";
const SLEEP_FROM_KEY = "wg_sleep_from_v1";
const SLEEP_TO_KEY = "wg_sleep_to_v1";

/** Catastrophes schedule (absolute UTC ms) */
const CATA_SCHEDULE_KEY = "wg_cata_schedule_v2";
const CATA_CONSUMED_KEY = "wg_cata_consumed_v2";
const CATA_DURATION_MS = 60_000; // 1 minute visually + fast drain
const CATASTROPHE_CAUSES = ["food poisoning", "mysterious flu", "meteor dust", "bad RNG", "doom day syndrome"] as const;

/** Game field layout constants */
const LOGICAL_W = 320, LOGICAL_H = 180;
const FPS = 6, WALK_SPEED = 42;
const MAX_W = 720, CANVAS_H = 360;
const BAR_H = 6, BASE_GROUND = 48, Y_SHIFT = 26;
const HEAL_COOLDOWN_MS = 60_000;

/** Food logic constants */
const FEED_COOLDOWN_MS = 5_000;   // per button
const FEED_ANIM_TOTAL_MS = 600;   // total duration for 3 frames
const FEED_FRAMES_COUNT = 3;      // exactly 3 frames
const FEED_EFFECTS = {
  burger: { hunger: +0.28, happiness: +0.06 },
  cake:   { hunger: +0.22, happiness: +0.12 },
};

/** Cleaning (scoop) constants */
const SCOOP_SPEED_PX_S = 160;        // horizontal speed
const SCOOP_CLEAR_RADIUS = 18;       // distance to poop center to clear
const SCOOP_HEIGHT_TARGET = 22;      // target drawn height in logical px
const CLEAN_FINISH_CLEANLINESS = 0.95; // clamp up to this on finish

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
  /** Forms */
  const CHILD_CHOICES: FormKey[] = ["chog_child", "molandak_child", "moyaki_child", "we_child"];
  const ADULT_MAP: Record<string, FormKey> = {
    chog_child: "Chog",
    molandak_child: "Molandak",
    moyaki_child: "Moyaki",
    we_child: "WE",
  };

  /** Normalize any legacy names */
  const normalizeForm = (f: string): FormKey => {
    const map: Record<string, FormKey> = {
      char1: "chog_child",       char1_adult: "Chog",
      char2: "molandak_child",   char2_adult: "Molandak",
      char3: "moyaki_child",     char3_adult: "Moyaki",
      char4: "we_child",         char4_adult: "WE",
    };
    const nf = (map[f] || f) as FormKey;
    return (catalog[nf] ? nf : "egg") as FormKey;
  };

  /** Controlled->uncontrolled handoff:
   * We only sync currentForm ONCE on mount to avoid parent re-overriding our evolution (was causing "always Chog").
   */
  const firstSyncDone = useRef(false);
  const [form, setForm] = useState<FormKey>(() => normalizeForm(currentForm));
  useEffect(() => {
    if (!firstSyncDone.current) {
      setForm(normalizeForm(currentForm));
      firstSyncDone.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentForm]);

  /** Core state */
  const [anim, setAnim] = useState<AnimKey>("walk");
  const [stats, setStats] = useState<Stats>({ cleanliness: 0.9, hunger: 0.65, happiness: 0.6, health: 1.0 });
  const [poops, setPoops] = useState<Poop[]>([]);
  const [isSick, setIsSick] = useState(false);
  const [isDead, setIsDead] = useState(false);
  const [deathReason, setDeathReason] = useState<string | null>(null);
  const [lastHealAt, setLastHealAt] = useState<number>(0);

  /** Food cooldowns & animation state */
  const [lastBurgerAt, setLastBurgerAt] = useState<number>(0);
  const [lastCakeAt, setLastCakeAt] = useState<number>(0);
  const [foodAnim, setFoodAnim] = useState<FoodAnim | null>(null);

  /** Cleaning (scoop) animation state */
  const [cleaning, setCleaning] = useState<ScoopState | null>(null);

  /** Sleep window */
  const [useAutoTime, setUseAutoTime] = useState<boolean>(() => !localStorage.getItem(SLEEP_LOCK_KEY));
  const [sleepStart, setSleepStart] = useState<string>(() => localStorage.getItem(SLEEP_FROM_KEY) || "22:00");
  const [wakeTime, setWakeTime] = useState<string>(() => localStorage.getItem(SLEEP_TO_KEY) || "08:30");
  const [sleepLocked, setSleepLocked] = useState<boolean>(() => !!localStorage.getItem(SLEEP_LOCK_KEY));

  /** Age (monotonic total age in ms) */
  const [ageMs, setAgeMs] = useState<number>(() => {
    const v = Number(localStorage.getItem(AGE_MS_KEY) || 0);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  });

  /** Current catastrophe window */
  const [catastrophe, setCatastrophe] = useState<Catastrophe | null>(null);

  /** Stable refs */
  const animRef = useLatest(anim);
  const statsRef = useLatest(stats);
  const sickRef = useLatest(isSick);
  const deadRef = useLatest(isDead);
  const poopsRef = useLatest(poops);
  const catastropheRef = useLatest(catastrophe);
  const ageRef = useLatest(ageMs);
  const formRef = useLatest(form);
  const foodAnimRef = useLatest(foodAnim);
  const cleaningRef = useLatest(cleaning);

  // last drawn pet rect, used to anchor food animation near the pet's head
  const petRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const sleepParamsRef = useRef({ useAutoTime, sleepStart, wakeTime, sleepLocked });
  useEffect(() => { sleepParamsRef.current = { useAutoTime, sleepStart, wakeTime, sleepLocked }; }, [useAutoTime, sleepStart, wakeTime, sleepLocked]);

  /** Canvas & RAF */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null); // single RAF guard

  /** Catalog / frames */
  const safeForm = (f: FormKey) => (catalog[f] ? f : ("egg" as FormKey));
  const def = useMemo(() => (catalog[safeForm(form)] || {}) as AnyAnimSet, [form]);

  /** Preload */
  const urls = useMemo(() => {
    const set = new Set<string>();
    set.add(BG_SRC);
    (["idle","walk","sick","sad","unhappy","sleep"] as AnimKey[]).forEach(k => (def[k] ?? []).forEach(u => set.add(u)));
    POOP_SRCS.forEach(u => set.add(u));
    // food anim frames
    FEED_FRAMES.burger.forEach(u => set.add(u));
    FEED_FRAMES.cake.forEach(u => set.add(u));
    // scoop
    set.add(SCOOP_SRC);
    // dead candidates and egg frames (for autoscale reference)
    deadCandidates(form).forEach(u => set.add(u));
    const egg = catalog["egg"] || {};
    (egg.idle ?? egg.walk ?? []).forEach(u => set.add(u));
    return Array.from(set);
  }, [def, form]);

  /** Start timestamp (for catastrophe schedule) */
  const [startTs] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(START_TS_KEY);
      if (raw) return Number(raw);
      const now = Date.now();
      localStorage.setItem(START_TS_KEY, String(now));
      return now;
    } catch { return Date.now(); }
  });

  /** Sleep checker */
  function isSleepingAt(ts: number) {
    const { useAutoTime, sleepLocked, sleepStart, wakeTime } = sleepParamsRef.current;
    const d = new Date(ts);
    const H = d.getHours(), M = d.getMinutes();
    if (useAutoTime || sleepLocked === false) {
      const after = H > 22 || (H === 22 && M >= 0);
      const before = H < 8 || (H === 8 && M < 30);
      return after || before;
    }
    const [ssH, ssM] = (sleepStart || "22:00").split(":").map(n => +n || 0);
    const [wkH, wkM] = (wakeTime || "08:30").split(":").map(n => +n || 0);
    const afterStart = H > ssH || (H === ssH && M >= ssM);
    const beforeWake = H < wkH || (H === wkH && M < wkM);
    if (ssH > wkH || (ssH === wkH && ssM > wkM)) return afterStart || beforeWake; // crosses midnight
    return afterStart && beforeWake;
  }

  /** Generate catastrophe schedule */
  useEffect(() => {
    try {
      const schedRaw = localStorage.getItem(CATA_SCHEDULE_KEY);
      const consumedRaw = localStorage.getItem(CATA_CONSUMED_KEY);
      let schedule: number[] = schedRaw ? JSON.parse(schedRaw) : [];
      const consumed: number[] = consumedRaw ? JSON.parse(consumedRaw) : [];

      // +1 minute catastrophe (idempotent)
      const firstAt = startTs + 60_000;
      if (!schedule.includes(firstAt)) schedule.push(firstAt);

      // Ensure 4 total: 1 immediate + 3 in [day1, day2) during awake time
      if (schedule.length < 4) {
        const day1 = startTs + 24 * 3600_000;
        const day2 = startTs + 48 * 3600_000;
        const need = 4 - schedule.length;

        const picks: number[] = [];
        let guard = 0;
        while (picks.length < need && guard++ < 2000) {
          const t = randInt(day1, day2 - CATA_DURATION_MS);
          const minute = Math.floor(t / 60_000) * 60_000;
          if (isSleepingAt(minute)) continue;
          if (schedule.includes(minute) || picks.includes(minute)) continue;
          picks.push(minute);
        }
        schedule = [...schedule, ...picks].sort((a, b) => a - b);
      }

      localStorage.setItem(CATA_SCHEDULE_KEY, JSON.stringify(schedule.slice(0, 4)));
      if (!consumed) localStorage.setItem(CATA_CONSUMED_KEY, JSON.stringify([]));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTs]);

  /** Offline catch-up (age/stats/illness/catastrophes) + anti-rewind */
  useEffect(() => {
    try {
      const nowWall = Date.now();
      const lastWall = Number(localStorage.getItem(LAST_SEEN_KEY) || nowWall);
      const prevMax = Number(localStorage.getItem(AGE_MAX_WALL_KEY) || lastWall);
      const wallForElapsed = Math.max(nowWall, prevMax);
      const rawElapsed = wallForElapsed - lastWall;
      const elapsed = Math.max(0, Math.min(rawElapsed, 48 * 3600_000)); // cap 48h

      if (elapsed > 0) {
        const minutes = Math.floor(elapsed / 60000);
        const schedule: number[] = JSON.parse(localStorage.getItem(CATA_SCHEDULE_KEY) || "[]");
        const consumed: number[] = JSON.parse(localStorage.getItem(CATA_CONSUMED_KEY) || "[]");

        const res = simulateOffline({
          startWall: lastWall,
          minutes,
          startAgeMs: Number(localStorage.getItem(AGE_MS_KEY) || 0),
          startStats: { ...statsRef.current },
          startSick: sickRef.current,
          sleepCheck: isSleepingAt,
          schedule,
          consumed,
        });

        setStats(() => clampStats(res.stats));
        setIsSick(res.sick);
        setAgeMs((v) => v + elapsed);

        if (res.newConsumed.length) {
          const uniq = Array.from(new Set([...consumed, ...res.newConsumed])).sort((a, b) => a - b);
          localStorage.setItem(CATA_CONSUMED_KEY, JSON.stringify(uniq));
        }
      }

      localStorage.setItem(LAST_SEEN_KEY, String(nowWall));
      localStorage.setItem(AGE_MAX_WALL_KEY, String(Math.max(prevMax, nowWall)));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Online age ticker (monotonic, perf-based) */
  useEffect(() => {
    let lastPerf = performance.now();
    const id = window.setInterval(() => {
      const nowPerf = performance.now();
      let dt = nowPerf - lastPerf;
      if (!Number.isFinite(dt) || dt < 0) dt = 0;
      dt = Math.min(dt, 1000);
      lastPerf = nowPerf;
      setAgeMs((v) => v + dt);
    }, 1000 / 6);
    return () => clearInterval(id);
  }, []);

  /** Persist often + anti-rewind watermark */
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
    const id = setInterval(save, 15000);
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

  /** Evolution (equal probability from egg) */
  useEffect(() => {
    // egg -> random child
    if (formRef.current === "egg" && ageRef.current >= EVOLVE_CHILD_AT) {
      const next = pickOne(CHILD_CHOICES);
      const maybe = onEvolve?.(next);
      setForm(normalizeForm((maybe || next) as FormKey));
      return;
    }
    // child -> mapped adult
    if (String(formRef.current).endsWith("_child") && ageRef.current >= EVOLVE_ADULT_AT) {
      const adult = ADULT_MAP[String(formRef.current)];
      if (adult) {
        const maybe = onEvolve?.(adult);
        setForm(normalizeForm((maybe || adult) as FormKey));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ageMs, form]);

  /** Poops load/save */
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

  /** ===== Actions (with cooldowns / animations) ===== */
  const nowMs = () => Date.now();
  const canHeal = !isDead && nowMs() - lastHealAt >= HEAL_COOLDOWN_MS;
  const canBurger = !isDead && nowMs() - lastBurgerAt >= FEED_COOLDOWN_MS;
  const canCake   = !isDead && nowMs() - lastCakeAt   >= FEED_COOLDOWN_MS;
  const canClean  = !isDead && !cleaningRef.current; // disabled during scoop pass

  const act = {
    feedBurger: () => {
      if (!canBurger) return;
      // stats effect
      setStats((s) => clampStats({ ...s,
        hunger: s.hunger + FEED_EFFECTS.burger.hunger,
        happiness: s.happiness + FEED_EFFECTS.burger.happiness
      }));
      // poop chance
      if (Math.random() < 0.7) spawnPoop();
      // start 3-frame anim anchored near pet
      setFoodAnim({ kind: "burger", startedAt: nowMs() });
      setLastBurgerAt(nowMs());
    },
    feedCake: () => {
      if (!canCake) return;
      setStats((s) => clampStats({ ...s,
        hunger: s.hunger + FEED_EFFECTS.cake.hunger,
        happiness: s.happiness + FEED_EFFECTS.cake.happiness
      }));
      if (Math.random() < 0.5) spawnPoop();
      setFoodAnim({ kind: "cake", startedAt: nowMs() });
      setLastCakeAt(nowMs());
    },
    play: () => {
      if (isDead) return;
      setStats((s) => clampStats({ ...s, happiness: s.happiness + 0.2, health: Math.min(1, s.health + 0.03) }));
    },
    clean: () => {
      if (!canClean) return;
      // start scoop pass from right to left
      const startX = LOGICAL_W + 10;
      setCleaning({ x: startX, active: true });
    },
    heal: () => {
      if (isDead || !canHeal) return;
      setIsSick(false);
      setStats((s) => clampStats({ ...s, health: Math.min(1, s.health + 0.25), happiness: s.happiness + 0.05 }));
      setLastHealAt(nowMs());
    },
  };

  /** Spend life to revive (keeps progress) */
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

  /** New Game: full reset back to the very first egg (allowed only after death) */
  const newGame = () => {
    // Safety: only allow New Game after death to avoid accidental wipes
    if (!deadRef.current) return;

    try {
      // Hard wipe all progression-related state
      localStorage.removeItem(START_TS_KEY);
      localStorage.removeItem(LAST_SEEN_KEY);
      localStorage.removeItem(AGE_MS_KEY);
      localStorage.removeItem(AGE_MAX_WALL_KEY);
      localStorage.removeItem(POOPS_KEY);
      localStorage.removeItem(CATA_SCHEDULE_KEY);
      localStorage.removeItem(CATA_CONSUMED_KEY);
      // NOTE: We intentionally keep user's sleep preferences (SLEEP_* keys)
    } catch {}

    // Reset in-memory state to the very beginning
    setForm("egg");
    setStats({ cleanliness: 0.9, hunger: 0.65, happiness: 0.6, health: 1.0 });
    setPoops([]);
    setIsSick(false);
    setIsDead(false);
    setDeathReason(null);
    setCatastrophe(null);
    setAgeMs(0);
    setFoodAnim(null);
    setCleaning(null);

    // Re-seed fresh start timestamps so anti-rewind keeps working
    const now = Date.now();
    try {
      localStorage.setItem(START_TS_KEY, String(now));
      localStorage.setItem(LAST_SEEN_KEY, String(now));
      localStorage.setItem(AGE_MAX_WALL_KEY, String(now));
    } catch {}
  };

  /** ===== Periodic drains / illness / events ===== */
  useEffect(() => {
    let lastWall = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const dt = clampDt(now - lastWall);
      lastWall = now;
      if (deadRef.current) return;

      // trigger scheduled catastrophes when window hits (if awake)
      try {
        const schedule: number[] = JSON.parse(localStorage.getItem(CATA_SCHEDULE_KEY) || "[]");
        const consumed: number[] = JSON.parse(localStorage.getItem(CATA_CONSUMED_KEY) || "[]");
        for (const t of schedule) {
          if (consumed.includes(t)) continue;
          if (now >= t && now < t + CATA_DURATION_MS) {
            if (!isSleepingAt(now)) {
              setCatastrophe({ cause: pickOne(CATASTROPHE_CAUSES), until: t + CATA_DURATION_MS });
              localStorage.setItem(CATA_CONSUMED_KEY, JSON.stringify([...consumed, t].sort((a,b)=>a-b)));
            }
          } else if (now >= t + CATA_DURATION_MS) {
            if (!consumed.includes(t)) {
              localStorage.setItem(CATA_CONSUMED_KEY, JSON.stringify([...consumed, t].sort((a,b)=>a-b)));
            }
          }
        }
      } catch {}

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
              next.hunger <= 0 ? "starvation"
              : catastropheRef.current && now < (catastropheRef.current?.until ?? 0) ? `fatal ${catastropheRef.current?.cause}`
              : sickRef.current ? "illness" : "collapse"
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
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ===== Render loop (single per-instance RAF) ===== */
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
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls.join("|"), form]);

  function startLoop(images: Record<string, HTMLImageElement>) {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    (ctx as any).imageSmoothingEnabled = false;

    // Size/DPR
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
    if ("ResizeObserver" in window) { ro = new (window as any).ResizeObserver(resize); ro.observe(wrap); }
    else { window.addEventListener("resize", resize); }
    resize();

    const BASELINE = LOGICAL_H - BASE_GROUND;
    let dir: 1 | -1 = 1, x = 40;
    let last = performance.now(), frameTimer = 0;

    // Egg raw height for world autoscale
    function getEggRawHeight(): number {
      const eggSet = (catalog as any)["egg"] as AnyAnimSet;
      const eggSrc = (eggSet?.idle?.[0] ?? eggSet?.walk?.[0]) as string | undefined;
      const eggImg = eggSrc ? images[eggSrc] : undefined;
      return eggImg ? eggImg.height : 32;
    }
    const eggRawH = getEggRawHeight();

    const loop = (ts: number) => {
      rafRef.current = requestAnimationFrame(loop);

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

      // --- HUD Avatar (top-right), no autoscale unless larger than cap ---
      drawAvatarHUD(ctx, images);

      // World layer (shifted down)
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

      // Choose world animation
      const now = Date.now();
      const sleepingNow = isSleepingAt(now);
      const chosenAnim: AnimKey = (() => {
        if (deadRef.current) return "idle";
        if (sleepingNow) return def.sleep?.length ? "sleep" : "idle";
        if (sickRef.current) return def.sick?.length ? "sick" : "idle";
        if (statsRef.current.happiness < 0.35) return (def.sad?.length ? "sad" : def.unhappy?.length ? "unhappy" : "walk") as AnimKey;
        return animRef.current;
      })();

      // Frames with smart fallback to walk if needed
      let framesAll = (def[chosenAnim] ?? def.idle ?? def.walk ?? []) as string[];
      framesAll = framesAll.filter(Boolean);
      if (!sleepingNow && framesAll.length < 2 && (def.walk?.length ?? 0) >= 2) framesAll = def.walk!;
      const frames = framesAll.filter((u) => !!images[u]);

      const base = frames.length ? images[frames[0]] : undefined;
      const rawW = base?.width ?? 32;
      const rawH = base?.height ?? 32;

      // Autoscale in world: egg by EGG_SCALE, non-egg by NON_EGG_SCALE relative to egg height
      const factor = (String(formRef.current) === "egg") ? EGG_SCALE : NON_EGG_SCALE;
      const scale = (eggRawH / Math.max(1, rawH)) * factor;
      const drawW = Math.round(rawW * scale), drawH = Math.round(rawH * scale);

      // Movement
      if (!deadRef.current && !sleepingNow) {
        x += (dir * WALK_SPEED * dt) / 1000;
        const minX = 0, maxX = LOGICAL_W - drawW;
        if (x < minX) { x = minX; dir = 1; }
        else if (x > maxX) { x = maxX; dir = -1; }
      }

      // Frame switching (single loop — prevents stacked/overlapping walk)
      frameTimer += dt;
      if (frameTimer > 1e6) frameTimer %= 1e6;
      let frameIndex = 0;
      if (frames.length >= 2) {
        const step = Math.floor(frameTimer / (1000 / FPS));
        frameIndex = step % frames.length;
      }

      // Draw pet or dead sprite
      if (deadRef.current) {
        const list = deadCandidates(formRef.current);
        const deadSrc = list.find((p) => images[p]);
        const deadImg = deadSrc ? images[deadSrc] : null;
        if (deadImg) {
          const w = Math.round(deadImg.width * scale);
          const h = Math.round(deadImg.height * scale);
          const ix = Math.round((LOGICAL_W - w) / 2);
          const iy = Math.round(LOGICAL_H - BASE_GROUND - h);
          ctx.drawImage(deadImg, ix, iy, w, h);
          petRectRef.current = { x: ix, y: iy, w, h };
        }
      } else if (frames.length) {
        ctx.save();
        let flip = dir === -1;
        if (INVERT_WALK_FACING) flip = !flip;
        if (flip) {
          const cx = Math.round(x + drawW / 2);
          ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0);
        }
        const ix = Math.round(x), iy = Math.round(LOGICAL_H - BASE_GROUND - drawH);
        const img = images[frames[Math.min(frameIndex, frames.length - 1)]];
        if (img) ctx.drawImage(img, ix, iy, drawW, drawH);
        ctx.restore();
        petRectRef.current = { x: ix, y: iy, w: drawW, h: drawH };
      } else {
        petRectRef.current = null;
      }

      // Cleaning (scoop pass) — moves right->left and clears poops in radius
      if (cleaningRef.current && cleaningRef.current.active) {
        const s = cleaningRef.current;
        s.x -= (SCOOP_SPEED_PX_S * dt) / 1000; // move left
        // draw scoop
        const scoopImg = images[SCOOP_SRC];
        const scoopH = SCOOP_HEIGHT_TARGET;
        const scoopW = scoopImg ? Math.round((scoopImg.width / Math.max(1, scoopImg.height)) * scoopH) : 26;
        const y = Math.round(LOGICAL_H - BASE_GROUND - scoopH + 2);
        if (scoopImg) ctx.drawImage(scoopImg, Math.round(s.x), y, scoopW, scoopH);
        else {
          // fallback rectangle with emoji
          ctx.fillStyle = "#c7cbe8";
          ctx.fillRect(Math.round(s.x), y, scoopW, scoopH);
          ctx.font = "12px monospace";
          ctx.fillStyle = "#111";
          ctx.fillText("🧹", Math.round(s.x) + 6, y + scoopH - 6);
        }
        // clear poops in radius from scoop front edge
        const frontX = s.x + scoopW * 0.5;
        const remaining = poopsRef.current.filter((p) => Math.abs(p.x - frontX) > SCOOP_CLEAR_RADIUS);
        if (remaining.length !== poopsRef.current.length) setPoops(remaining);
        // finish when passed left edge
        if (s.x < -scoopW - 8) {
          setCleaning(null);
          setStats((st) => clampStats({ ...st, cleanliness: Math.max(st.cleanliness, CLEAN_FINISH_CLEANLINESS), happiness: st.happiness + 0.02 }));
        }
      }

      // Banners
      const cat = catastropheRef.current;
      if (cat && now < cat.until) drawBanner(ctx, LOGICAL_W, `⚠ ${cat.cause}! stats draining fast`);
      if (!deadRef.current && sleepingNow) drawBanner(ctx, LOGICAL_W, "😴 Sleeping");

      // Food 3-frame throw animation (anchored near pet head; fades out)
      if (foodAnimRef.current) {
        const fa = foodAnimRef.current;
        const elapsed = now - fa.startedAt;
        if (elapsed >= FEED_ANIM_TOTAL_MS) {
          // stop anim
          if (foodAnimRef.current) setFoodAnim(null);
        } else {
          const frames = FEED_FRAMES[fa.kind];
          const frameIdx = Math.min(FEED_FRAMES_COUNT - 1, Math.floor((elapsed / FEED_ANIM_TOTAL_MS) * FEED_FRAMES_COUNT));
          const src = frames[frameIdx];
          const img = images[src];
          const target = petRectRef.current;
          const baseX = target ? target.x + target.w * 0.4 : LOGICAL_W * 0.48;
          const baseY = target ? target.y - 12 : 26;
          if (img) {
            const w = Math.round(img.width * 0.5);
            const h = Math.round(img.height * 0.5);
            ctx.drawImage(img, Math.round(baseX), Math.round(baseY), w, h);
          } else {
            // emoji fallback
            ctx.font = "16px monospace";
            ctx.fillText(fa.kind === "burger" ? "🍔" : "🎂", Math.round(baseX), Math.round(baseY));
          }
        }
      }

      ctx.restore(); // end shifted world
    };

    // Start a single RAF loop for this instance
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);

    // Cleanup
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", resize);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    /** Draws avatar HUD (top-right), respecting AVATAR_SCALE_CAP */
    function drawAvatarHUD(ctx2: CanvasRenderingContext2D, images2: Record<string, HTMLImageElement>) {
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

      if (avatarSrc && images2[avatarSrc]) {
        const av = images2[avatarSrc];

        // Scale down only if cap is set and native sprite is larger
        let aw = av.width, ah = av.height;
        if (typeof AVATAR_SCALE_CAP === "number") {
          const nativeMax = Math.max(av.width, av.height);
          const scale = nativeMax > AVATAR_SCALE_CAP ? (AVATAR_SCALE_CAP / nativeMax) : 1;
          aw = Math.round(av.width * scale);
          ah = Math.round(av.height * scale);
        }

        const padX = 10, padY = 6;
        const ax = LOGICAL_W - padX - aw;
        const ay = padY;

        (ctx2 as any).imageSmoothingEnabled = false;
        ctx2.drawImage(av, ax, ay, aw, ah);

        // HP badge anchored to bottom-right of the avatar
        const hp = Math.round((statsRef.current.health ?? 0) * 100);
        const label = `❤️ ${hp}%`;
        ctx2.font = "10px monospace";
        ctx2.textBaseline = "alphabetic";
        const tw = ctx2.measureText(label).width;
        const tx = ax + aw - tw - 2;
        const ty = ay + ah - 4;
        ctx2.lineWidth = 3;
        ctx2.strokeStyle = "rgba(0,0,0,0.75)";
        ctx2.strokeText(label, tx, ty);
        ctx2.fillStyle = "#fff";
        ctx2.fillText(label, tx, ty);
      }
    }
  }

  /** UI */
  const burgerLeft = Math.max(0, FEED_COOLDOWN_MS - (nowMs() - lastBurgerAt));
  const cakeLeft   = Math.max(0, FEED_COOLDOWN_MS - (nowMs() - lastCakeAt));
  const healLeft   = Math.max(0, HEAL_COOLDOWN_MS - (nowMs() - lastHealAt));

  return (
    <div style={{ width: "min(92vw, 100%)", maxWidth: MAX_W, margin: "0 auto" }}>
      {/* Canvas */}
      <div
        ref={wrapRef}
        style={{
          width: "100%", height: CANVAS_H, position: "relative",
          imageRendering: "pixelated", overflow: "hidden", background: "transparent",
          borderRadius: 12, margin: "0 auto",
        }}
      >
        <canvas ref={canvasRef} style={{ display: "block", imageRendering: "pixelated", background: "transparent", borderRadius: 12 }} />
        {isDead && (
          <OverlayCard>
            <div style={{ fontSize: 18, marginBottom: 6 }}>Your pet has died</div>
            {deathReason && <div className="muted" style={{ marginBottom: 6 }}>Cause: {deathReason}</div>}
            <div className="muted" style={{ marginBottom: 12 }}>Lives left: <b>{lives}</b></div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              {lives > 0 && (
                <button className="btn btn-primary" onClick={spendLifeToRevive}>
                  Spend 1 life to revive
                </button>
              )}
              <button className="btn" onClick={newGame}>🔄 New Game</button>
            </div>
            {lives <= 0 && <div className="muted" style={{ marginTop: 8 }}>Transfer 1 NFT to get a life (or start a New Game).</div>}
          </OverlayCard>
        )}
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
          marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center",
          opacity: isDead ? 0.5 : 1, pointerEvents: isDead ? ("none" as const) : ("auto" as const),
        }}
      >
        <button className="btn" onClick={act.feedBurger} disabled={!canBurger}>
          🍔 Burger{!canBurger ? ` (${(burgerLeft/1000|0)+1}s)` : ""}
        </button>
        <button className="btn" onClick={act.feedCake} disabled={!canCake}>
          🎂 Cake{!canCake ? ` (${(cakeLeft/1000|0)+1}s)` : ""}
        </button>
        <button className="btn" onClick={act.play}>🎮 Play</button>
        <button className="btn" onClick={act.heal} disabled={!canHeal}>💊 Heal{!canHeal ? ` (${(healLeft/1000|0)+1}s)` : ""}</button>
        <button className="btn" onClick={act.clean} disabled={!canClean || poops.length === 0}>
          🧻 Clean{cleaning ? " (running...)" : ""}
        </button>
        <button className="btn" onClick={() => setAnim((a) => (a === "walk" ? "idle" : "walk"))}>Toggle Walk/Idle</button>
        <button className="btn btn-primary" onClick={() => setForm(forceEvolve(form))}>⭐ Evolve (debug)</button>
        <span className="muted" style={{ alignSelf: "center" }}>
          Poop: {poops.length} | Form: {prettyName(form)} {isSick ? " | 🤒 Sick" : ""} {catastrophe && Date.now() < catastrophe.until ? " | ⚠ Event" : ""} | Age: {(ageMs/1000|0)}s
        </span>
      </div>

      {/* Sleep controls */}
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

/** ===== Types & helpers ===== */
type AnimKey = "idle" | "walk" | "sick" | "sad" | "unhappy" | "sleep";
type Stats = { cleanliness: number; hunger: number; happiness: number; health: number };
type Poop = { x: number; src: string };
type Catastrophe = { cause: string; until: number };
type FoodKind = "burger" | "cake";
type FoodAnim = { kind: FoodKind; startedAt: number };
type ScoopState = { x: number; active: boolean };

function prettyName(f: FormKey) {
  if (String(f).endsWith("_child")) {
    const base = String(f).replace("_child", "");
    const cap = base === "we" ? "WE" : (base.charAt(0).toUpperCase() + base.slice(1));
    return `${cap} (child)`;
  }
  return f;
}

// Debug evolve follows real rules (egg -> random child; child -> mapped adult)
function forceEvolve(f: FormKey): FormKey {
  if (f === "egg") {
    return pickOne(["chog_child", "molandak_child", "moyaki_child", "we_child"] as const) as FormKey;
  }
  if (String(f).endsWith("_child")) {
    const map: Record<string, FormKey> = {
      chog_child: "Chog",
      molandak_child: "Molandak",
      moyaki_child: "Moyaki",
      we_child: "WE",
    };
    return (map[String(f)] || f) as FormKey;
  }
  return f;
}

function deadCandidates(form: FormKey): string[] {
  return [
    `/sprites/${String(form)}/dead.png`,
    `/sprites/dead/${String(form)}.png`,
    DEAD_FALLBACK,
  ];
}

function useLatest<T>(v: T) { const r = useRef(v); useEffect(() => { r.current = v; }, [v]); return r; }
function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
function clampStats(s: Stats): Stats { return { cleanliness: clamp01(s.cleanliness), hunger: clamp01(s.hunger), happiness: clamp01(s.happiness), health: clamp01(s.health) }; }
function pickOne<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }
function randInt(min: number, max: number) { return Math.floor(min + Math.random() * (max - min + 1)); }
function clampDt(ms: number): number { if (!Number.isFinite(ms) || ms < 0) return 0; return Math.min(ms, 10 * 60 * 1000); }
async function loadImageSafe(src: string): Promise<{ src: string; img: HTMLImageElement } | null> {
  return new Promise((resolve) => {
    try { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => resolve({ src, img }); img.onerror = () => resolve(null); img.src = src; }
    catch { resolve(null); }
  });
}

/** Spawns a poop at random X within stage */
function spawnPoop(setter?: React.Dispatch<React.SetStateAction<Poop[]>>): void;
function spawnPoop() {
  // this function is re-bound in component via closure to call setPoops
}
function drawBanner(ctx: CanvasRenderingContext2D, width: number, text: string) {
  const pad = 4; ctx.save(); ctx.font = "12px monospace";
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const x = Math.round((width - w) / 2), y = 18;
  ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(x, 6, w, 18);
  ctx.fillStyle = "white"; ctx.fillText(text, x + pad, y);
  ctx.restore();
}

/** Inline closure binds to component's setPoops */
function spawnPoopImpl(setPoops: React.Dispatch<React.SetStateAction<Poop[]>>) {
  return function realSpawn() {
    setPoops((arr) => {
      const x = 8 + Math.random() * (LOGICAL_W - 16);
      const src = pickOne(POOP_SRCS);
      const max = 12;
      const next = [...arr, { x, src }];
      return next.slice(-max);
    });
  };
}

/** Small UI atoms */
function Bar({ label, value, h = 6 }: { label: string; value: number; h?: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>{label}</div>
      <div style={{ height: h, width: "100%", borderRadius: Math.max(6, h), background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg, rgba(124,77,255,0.9), rgba(0,200,255,0.9))" }} />
      </div>
    </div>
  );
}
function OverlayCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}>
      <div className="card" style={{ padding: 14, borderRadius: 12, minWidth: 260, textAlign: "center", background: "rgba(10,10,18,0.85)", border: "1px solid rgba(255,255,255,0.12)" }}>
        {children}
      </div>
    </div>
  );
}

/** ===== Bind closures that need component state (spawnPoop) ===== */
function Tamagotchi_bindSpawn(setPoops: React.Dispatch<React.SetStateAction<Poop[]>>) {
  return spawnPoopImpl(setPoops);
}
const _bindSpawnSymbol = Symbol("bindSpawn");
(Tamagotchi as any)[_bindSpawnSymbol] = Tamagotchi_bindSpawn;
