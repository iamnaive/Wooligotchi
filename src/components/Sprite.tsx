import { useEffect, useRef, useState } from "react";

/** Simple frame-by-frame sprite player */
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
  const [err, setErr] = useState(false);
  const timer = useRef<any>();

  useEffect(() => {
    clearInterval(timer.current);
    setI(0);
    setErr(false);
    if (!frames?.length) return;
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

  const boxStyle: React.CSSProperties = {
    imageRendering: "pixelated",
    width: 160, height: 160,
    display: "block",
    background: "#0f1426",
    border: "1px solid #232846",
    borderRadius: 16,
    ...style,
  };

  if (!frames || frames.length === 0) {
    return (
      <div style={{...boxStyle, display:"grid", placeItems:"center", color:"#a3a7be", fontSize:12}}>
        no frames
      </div>
    );
  }

  const src = frames[i];

  if (err) {
    return (
      <div style={{...boxStyle, display:"grid", placeItems:"center", color:"#ff6b74", fontSize:12}}>
        failed: {src}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      style={boxStyle}
      onError={() => setErr(true)}
    />
  );
}
