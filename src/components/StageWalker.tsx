import React, { useEffect, useRef, useState } from "react";
import Sprite from "./Sprite";

/**
 * StageWalker
 * Walks left↔right inside a logical PixelViewport (e.g., 320×180).
 */
export default function StageWalker({
  frames,
  spriteW = 32,
  spriteH = 32,
  speed = 24,     // px per second in logical coords
  left = 0,
  right = 320,
  y = 164,        // baseline (bottom of sprite)
  auto = true,
  fps = 8,
}: {
  frames: string[];
  spriteW?: number;
  spriteH?: number;
  speed?: number;
  left?: number;
  right?: number;
  y?: number;
  auto?: boolean;
  fps?: number;
}) {
  const [x, setX] = useState(left);
  const [dir, setDir] = useState<1 | -1>(1); // 1=right, -1=left
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!auto) return;

    const step = (t: number) => {
      if (last.current == null) last.current = t;
      const dt = (t - last.current) / 1000; // seconds
      last.current = t;

      let nx = x + dir * speed * dt;
      const minX = left;
      const maxX = Math.max(left, right - spriteW);

      if (nx > maxX) { nx = maxX; setDir(-1); }
      if (nx < minX) { nx = minX; setDir(1); }

      setX(nx);
      raf.current = requestAnimationFrame(step);
    };

    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
      last.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, dir, speed, left, right, spriteW, x]);

  return (
    <div
      style={{
        position: "absolute",
        left: Math.round(x),
        top: Math.round(y - spriteH),
        width: spriteW,
        height: spriteH,
        imageRendering: "pixelated",
        transform: dir === -1 ? "scaleX(-1)" : "none",
        transformOrigin: "center",
      }}
    >
      <Sprite frames={frames} fps={fps} loop />
    </div>
  );
}
