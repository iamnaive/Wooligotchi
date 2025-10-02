import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * PixelViewport
 * Fixed logical resolution (width × height) with integer upscaling (nearest-neighbor).
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
      {/* Logical plane: width × height (не масштабированный!) */}
      <div
        style={{
          width,
          height,
          position: "relative",
          imageRendering: "pixelated",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}
