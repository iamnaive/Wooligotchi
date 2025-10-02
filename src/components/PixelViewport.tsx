import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * PixelViewport
 * Logical scene has fixed resolution (w × h). We upscale it by an integer factor
 * to fit available space, with nearest-neighbor (no blur).
 *
 * Props:
 *  - width, height: logical resolution (e.g. 320x180)
 *  - className: optional class for outer wrapper
 *  - children: render your scene inside the logical canvas (absolute coords etc.)
 *
 * How it works:
 *  1) Measure available size of the container with ResizeObserver.
 *  2) Compute integer scale = floor(min(availW/w, availH/h)), min 1.
 *  3) Render inner <div> sized w×h and scale it by CSS transform + pixelated.
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

  // size we actually occupy
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
          // inner logical plane (fixed 320x180) + integer scale
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          imageRendering: "pixelated",
          // place the logical plane at 0,0 so children can use absolute coords
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
