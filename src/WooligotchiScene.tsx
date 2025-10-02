// src/WooligotchiScene.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

type AnimName = "idle" | "walk";
type FrameList = string[];
type AnimDef = Record<AnimName, FrameList>;

type FormKey =
  | "egg"
  | "adultEgg"
  | "char1"
  | "char1_adult"
  | "char2"
  | "char2_adult"
  | "char3"
  | "char3_adult"
  | "char4"
  | "char4_adult";

type FormCatalog = Record<FormKey, AnimDef>;

const BG_SRC = "/bg/BG.png";

// Your existing egg sprites (match your /public structure)
const eggAnim: AnimDef = {
  idle: ["/sprites/egg/idle_1.png"],
  walk: [
    "/sprites/egg/walk_1.png",
    "/sprites/egg/walk_2.png",
    "/sprites/egg/walk_3.png",
  ],
};

// Stubs for other forms: safe single-frame defaults (no black boxes).
const stub = (prefix: string): AnimDef => ({
  idle: [`${prefix}/idle_1.png`],
  walk: [`${prefix}/walk_1.png`],
});

const FORMS: FormCatalog = {
  egg: eggAnim,
  adultEgg: stub("/sprites/adultEgg"),
  char1: stub("/sprites/char1"),
  char1_adult: stub("/sprites/char1_adult"),
  char2: stub("/sprites/char2"),
  char2_adult: stub("/sprites/char2_adult"),
  char3: stub("/sprites/char3"),
  char3_adult: stub("/sprites/char3_adult"),
  char4: stub("/sprites/char4"),
  char4_adult: stub("/sprites/char4_adult"),
};

function evolveOnce(current: FormKey): FormKey {
  if (current === "egg") return "adultEgg";
  if (current === "adultEgg") {
    const pool: FormKey[] = ["char1", "char2", "char3", "char4"];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  if (current.endsWith("_adult")) return current;
  return (current + "_adult") as FormKey;
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });

function useImages(urls: string[]) {
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({});
  useEffect(() => {
    let alive = true;
    Promise.allSettled(urls.map(loadImage)).then((results) => {
      if (!alive) return;
      const map: Record<string, HTMLImageElement> = {};
      results.forEach((r, i) => {
        const url = urls[i];
        if (r.status === "fulfilled") map[url] = r.value;
      });
      setImages(map);
    });
    return () => {
      alive = false;
    };
  }, [urls.join("|")]);
  return images;
}

type Props = {
  initialForm?: FormKey;
  logicalWidth?: number;
  logicalHeight?: number;
  fps?: number;
  speedPxPerSec?: number;
  showDebug?: boolean;
};

const WooligotchiScene: React.FC<Props> = ({
  initialForm = "egg",
  logicalWidth = 320,
  logicalHeight = 180,
  fps = 6,
  speedPxPerSec = 36,
  showDebug = true,
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [form, setForm] = useState<FormKey>(initialForm);
  const [anim, setAnim] = useState<AnimName>("walk");

  const urls = useMemo(() => {
    const set = new Set<string>();
    set.add(BG_SRC);
    const def = FORMS[form];
    Object.values(def).forEach((frames) => frames.forEach((u) => set.add(u)));
    return Array.from(set);
  }, [form]);

  const images = useImages(urls);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { alpha: true })!;
    (ctx as any).imageSmoothingEnabled = false;

    let raf = 0;
    let running = true;

    const frameDuration = 1000 / fps;
    let frameTimer = 0;
    let frameIndex = 0;

    let lastTs = performance.now();

    // Sprite ground position (tweak if your sprite height differs)
    let x = 40;
    let y = logicalHeight - 48;

    const resize = () => {
      const wrap = wrapperRef.current!;
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      const w = wrap.clientWidth || logicalWidth;
      const h = wrap.clientHeight || logicalHeight;

      const targetAspect = logicalWidth / logicalHeight;
      const boxAspect = w / h;
      let cssW = w;
      let cssH = h;
      if (boxAspect > targetAspect) cssW = Math.round(h * targetAspect);
      else cssH = Math.round(w / targetAspect);

      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale((cssW * dpr) / logicalWidth, (cssH * dpr) / logicalHeight);
      (ctx as any).imageSmoothingEnabled = false;
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrapperRef.current!);
    resize();

    const loop = (ts: number) => {
      if (!running) return;
      const dt = Math.min(100, ts - lastTs);
      lastTs = ts;

      ctx.clearRect(0, 0, logicalWidth, logicalHeight);

      const bg = images[BG_SRC];
      if (bg) {
        const scale = Math.max(
          logicalWidth / bg.width,
          logicalHeight / bg.height
        );
        const drawW = Math.floor(bg.width * scale);
        const drawH = Math.floor(bg.height * scale);
        const dx = Math.floor((logicalWidth - drawW) / 2);
        const dy = Math.floor((logicalHeight - drawH) / 2);
        ctx.drawImage(bg, dx, dy, drawW, drawH);
      }

      const def = FORMS[form];
      const frames = (def[anim] && def[anim].length > 0 ? def[anim] : def.idle)
        .filter((u) => !!images[u]);

      if (frames.length > 0) {
        frameTimer += dt;
        if (frameTimer >= frameDuration) {
          frameTimer -= frameDuration;
          frameIndex = (frameIndex + 1) % frames.length;
        }
      }

      if (anim === "walk") {
        x += (speedPxPerSec * dt) / 1000;
        if (x > logicalWidth + 16) x = -16;
      }

      if (frames.length > 0) {
        const img = images[frames[frameIndex]];
        if (img) {
          const w = img.width;
          const h = img.height;
          const ix = Math.round(x);
          const iy = Math.round(y - h);
          ctx.drawImage(img, ix, iy, w, h);
        }
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [images, form, anim, logicalWidth, logicalHeight, fps, speedPxPerSec]);

  const evolve = () => setForm((f) => evolveOnce(f));
  const toggleAnim = () => setAnim((a) => (a === "walk" ? "idle" : "walk"));

  return (
    <div
      ref={wrapperRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        imageRendering: "pixelated",
        overflow: "hidden",
        borderRadius: 12,
        background: "transparent",
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
      <div
        style={{
          position: "absolute",
          left: 8,
          bottom: 8,
          display: "flex",
          gap: 8,
          fontSize: 12,
          padding: 6,
          borderRadius: 8,
          background: "rgba(0,0,0,0.35)",
          backdropFilter: "blur(4px)",
        }}
      >
        <button onClick={evolve} style={btnStyle}>⭐ Evolve</button>
        <button onClick={toggleAnim} style={btnStyle}>Toggle Walk/Idle</button>
        <span style={{ alignSelf: "center", opacity: 0.85 }}>
          Form: <b>{form}</b>
        </span>
      </div>
    </div>
  );
};

const btnStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
  userSelect: "none",
};

export default WooligotchiScene;
