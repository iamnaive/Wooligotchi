import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * PixelViewport
 * Logical scene has fixed resolution (w × h). We upscale it by an integer factor
 * to fit available space, with nearest-neighbor (no blur).
 */
export default function PixelViewport({
  width,
  height,
  className,
  children,
}: {
  width: number;
  height: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect;
        setAvail({ w: cr.width, h: cr.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = useMemo(() => {
    if (!avail.w || !avail.h) return 1;
    const s = Math.floor(Math.min(avail.w / width, avail.h / height));
    return Math.max(1, s);
  }, [avail, width, height]);

  const scaledW = width * scale;
  const scaledH = height * scale;

  return (
    <div
      ref={hostRef}
      className={className}
      style={{
        position: "relative",
        display: "grid",
        placeItems: "center",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: scaledW,
          height: scaledH,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          imageRendering: "pixelated",
          position: "relative",
        }}
      >
        <div
          style={{
            width,
            height,
            position: "relative",
            overflow: "hidden",
            imageRendering: "pixelated",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
