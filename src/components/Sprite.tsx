import { useEffect, useRef, useState } from "react";

export default function Sprite({
  frames,
  fps = 8,
  loop = true,
  onDone,
  style,
}: {
  frames: string[];
  fps?: number;
  loop?: boolean;
  onDone?: () => void;
  style?: React.CSSProperties;
}) {
  const [i, setI] = useState(0);
  const timer = useRef<any>();

  useEffect(() => {
    clearInterval(timer.current);
    setI(0);
    if (!frames.length) return;
    timer.current = setInterval(() => {
      setI((prev) => {
        const next = prev + 1;
        if (next >= frames.length) {
          if (loop) return 0;
          clearInterval(timer.current);
          onDone?.();
          return prev;
        }
        return next;
      });
    }, 1000 / fps);
    return () => clearInterval(timer.current);
  }, [frames, fps, loop]);

  if (!frames.length) return null;
  return (
    <img
      src={frames[i]}
      alt=""
      style={{ imageRendering: "pixelated", width: 160, height: 160, ...style }}
    />
  );
}
