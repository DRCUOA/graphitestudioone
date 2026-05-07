/* -------------------------------------------------------------------------- */
/* Edge detection + snap-to-edge for the Trace Assist drawing aid.            */
/*                                                                            */
/* This module is intentionally tiny and dependency-free so it can be        */
/* loaded both on the main thread (small images, fallback) and inside a     */
/* Web Worker (large images). The output is a single byte-per-pixel        */
/* gradient-magnitude map clamped to [0, 255].                            */
/* -------------------------------------------------------------------------- */

import type { TraceAssist } from '../types';

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

export interface EdgeMap {
  width: number;
  height: number;
  /**
   * Per-pixel Sobel gradient magnitude clamped to [0, 255]. Indexed
   * row-major as `magnitudes[y * width + x]`. Note: this is a `Uint8Array`
   * (not `ClampedArray`) so it can be transferred between worker contexts.
   */
  magnitudes: Uint8Array;
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                   */
/* -------------------------------------------------------------------------- */

/** Search radius (image-pixels) when sensitivity = 1.0. */
export const SNAP_BASE_RADIUS = 14;

/** Minimum gradient magnitude (0–255) considered an edge at sensitivity 1.0. */
export const SNAP_BASE_THRESHOLD = 55;

/** Hard upper bound to keep snap searches O(r²) tractable. */
export const SNAP_MAX_RADIUS = 60;

export const emptyTraceAssist = (): TraceAssist => ({
  enabled: true,
  sensitivity: 1.0,
  showEdges: false,
});

/* -------------------------------------------------------------------------- */
/* Sobel edge magnitude                                                       */
/*                                                                            */
/* Single-pass implementation:                                                */
/*   1. RGBA → grayscale via Rec. 601 luminance                              */
/*   2. 3×3 Sobel separable convolution → gradient magnitude                 */
/*   3. Scale + clamp to 8-bit so the map is a quarter the size of the       */
/*      source ImageData (4 bytes/px → 1 byte/px).                          */
/*                                                                            */
/* Skipping the typical Gaussian pre-blur — for edge SNAP (not display)     */
/* we want sharp localisation; tiny noise tickles are filtered out by      */
/* the magnitude threshold instead.                                        */
/* -------------------------------------------------------------------------- */

/** Magnitude scale applied before clamping. 0.5 keeps mid-range edges visible. */
const MAGNITUDE_SCALE = 0.5;

export const computeEdgeMap = (imageData: ImageData): EdgeMap => {
  const { width, height, data } = imageData;
  const n = width * height;

  // Pass 1: luminance buffer.
  const gray = new Uint8Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    gray[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }

  // Pass 2: 3×3 Sobel. Borders left at 0 — nothing to snap to outside the image.
  const magnitudes = new Uint8Array(n);
  for (let y = 1; y < height - 1; y++) {
    const rowAbove = (y - 1) * width;
    const rowAt = y * width;
    const rowBelow = (y + 1) * width;
    for (let x = 1; x < width - 1; x++) {
      const tl = gray[rowAbove + x - 1];
      const tt = gray[rowAbove + x];
      const tr = gray[rowAbove + x + 1];
      const ll = gray[rowAt + x - 1];
      const rr = gray[rowAt + x + 1];
      const bl = gray[rowBelow + x - 1];
      const bb = gray[rowBelow + x];
      const br = gray[rowBelow + x + 1];

      // Horizontal gradient: right column minus left column, weighted.
      const gx = -tl - 2 * ll - bl + tr + 2 * rr + br;
      // Vertical gradient: bottom row minus top row, weighted.
      const gy = -tl - 2 * tt - tr + bl + 2 * bb + br;

      const mag = Math.sqrt(gx * gx + gy * gy) * MAGNITUDE_SCALE;
      magnitudes[rowAt + x] = mag > 255 ? 255 : (mag | 0);
    }
  }

  return { width, height, magnitudes };
};

/* -------------------------------------------------------------------------- */
/* Snap-to-edge                                                               */
/*                                                                            */
/* Find the strongest edge pixel inside a disc around (cx, cy). Score        */
/* combines magnitude with proximity so the cursor latches onto whatever    */
/* the user is closest to, not the strongest edge in the area.              */
/* -------------------------------------------------------------------------- */

export interface SnapHit {
  x: number;
  y: number;
  /** Magnitude (0–255) of the edge pixel that was snapped to. */
  magnitude: number;
}

export const snapToEdge = (
  map: EdgeMap | null,
  cx: number,
  cy: number,
  radius: number,
  threshold: number,
): SnapHit | null => {
  if (!map) return null;

  const r = Math.max(1, Math.min(SNAP_MAX_RADIUS, Math.round(radius)));
  const r2 = r * r;
  const ix = Math.round(cx);
  const iy = Math.round(cy);

  // Cursor outside the image at all → nothing to snap to.
  if (ix + r < 0 || iy + r < 0 || ix - r >= map.width || iy - r >= map.height) {
    return null;
  }

  const xLo = Math.max(0, ix - r);
  const xHi = Math.min(map.width - 1, ix + r);
  const yLo = Math.max(0, iy - r);
  const yHi = Math.min(map.height - 1, iy + r);

  let bestScore = -1;
  let bestX = -1;
  let bestY = -1;
  let bestMag = 0;

  for (let y = yLo; y <= yHi; y++) {
    const dy = y - iy;
    const rowBase = y * map.width;
    const dy2 = dy * dy;
    for (let x = xLo; x <= xHi; x++) {
      const dx = x - ix;
      const d2 = dx * dx + dy2;
      if (d2 > r2) continue;
      const m = map.magnitudes[rowBase + x];
      if (m < threshold) continue;
      // Proximity weighting: stronger when close, never zero so distant
      // strong edges still beat very weak nearby ones.
      const proximity = 1 - Math.sqrt(d2) / r;
      const score = m * (0.45 + 0.55 * proximity);
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
        bestMag = m;
      }
    }
  }

  if (bestScore < 0) return null;
  return { x: bestX, y: bestY, magnitude: bestMag };
};

/* -------------------------------------------------------------------------- */
/* Sensitivity → (radius, threshold)                                          */
/*                                                                            */
/* The panel exposes a single "sensitivity" knob. Internally we steer two   */
/* parameters from it: bigger sensitivity widens the search and lowers the */
/* threshold so the cursor latches onto subtler features from further       */
/* away. Returning a single function keeps the math in one place.          */
/* -------------------------------------------------------------------------- */

export const snapParamsFor = (sensitivity: number): { radius: number; threshold: number } => {
  const s = Math.max(0.25, Math.min(2.5, sensitivity));
  return {
    radius: SNAP_BASE_RADIUS * s,
    threshold: Math.max(15, SNAP_BASE_THRESHOLD / s),
  };
};
