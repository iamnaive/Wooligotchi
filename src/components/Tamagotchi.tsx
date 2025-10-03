import React, { useEffect, useMemo, useRef, useState } from "react";
import { catalog, type FormKey, type AnimSet as AnyAnimSet } from "../game/catalog";

/** ===== Constants ===== */
const DEAD_FALLBACK = "/sprites/dead.png";
const NFT_CONTRACT = "0x88c78d5852f45935324c6d100052958f694e8446";

/** HUD / food */
const AVATAR_SCALE_CAP: number | null = 42;
const FOOD_FRAME_MAX_PX = 42;

/** Target heights */
const EGG_TARGET_H = 26;
const CHILD_TARGET_H = 34;
const ADULT_TARGET_H = 42;

type LifeStage = "egg" | "child" | "adult";
function getLifeStage(form: FormKey): LifeStage {
  if (form === "egg") return "egg";
  if (String(form).endsWith("_child")) return "child";
  return "adult";
}

/** Evolution timings */
const EVOLVE_CHILD_AT = 60_000;
const EVOLVE_ADULT_AT = 2 * 24 * 3600_000;

/** Assets */
const BG_SRC = "/bg/BG.png";
const POOP_SRCS = ["/sprites/poop/poop1.png", "/sprites/poop/poop2.png", "/sprites/poop/poop3.png"];

/** Food: 3 frames, played 2× slower */
const FEED_FRAMES = {
  burger: ["/sprites/ui/food/burger/000.png", "/sprites/ui/food/burger/001.png", "/sprites/ui/food/burger/002.png"],
  cake:   ["/sprites/ui/food/cake/000.png",   "/sprites/ui/food/cake/001.png",   "/sprites/ui/food/cake/002.png"],
} as const;

const SCOOP_SRC = "/sprites/ui/scoop.png";

/** Storage keys (namespaced by wallet address) */
const START_TS_KEY = "start_ts_v2";
const LAST_SEEN_KEY = "last_seen_v3";
const AGE_MS_KEY = "age_ms_v4";
const AGE_MAX_WALL_KEY = "age_max_wall_v2";
const POOPS_KEY = "poops_v1";
const SLEEP_LOCK_KEY = "sleep_lock_v1";
const SLEEP_FROM_KEY = "sleep_from_v1";
const SLEEP_TO_KEY = "sleep_to_v1";
const CATA_SCHEDULE_KEY = "cata_schedule_v2";
const CATA_CONSUMED_KEY = "cata_consumed_v2";
const FORM_KEY = "form_v1";
const STATS_KEY = "stats_v1";
const SICK_KEY = "sick_v1";
const DEAD_KEY = "dead_v1";
const DEATH_REASON_KEY = "death_reason_v1";

/** Scene */
const LOGICAL_W = 320, LOGICAL_H = 180;
const FPS = 6, WALK_SPEED = 42;
const MAX_W = 720, CANVAS_H = 360;
const BAR_H = 6, BASE_GROUND = 48, Y_SHIFT = 26;

/** Vertical adjustments */
const EXTRA_DOWN = 10;      // poops & scoop lower
// питомца поднимаем вверх на 27 px относительно прежней логики
const PET_RAISE  = 1;

const HEAL_COOLDOWN_MS = 60_000;

/** Food logic */
const FEED_COOLDOWN_MS = 5_000;
const FEED_ANIM_TOTAL_MS = 1200; // 3 * 400ms
const FEED_FRAMES_COUNT = 3;
const FEED_EFFECTS = {
  burger: { hunger: +0.28, happiness: +0.06 },
  cake:   { hunger: +0.22, happiness: +0.12 },
};

/** Cleaning */
const SCOOP_SPEED_PX_S = 160;
const SCOOP_CLEAR_RADIUS = 18;
const SCOOP_HEIGHT_TARGET = 22;
const CLEAN_FINISH_CLEANLINESS = 0.95;

/** Catastrophes */
const CATA_DURATION_MS = 60_000;
const CATASTROPHE_CAUSES = ["food poisoning", "mysterious flu", "meteor dust", "bad RNG", "doom day syndrome"] as const;

export default function Tamagotchi({
  currentForm,
  lives = 0,
  onLoseLife = () => {},
  onEvolve,
  walletAddress,
}: {
  currentForm: FormKey;
  lives?: number;
  onLoseLife?: () => void;
  onEvolve?: (next?: FormKey) => FormKey | void;
  walletAddress?: string;
}) {
  /** Address namespace for localStorage */
  const addr = (walletAddress || "").toLowerCase();
  const SK_PREFIX = addr ? `wg_${addr}_` : `wg_`;
  const sk = (k: string) => `${SK_PREFIX}${k}`;

  /** Forms */
  const CHILD_CHOICES: FormKey[] = ["chog_child", "molandak_child", "moyaki_child", "we_child"];
  const ADULT_MAP: Record<string, FormKey> = {
    chog_child: "Chog",
    molandak_child: "Molandak",
    moyaki_child: "Moyaki",
    we_child: "WE",
  };

  /** Legacy names normalize */
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

  /** State (persistent) */
  const firstSyncDone = useRef(false);
  const [form, setForm] = useState<FormKey>(() => {
    const saved = safeReadJSON<FormKey>(sk(FORM_KEY));
    return saved && catalog[saved] ? saved : normalizeForm(currentForm);
  });
  useEffect(() => {
    if (!firstSyncDone.current) {
      setForm((prev) => prev || normalizeForm(currentForm));
      firstSyncDone.current = true;
    }
  }, [currentForm]);

  const [stats, setStats] = useState<Stats>(() => {
    const saved = safeReadJSON<Stats>(sk(STATS_KEY));
    return saved ? clampStats(saved) : { cleanliness: 0.9, hunger: 0.65, happiness: 0.6, health: 1.0 };
  });
  const [poops, setPoops] = useState<Poop[]>(() => {
    const arr = safeReadJSON<Poop[]>(sk(POOPS_KEY));
    return Array.isArray(arr) ? arr.slice(0, 12) : [];
  });
  const [isSick, setIsSick] = useState<boolean>(() => !!safeReadJSON<boolean>(sk(SICK_KEY)));
  const [isDead, setIsDead] = useState<boolean>(() => !!safeReadJSON<boolean>(sk(DEAD_KEY)));
  const [deathReason, setDeathReason] = useState<string | null>(() => {
    const s = safeReadJSON<string | null>(sk(DEATH_REASON_KEY));
    return typeof s === "string" ? s : null;
  });
  const [lifeSpentForThisDeath, setLifeSpentForThisDeath] = useState<boolean>(false);

  const [anim, setAnim] = useState<AnimKey>("walk");
  const [lastHealAt, setLastHealAt] = useState<number>(0);

  // food
  const [lastBurgerAt, setLastBurgerAt] = useState<number>(0);
  const [lastCakeAt, setLastCakeAt] = useState<number>(0);
  const [foodAnim, setFoodAnim] = useState<FoodAnim | null>(null);

  // cleaning
  const [cleaning, setCleaning] = useState<ScoopState | null>(null);

  // sleep
  const [useAutoTime, setUseAutoTime] = useState<boolean>(() => !localStorage.getItem(sk(SLEEP_LOCK_KEY)));
  const [sleepStart, setSleepStart] = useState<string>(() => localStorage.getItem(sk(SLEEP_FROM_KEY)) || "22:00");
  const [wakeTime, setWakeTime] = useState<string>(() => localStorage.getItem(sk(SLEEP_TO_KEY)) || "08:30");
  const [sleepLocked, setSleepLocked] = useState<boolean>(() => !!localStorage.getItem(sk(SLEEP_LOCK_KEY)));

  // age
  const [ageMs, setAgeMs] = useState<number>(() => {
    const v = Number(localStorage.getItem(sk(AGE_MS_KEY)) || 0);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  });

  // catastrophe
  const [catastrophe, setCatastrophe] = useState<Catastrophe | null>(null);

  /** Refs */
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

  const sleepParamsRef = useRef({ useAutoTime, sleepStart, wakeTime, sleepLocked });
  useEffect(() => { sleepParamsRef.current = { useAutoTime, sleepStart, wakeTime, sleepLocked }; }, [useAutoTime, sleepStart, wakeTime, sleepLocked]);

  /** Canvas & RAF */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  /** Catalog / frames */
  const safeForm = (f: FormKey) => (catalog[f] ? f : ("egg" as FormKey));
  const def = useMemo(() => (catalog[safeForm(form)] || {}) as AnyAnimSet, [form]);

  /** Preload */
  const urls = useMemo(() => {
    const set = new Set<string>();
    set.add(BG_SRC);
    (["idle","walk","sick","sad","unhappy","sleep"] as AnimKey[]).forEach(k => (def[k] ?? []).forEach(u => set.add(u)));
    POOP_SRCS.forEach(u => set.add(u));
    FEED_FRAMES.burger.forEach(u => set.add(u));
    FEED_FRAMES.cake.forEach(u => set.add(u));
    set.add(SCOOP_SRC);
    deadCandidates(form).forEach(u => set.add(u));
    const egg = catalog["egg"] || {};
    (egg.idle ?? egg.walk ?? []).forEach(u => set.add(u));
    return Array.from(set);
  }, [def, form]);

  /** Start timestamp */
  const [startTs, setStartTs] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(sk(START_TS_KEY));
      if (raw) return Number(raw);
      const now = Date.now();
      localStorage.setItem(sk(START_TS_KEY), String(now));
      return now;
    } catch { return Date.now(); }
  });

  /** Legacy → namespaced migration */
  useEffect(() => {
    try {
      const hasNs = localStorage.getItem(sk(AGE_MS_KEY));
      const legacyAge = localStorage.getItem("wg_age_ms_v4");
      if (!hasNs && legacyAge) {
        const LEG = (k: string) => localStorage.getItem(k);
        const SET = (k: string, v: string | null) => { if (v != null) localStorage.setItem(sk(k), v); };
        SET(AGE_MS_KEY, LEG("wg_age_ms_v4"));
        SET(LAST_SEEN_KEY, LEG("wg_last_seen_v3"));
        SET(AGE_MAX_WALL_KEY, LEG("wg_age_max_wall_v2"));
        SET(POOPS_KEY, LEG("wg_poops_v1"));
        SET(CATA_SCHEDULE_KEY, LEG("wg_cata_schedule_v2"));
        SET(CATA_CONSUMED_KEY, LEG("wg_cata_consumed_v2"));
      }
    } catch {}
  }, [addr]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Sleep check */
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
    if (ssH > wkH || (ssH === wkH && ssM > wkM)) return afterStart || beforeWake;
    return afterStart && beforeWake;
  }

  /** Catastrophe schedule (first shifted out of sleep if needed) */
  useEffect(() => {
    try {
      const schedRaw = localStorage.getItem(sk(CATA_SCHEDULE_KEY));
      const consumedRaw = localStorage.getItem(sk(CATA_CONSUMED_KEY));
      let schedule: number[] = schedRaw ? JSON.parse(schedRaw) : [];
      const consumed: number[] = consumedRaw ? JSON.parse(consumedRaw) : [];

      let firstAt = startTs + 60_000;
      if (isSleepingAt(firstAt)) {
        const maxShiftMins = 180;
        for (let i = 1; i <= maxShiftMins; i++) {
          const t = firstAt + i * 60_000;
          if (!isSleepingAt(t)) { firstAt = t; break; }
        }
      }
      if (!schedule.includes(firstAt)) schedule.push(firstAt);

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

      localStorage.setItem(sk(CATA_SCHEDULE_KEY), JSON.stringify(schedule.slice(0, 4)));
      if (!consumed) localStorage.setItem(sk(CATA_CONSUMED_KEY), JSON.stringify([]));
    } catch {}
  }, [startTs]); // eslint-disable-line react-hooks/ex exhaustive-deps

  /** Offline catch-up with death surfacing */
  useEffect(() => {
    try {
      const nowWall = Date.now();
      const lastWall = Number(localStorage.getItem(sk(LAST_SEEN_KEY)) || nowWall);
      const prevMax = Number(localStorage.getItem(sk(AGE_MAX_WALL_KEY)) || lastWall);
      const wallForElapsed = Math.max(nowWall, prevMax);
      const rawElapsed = wallForElapsed - lastWall;
      const elapsed = Math.max(0, Math.min(rawElapsed, 48 * 3600_000)); // <= 48h

      if (elapsed > 0) {
        const minutes = Math.floor(elapsed / 60000);
        const schedule: number[] = JSON.parse(localStorage.getItem(sk(CATA_SCHEDULE_KEY)) || "[]");
        const consumed: number[] = JSON.parse(localStorage.getItem(sk(CATA_CONSUMED_KEY)) || "[]");

        const res = simulateOffline({
          startWall: lastWall,
          minutes,
          startAgeMs: Number(localStorage.getItem(sk(AGE_MS_KEY)) || 0),
          startStats: { ...statsRef.current },
          startSick: sickRef.current,
          sleepCheck: isSleepingAt,
          schedule,
          consumed,
        });

        setStats(() => clampStats(res.stats));
        setIsSick(res.sick);
        setAgeMs((v) => v + elapsed);

        if (res.died) {
          setIsDead(true);
          setDeathReason(res.deathReason || (res.wasCatastrophe ? "fatal event" : res.wasSick ? "illness" : "collapse"));
          window.dispatchEvent(new CustomEvent("wg:pet-dead"));
        }

        if (res.newConsumed.length) {
          const uniq = Array.from(new Set([...consumed, ...res.newConsumed])).sort((a, b) => a - b);
          localStorage.setItem(sk(CATA_CONSUMED_KEY), JSON.stringify(uniq));
        }
      }

      localStorage.setItem(sk(LAST_SEEN_KEY), String(nowWall));
      localStorage.setItem(sk(AGE_MAX_WALL_KEY), String(Math.max(prevMax, nowWall)));
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Age ticker */
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

  /** Persist often */
  const ageRefPersist = useLatest(ageMs);
  useEffect(() => {
    const save = () => {
      try {
        const now = Date.now();
        localStorage.setItem(sk(LAST_SEEN_KEY), String(now));
        const prevMax = Number(localStorage.getItem(sk(AGE_MAX_WALL_KEY)) || now);
        localStorage.setItem(sk(AGE_MAX_WALL_KEY), String(Math.max(prevMax, now)));
        localStorage.setItem(sk(AGE_MS_KEY), String(ageRefPersist.current));
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
      try { localStorage.setItem(sk(AGE_MS_KEY), String(ageRefPersist.current)); } catch {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Persist scalars */
  useEffect(() => { try { localStorage.setItem(sk(FORM_KEY), JSON.stringify(form)); } catch {} }, [form, addr]);
  useEffect(() => { try { localStorage.setItem(sk(STATS_KEY), JSON.stringify(stats)); } catch {} }, [stats, addr]);
  useEffect(() => { try { localStorage.setItem(sk(SICK_KEY), JSON.stringify(isSick)); } catch {} }, [isSick, addr]);
  useEffect(() => { try { localStorage.setItem(sk(DEAD_KEY), JSON.stringify(isDead)); } catch {} }, [isDead, addr]);
  useEffect(() => { try { localStorage.setItem(sk(DEATH_REASON_KEY), JSON.stringify(deathReason)); } catch {} }, [deathReason, addr]);
  useEffect(() => { try { localStorage.setItem(sk(POOPS_KEY), JSON.stringify(poops.slice(-12))); } catch {} }, [poops, addr]);

  /** Evolution */
  useEffect(() => {
    if (formRef.current === "egg" && ageRef.current >= EVOLVE_CHILD_AT) {
      const next = pickOne(CHILD_CHOICES);
      const maybe = onEvolve?.(next);
      setForm(normalizeForm((maybe || next) as FormKey));
      return;
    }
    if (String(formRef.current).endsWith("_child") && ageRef.current >= EVOLVE_ADULT_AT) {
      const adult = ADULT_MAP[String(formRef.current)];
      if (adult) {
        const maybe = onEvolve?.(adult);
        setForm(normalizeForm((maybe || adult) as FormKey));
      }
    }
  }, [ageMs, form]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Actions */
  const nowMs = () => Date.now();
  const canHeal   = !isDead && nowMs() - lastHealAt   >= HEAL_COOLDOWN_MS;
  const canBurger = !isDead && nowMs() - lastBurgerAt >= FEED_COOLDOWN_MS;
  const canCake   = !isDead && nowMs() - lastCakeAt   >= FEED_COOLDOWN_MS;
  const canClean  = !isDead && !cleaningRef.current;

  function spawnPoop() {
    setPoops((arr) => {
      const x = 8 + Math.random() * (LOGICAL_W - 16);
      const src = pickOne(POOP_SRCS);
      const max = 12;
      const next = [...arr, { x, src }];
      return next.slice(-max);
    });
  }

  const act = {
    feedBurger: () => {
      if (!canBurger) return;
      setStats((s) => clampStats({ ...s,
        hunger: s.hunger + FEED_EFFECTS.burger.hunger,
        happiness: s.happiness + FEED_EFFECTS.burger.happiness
      }));
      if (Math.random() < 0.7) spawnPoop();
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
      const startX = LOGICAL_W + 10; // enter from right
      setCleaning({ x: startX, active: true });
    },
    heal: () => {
      if (isDead || !canHeal) return;
      setIsSick(false);
      setStats((s) => clampStats({ ...s, health: Math.min(1, s.health + 0.25), happiness: s.happiness + 0.05 }));
      setLastHealAt(nowMs());
    },
  };

  /** Reset (used only после получения новой жизни) */
  const performReset = () => {
    try {
      localStorage.removeItem(sk(START_TS_KEY));
      localStorage.removeItem(sk(LAST_SEEN_KEY));
      localStorage.removeItem(sk(AGE_MS_KEY));
      localStorage.removeItem(sk(AGE_MAX_WALL_KEY));
      localStorage.removeItem(sk(POOPS_KEY));
      localStorage.removeItem(sk(CATA_SCHEDULE_KEY));
      localStorage.removeItem(sk(CATA_CONSUMED_KEY));
      localStorage.removeItem(sk(FORM_KEY));
      localStorage.removeItem(sk(STATS_KEY));
      localStorage.removeItem(sk(SICK_KEY));
      localStorage.removeItem(sk(DEAD_KEY));
      localStorage.removeItem(sk(DEATH_REASON_KEY));
    } catch {}
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
    setLifeSpentForThisDeath(false);
    const now = Date.now();
    try {
      localStorage.setItem(sk(START_TS_KEY), String(now));
      localStorage.setItem(sk(LAST_SEEN_KEY), String(now));
      localStorage.setItem(sk(AGE_MAX_WALL_KEY), String(now));
    } catch {}
    setStartTs(now);
    window.dispatchEvent(new CustomEvent("wg:new-game"));
  };

  /** Смерть: списываем жизнь ОДИН раз, но НЕ перезапускаем игру автоматически */
  useEffect(() => {
    if (isDead && !lifeSpentForThisDeath) {
      onLoseLife?.();                   // жизнь списывается (если была)
      setLifeSpentForThisDeath(true);   // повторно не списываем
      window.dispatchEvent(new CustomEvent("wg:pet-dead"));
    }
  }, [isDead]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Когда пришла новая жизнь из VaultPanel (wg:nft-confirmed) — сразу начинаем новый раунд */
  useEffect(() => {
    const onConfirmed = () => {
      if (deadRef.current) performReset();
    };
    window.addEventListener("wg:nft-confirmed", onConfirmed as any);
    return () => window.removeEventListener("wg:nft-confirmed", onConfirmed as any);
  }, []); // once

  /** Drains / online catastrophes */
  useEffect(() => {
    let lastWall = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const dt = clampDt(now - lastWall);
      lastWall = now;
      if (deadRef.current) return;

      // schedule trigger
      try {
        const schedule: number[] = JSON.parse(localStorage.getItem(sk(CATA_SCHEDULE_KEY)) || "[]");
        const consumed: number[] = JSON.parse(localStorage.getItem(sk(CATA_CONSUMED_KEY)) || "[]");
        for (const t of schedule) {
          if (consumed.includes(t)) continue;
          if (now >= t && now < t + CATA_DURATION_MS) {
            if (!isSleepingAt(now)) {
              setCatastrophe({ cause: pickOne(CATASTROPHE_CAUSES), until: t + CATA_DURATION_MS });
              localStorage.setItem(sk(CATA_CONSUMED_KEY), JSON.stringify([...consumed, t].sort((a,b)=>a-b)));
            }
          } else if (now >= t + CATA_DURATION_MS) {
            if (!consumed.includes(t) && !isSleepingAt(t)) {
              localStorage.setItem(sk(CATA_CONSUMED_KEY), JSON.stringify([...consumed, t].sort((a,b)=>a-b)));
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
              : (catastropheRef.current && now < (catastropheRef.current?.until ?? 0)) ? `fatal ${catastropheRef.current?.cause}`
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** ===== Render loop (single RAF) ===== */
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

    // size / DPR
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

    // ---- Motion vars ----
    const EDGE_EPS = 2;
    const TURN_COOLDOWN = 160; // ms
    let dir: 1 | -1 = 1;
    let x = 40;                // float pos
    let lastTurnAt = -1e9;     // perf ts
    let last = performance.now();
    let frameTimer = 0;

    const loop = (ts: number) => {
      rafRef.current = requestAnimationFrame(loop);

      const dt = Math.min(100, ts - last);
      last = ts;

      // Clear
      ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

      // Background
      const bg = images[BG_SRC];
      if (bg) {
        const scaleBG = Math.max(LOGICAL_W / bg.width, LOGICAL_H / bg.height);
        const dw = Math.floor(bg.width * scaleBG);
        const dh = Math.floor(bg.height * scaleBG);
        const dx = Math.floor((LOGICAL_W - dw) / 2);
        const dy = Math.floor((LOGICAL_H - dh) / 2);
        ctx.drawImage(bg, dx, dy, dw, dh);
      }

      // ----- Food animation (top-left) -----
      const curFood = foodAnimRef.current;
      if (curFood) {
        const elapsed = Date.now() - curFood.startedAt;
        if (elapsed >= FEED_ANIM_TOTAL_MS) {
          setFoodAnim(null);
        } else {
          const idx = Math.min(
            FEED_FRAMES_COUNT - 1,
            Math.floor((elapsed / FEED_ANIM_TOTAL_MS) * FEED_FRAMES_COUNT)
          );
          const list = FEED_FRAMES[curFood.kind];
          const src = list[idx];
          const img = images[src];
          if (img) {
            const nativeMax = Math.max(img.width, img.height);
            const scale = nativeMax > FOOD_FRAME_MAX_PX ? FOOD_FRAME_MAX_PX / nativeMax : 1;
            const fw = Math.round(img.width * scale);
            const fh = Math.round(img.height * scale);
            const fx = 8, fy = 8;
            ctx.drawImage(img, fx, fy, fw, fh);
          }
        }
      }

      // --- Top-right avatar ---
      const nowAbs = Date.now();
      const sleepingNow = isSleepingAt(nowAbs);
      const avatarAnimKey: AnimKey = (() => {
        if (deadRef.current) return "idle";
        if (sleepingNow) return (def.sleep?.length ? "sleep" : "idle") as AnimKey;
        if (sickRef.current && (def.sick?.length ?? 0) > 0) return "sick";
        if (statsRef.current.happiness < 0.35) return (def.sad?.length ? "sad" : def.unhappy?.length ? "unhappy" : "idle") as AnimKey;
        return (def.idle?.length ? "idle" : "walk") as AnimKey;
      })();
      const avatarFrames = (def[avatarAnimKey] ?? def.idle ?? def.walk ?? []) as string[];
      const avatarSrc = avatarFrames[0];

      if (avatarSrc && images[avatarSrc]) {
        const av = images[avatarSrc];
        const nativeMax = Math.max(av.width, av.height);
        const scaleCap = AVATAR_SCALE_CAP ?? nativeMax;
        const scale = nativeMax > scaleCap ? (scaleCap / nativeMax) : 1;
        const aw = Math.round(av.width * scale);
        const ah = Math.round(av.height * scale);

        const padX = 10, padY = 6;
        const ax = LOGICAL_W - padX - aw;
        const ay = padY;

        (ctx as any).imageSmoothingEnabled = false;
        ctx.drawImage(av, ax, ay, aw, ah);

        // HP label BELOW the avatar (no overlap)
        const hp = Math.round((statsRef.current.health ?? 0) * 100);
        const label = `❤️ ${hp}%`;
        ctx.font = "10px monospace";
        ctx.textBaseline = "top";
        const tw = ctx.measureText(label).width;
        const tx = ax + aw - tw - 2;
        const ty = Math.min(ay + ah + 2, LOGICAL_H - 14);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.strokeText(label, tx, ty);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, tx, ty);
      }

      // World layer
      ctx.save();
      ctx.translate(0, Y_SHIFT);

      // Poops
      const curPoops = poopsRef.current;
      if (curPoops.length) {
        for (const p of curPoops) {
          const img = images[p.src];
          const px = Math.round(p.x);
          const py = Math.round(LOGICAL_H - BASE_GROUND - 6 + EXTRA_DOWN);
          if (img) ctx.drawImage(img, px, py - 12, 12, 12);
          else { ctx.font = "10px monospace"; ctx.fillText("💩", px, py); }
        }
      }

      // Choose anim
      const chosenAnim: AnimKey = (() => {
        if (deadRef.current) return "idle";
        if (sleepingNow) return (def.sleep?.length ? "sleep" : "idle") as AnimKey;
        if (sickRef.current) return (def.sick?.length ? "sick" : "idle") as AnimKey;
        if (statsRef.current.happiness < 0.35) return (def.sad?.length ? "sad" : def.unhappy?.length ? "unhappy" : "walk") as AnimKey;
        return animRef.current;
      })();

      // Frames
      let framesAll = (def[chosenAnim] ?? def.idle ?? def.walk ?? []) as string[];
      framesAll = framesAll.filter(Boolean);
      if (!sleepingNow && framesAll.length < 2 && (def.walk?.length ?? 0) >= 2) framesAll = def.walk!;
      const frames = framesAll.filter((u) => !!images[u]);

      const base = frames.length ? images[frames[0]] : undefined;
      const rawW = base?.width ?? 32;
      const rawH = base?.height ?? 32;

      // Scale
      const stage = getLifeStage(formRef.current);
      const targetH = stage === "egg" ? EGG_TARGET_H : (stage === "child" ? CHILD_TARGET_H : ADULT_TARGET_H);
      const scale = (targetH / Math.max(1, rawH));
      const drawW = Math.round(rawW * scale), drawH = Math.round(rawH * scale);

      // -------- physics with edge projection + cooldown --------
      const minX = 0;
      const maxX = LOGICAL_W - drawW;

      let xNext = x + (dir * WALK_SPEED * dt) / 1000;
      const inTurnCooldown = (ts - lastTurnAt) < TURN_COOLDOWN;

      if (!deadRef.current && !sleepingNow) {
        if (!inTurnCooldown) {
          if (dir === 1 && xNext >= maxX) {
            dir = -1; lastTurnAt = ts; x = maxX - EDGE_EPS; frameTimer = 0;
          } else if (dir === -1 && xNext <= minX) {
            dir = 1;  lastTurnAt = ts; x = minX + EDGE_EPS; frameTimer = 0;
          } else {
            x = xNext;
          }
        } else {
          x = Math.min(Math.max(xNext, minX + EDGE_EPS), maxX - EDGE_EPS);
        }
      }

      // Frame switching
      frameTimer += dt;
      if (frameTimer > 1e6) frameTimer %= 1e6;
      let frameIndex = 0;
      if (frames.length >= 2) {
        const step = Math.floor(frameTimer / (1000 / FPS));
        frameIndex = step % frames.length;
      }

      // Draw pet or dead
      if (deadRef.current) {
        const list = deadCandidates(formRef.current);
        const deadSrc = list.find((p) => images[p]);
        const deadImg = deadSrc ? images[deadSrc] : null;
        if (deadImg) {
          const w = Math.round(deadImg.width * scale);
          const h = Math.round(deadImg.height * scale);
          const ix = Math.round((LOGICAL_W - w) / 2);
          const iy = Math.round(LOGICAL_H - BASE_GROUND - h - PET_RAISE);
          ctx.drawImage(deadImg, ix, iy, w, h);
        }
      } else if (frames.length) {
        const ix = Math.round(x);
        const iy = Math.round(LOGICAL_H - BASE_GROUND - drawH - PET_RAISE);
        const img = images[frames[Math.min(frameIndex, frames.length - 1)]];
        if (img) {
          if (dir === -1) {
            ctx.save();
            ctx.scale(-1, 1);
            ctx.drawImage(img, -(ix + drawW), iy, drawW, drawH);
            ctx.restore();
          } else {
            ctx.drawImage(img, ix, iy, drawW, drawH);
          }
        }
      }

      // Cleaning scoop
      if (cleaningRef.current?.active) {
        const st = cleaningRef.current!;
        const scoopImg = images[SCOOP_SRC];
        const scoopH = SCOOP_HEIGHT_TARGET;
        const scoopW = scoopImg ? Math.round((scoopImg.width / scoopImg.height) * scoopH) : 28;
        st.x -= (SCOOP_SPEED_PX_S * dt) / 1000;
        const sy = Math.round(LOGICAL_H - BASE_GROUND - scoopH + EXTRA_DOWN);
        if (scoopImg) ctx.drawImage(scoopImg, Math.round(st.x), sy, scoopW, scoopH);
        else { ctx.font = "14px monospace"; ctx.fillText("🧹", Math.round(st.x), sy); }
        const noseX = st.x + 6;
        setPoops((arr) => arr.filter((p) => Math.abs((p.x + 6) - noseX) > SCOOP_CLEAR_RADIUS));
        if (st.x < -scoopW - 12) {
          setCleaning(null);
          setStats((s) => clampStats({ ...s, cleanliness: Math.max(s.cleanliness, CLEAN_FINISH_CLEANLINESS), happiness: s.happiness + 0.02 }));
        }
      }

      // Banners
      // --- завершили рендер «мира» ---
ctx.restore();

// --- баннеры поверх всего (без Y_SHIFT) ---
const cat = catastropheRef.current;
if (cat && nowAbs < cat.until) {
  drawBanner(ctx, LOGICAL_W, `⚠ ${cat.cause}! stats draining fast`);
}
if (!deadRef.current && sleepingNow) {
  drawBanner(ctx, LOGICAL_W, "😴 Sleeping");
}

    };

    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", resize);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }

  /** Cooldowns for UI */
  const burgerLeft = Math.max(0, FEED_COOLDOWN_MS - (Date.now() - lastBurgerAt));
  const cakeLeft   = Math.max(0, FEED_COOLDOWN_MS - (Date.now() - lastCakeAt));
  const healLeft   = Math.max(0, HEAL_COOLDOWN_MS - (Date.now() - lastHealAt));

  /** Clipboard helper */
  const copyAddr = async () => { try { await navigator.clipboard.writeText(NFT_CONTRACT); } catch {} };

  /** Death overlay (CTA → откроет модал VaultPanel в App через wg:request-nft) */
  const DeathOverlay = isDead ? (
    <OverlayCard>
      <div style={{ fontSize: 18, marginBottom: 6 }}>Your pet has died</div>
      {deathReason && <div className="muted" style={{ marginBottom: 12 }}>Cause: {deathReason}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button
          className="btn btn-primary"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("wg:request-nft", {
                detail: { to: NFT_CONTRACT, address: walletAddress }
              })
            );
          }}
        >
          Send 1 NFT → +1 life
        </button>
      </div>
    </OverlayCard>
  ) : null;

  /** ===== UI ===== */
  return (
    <div style={{ width: "min(92vw, 100%)", maxWidth: MAX_W, margin: "0 auto" }}>
      {/* full contract + copy */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <span className="muted">Vault contract (full):</span>
        <code style={{ fontSize: 12 }}>{NFT_CONTRACT}</code>
        <button className="btn" onClick={copyAddr}>Copy</button>
      </div>

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
        {DeathOverlay}
      </div>

      {/* Status bars */}
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
  {/* ⬇️ вот эта новая кнопка */}
  <button
    className="btn"
    disabled
    title="Coming soon"
    style={{ opacity: 0.45, cursor: "not-allowed" }}
  >
    🧶 $WOOL
  </button>

  <button className="btn" onClick={act.feedBurger} disabled={burgerLeft>0}>🍔 Burger{burgerLeft>0?` (${Math.ceil(burgerLeft/1000)}s)`:``}</button>
  <button className="btn" onClick={act.feedCake} disabled={cakeLeft>0}>🍰 Cake{cakeLeft>0?` (${Math.ceil(cakeLeft/1000)}s)`:``}</button>
  <button className="btn" onClick={act.play}>🎮 Play</button>
  <button className="btn" onClick={act.heal} disabled={healLeft>0}>💊 Heal{healLeft>0?` (${Math.ceil(healLeft/1000)}s)`:``}</button>
  <button className="btn" onClick={act.clean}>🧻 Clean</button>
    {/* ...остальное без изменений */}
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
              localStorage.setItem(sk(SLEEP_FROM_KEY), sleepStart);
              localStorage.setItem(sk(SLEEP_TO_KEY), wakeTime);
              localStorage.setItem(sk(SLEEP_LOCK_KEY), "1");
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
function deadCandidates(form: FormKey): string[] {
  return [`/sprites/${String(form)}/dead.png`, `/sprites/dead/${String(form)}.png`, DEAD_FALLBACK];
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
function drawBanner(ctx: CanvasRenderingContext2D, width: number, text: string) {
  ctx.save();

  // Стиль текста баннера
  ctx.font = "14px monospace";
  ctx.textBaseline = "middle";

  // Паддинги
  const padX = 8;
  const padY = 4;

  // Замеряем размеры текста
  const m = ctx.measureText(text);
  const textW = Math.ceil(m.width);
  const textH = Math.ceil(
    (m.actualBoundingBoxAscent ?? 10) + (m.actualBoundingBoxDescent ?? 4)
  );

  // Размеры и позиция подложки
  const bw = textW + padX * 2;
  const bh = textH + padY * 2;

  // Центрируем по ширине, фиксируем отступ сверху в мире
  const x = Math.round((width - bw) / 2);
  const y = 10; // можно подвинуть, если нужно ниже/выше

  // Подложка
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x, y, bw, bh);

  // Текст по центру подложки по вертикали
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x + padX, y + bh / 2);

  ctx.restore();
}

function safeReadJSON<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); if (!raw) return null; return JSON.parse(raw) as T; } catch { return null; }
}

/** Offline simulator */
function simulateOffline(args: {
  startWall: number; minutes: number; startAgeMs: number;
  startStats: Stats; startSick: boolean;
  sleepCheck: (ts: number) => boolean;
  schedule: number[]; consumed: number[];
}): { stats: Stats; sick: boolean; newConsumed: number[]; died: boolean; deathReason?: string; wasCatastrophe?: boolean; wasSick?: boolean } {
  let s = { ...args.startStats };
  let sick = args.startSick;
  const newly: number[] = [];

  const hungerPerMinNormal = 1 / 90;
  const healthPerMinNormal = 1 / (10 * 60);
  const happyPerMinNormal  = 1 / (12 * 60);
  const dirtPerMinNormal   = 1 / (12 * 60);

  const healthPerMinSick = 1 / 7;
  const happyPerMinSick  = 1 / 8;

  const hungerPerMinFast = 1; // catastrophe

  const schedule = [...(args.schedule || [])].sort((a,b)=>a-b);
  const consumedSet = new Set<number>(args.consumed || []);

  let died = false;
  let deathReason: string | undefined;
  let wasCatastrophe = false;
  let wasSickAtDeath = false;

  for (let i = 0; i < args.minutes; i++) {
    const minuteWall = args.startWall + i * 60000;
    const sleeping = args.sleepCheck(minuteWall);

    let catastropheActive = false;
    for (const t of schedule) {
      if (consumedSet.has(t)) continue;
      if (minuteWall >= t && minuteWall < t + CATA_DURATION_MS && !sleeping) {
        catastropheActive = true;
        newly.push(t);
        consumedSet.add(t);
        break;
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

      if (s.hunger <= 0 || s.health <= 0) {
        died = true;
        wasCatastrophe = catastropheActive;
        wasSickAtDeath = sick;
        deathReason =
          s.hunger <= 0 ? "starvation"
          : catastropheActive ? "fatal event"
          : sick ? "illness" : "collapse";
        break;
      }

      if (!sick) {
        const lowClean = 1 - s.cleanliness;
        const p = 0.02 + 0.3 * 0.3 + 0.2 * lowClean;
        if (Math.random() < p * 0.03 * 60) sick = true;
      } else {
        if (Math.random() < 0.015 * 60) sick = false;
      }
    }
  }

  return { stats: clampStats(s), sick, newConsumed: newly, died, deathReason, wasCatastrophe, wasSick: wasSickAtDeath };
}

/** Tiny UI atoms */
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
