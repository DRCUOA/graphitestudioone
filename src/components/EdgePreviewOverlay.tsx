import React, { useEffect, useRef } from 'react';
import type { EdgeMap } from '../lib/edges';

interface Props {
  map: EdgeMap;
  /**
   * Magnitude threshold (0–255). Pixels weaker than this are not drawn,
   * so the visualisation matches what the snap algorithm will actually
   * lock onto. Defaults to 50 (matches `SNAP_BASE_THRESHOLD` ballpark
   * at sensitivity 1.0).
   */
  threshold?: number;
  /** Master opacity in [0, 1]. Multiplied into the per-pixel alpha. */
  opacity?: number;
}

/**
 * Renders detected edges as **bright red, 1-pixel-wide, dashed** marks
 * so the artist can verify exactly where the Trace-Assist snap will
 * latch onto.
 *
 * Two design choices that matter:
 *
 * 1. **Threshold clipping.** Below the magnitude threshold, the pixel is
 *    skipped entirely (alpha 0). The same threshold is fed to the snap
 *    algorithm in `App.tsx`, so the dotted-red field on screen is a
 *    faithful visual preview of every position the cursor can magnetise
 *    to. If the user can see a red mark, snap can lock onto it; if they
 *    can't, it won't.
 *
 * 2. **Stipple dashing.** A coordinate-parity mask (`(x + y) & 1`)
 *    paints only every other pixel in a checkerboard, giving the wire-
 *    frame a "dashed" appearance that's easy to read against any photo
 *    background — solid red over a busy reference image would smear
 *    into the underlying tones and the user couldn't pick out where
 *    edges actually live. Each painted pixel is one image-pixel wide
 *    (the canvas's native resolution); when scaled up by the container
 *    `imageRendering: pixelated` keeps the dashes crisp instead of
 *    blurring them into a pink wash.
 */
export const EdgePreviewOverlay: React.FC<Props> = ({
  map,
  threshold = 50,
  opacity = 0.95,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = map.width;
    canvas.height = map.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const out = ctx.createImageData(map.width, map.height);
    const dst = out.data;
    const mags = map.magnitudes;
    const w = map.width;
    const h = map.height;
    // Clamp threshold defensively — callers might pass anything from the
    // sensitivity slider's mapping. Below 1 the visualisation would be
    // dominated by noise; above ~220 only the strongest contours show.
    const t = Math.max(1, Math.min(254, threshold | 0));

    for (let y = 0; y < h; y++) {
      const rowBase = y * w;
      for (let x = 0; x < w; x++) {
        const i = rowBase + x;
        const m = mags[i];
        const j = i * 4;
        // Two pixels on the magnitude side AND on the right side of the
        // dash-mask both have to be true; one fails → pixel stays the
        // initialised RGBA(0,0,0,0).
        if (m >= t && ((x + y) & 1) === 0) {
          dst[j] = 255;       // pure red
          dst[j + 1] = 30;
          dst[j + 2] = 30;
          dst[j + 3] = 230;   // near-opaque so the dash reads clearly
        }
      }
    }
    ctx.putImageData(out, 0, 0);
  }, [map, threshold]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-[55]"
      style={{
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        opacity,
        // `pixelated` = nearest-neighbour scaling. Without it the browser
        // would bilinear-blur the dashes when the image gets zoomed up,
        // turning the crisp red stipple into a fuzzy pink mist.
        imageRendering: 'pixelated',
      }}
      aria-hidden
    />
  );
};
