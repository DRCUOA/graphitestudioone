/* -------------------------------------------------------------------------- */
/* Free-line (freehand) drawing helpers.                                      */
/*                                                                            */
/* Pure functions only — pointer capture and persistence live elsewhere.      */
/* -------------------------------------------------------------------------- */

import type { CalibrationPoint, FreeLine, FreeLineState } from '../types';

/* -------------------------------------------------------------------------- */
/* Identity / construction                                                    */
/* -------------------------------------------------------------------------- */

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `fl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const createFreeLine = (input: {
  points: CalibrationPoint[];
  pressures: number[];
  widthScale: number;
  color: string;
}): FreeLine => {
  // Defensive copies so the caller can mutate their working buffer freely
  // after handing the stroke to state. Length-match pressures to points
  // (pad with the trailing pressure if short, truncate if long) so every
  // downstream consumer can index in lock-step without bounds checks.
  const points = input.points.map((p) => ({ x: p.x, y: p.y }));
  const pressures: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const raw = input.pressures[i];
    pressures.push(typeof raw === 'number' && Number.isFinite(raw)
      ? Math.max(0, Math.min(1, raw))
      : 0.5);
  }
  return {
    id: newId(),
    points,
    pressures,
    widthScale: input.widthScale,
    color: input.color,
    createdAt: Date.now(),
  };
};

/* -------------------------------------------------------------------------- */
/* Show-N bounds (mirror lines.ts so the panels look identical).              */
/* -------------------------------------------------------------------------- */

export const FREELINE_SHOW_N_MIN = 1;
export const FREELINE_SHOW_N_MAX = 999;

/** Filter the rendering subset: most-recent N strokes, in draw order. */
export const visibleFreeLines = (state: FreeLineState): FreeLine[] => {
  if (!state.visible || state.strokes.length === 0) return [];
  const n = Math.max(
    FREELINE_SHOW_N_MIN,
    Math.min(FREELINE_SHOW_N_MAX, state.showLastN),
  );
  return state.strokes.slice(-n);
};

/* -------------------------------------------------------------------------- */
/* Defaults                                                                   */
/* -------------------------------------------------------------------------- */

export const DEFAULT_FREELINE_COLOR = '#fb7185'; // rose-400 — distinct from cyan / amber / violet

/** Eraser brush size bounds (image-pixel units). */
export const ERASER_MIN = 4;
export const ERASER_MAX = 200;
export const DEFAULT_ERASER_SIZE = 24;

export const emptyFreeLineState = (): FreeLineState => ({
  strokes: [],
  visible: true,
  showLastN: 50,
  // Image-pixel units. Effective on-screen weight is scaled by the
  // overlay so it stays visible at any reference resolution; this number
  // is a "1.0× baseline" multiplier the user can tune.
  strokeWidth: 2,
  color: DEFAULT_FREELINE_COLOR,
  pressureEnabled: true,
  eraserSize: DEFAULT_ERASER_SIZE,
});

/* -------------------------------------------------------------------------- */
/* Sampling — minimum distance between captured points                        */
/*                                                                            */
/* Pointer-move fires at refresh rate (often 1000+ Hz on a trackpad). We     */
/* drop samples that are within `minDistance` of the previous one so the     */
/* stored stroke stays compact without losing visible detail. The default    */
/* of 1.5 image-pixels is small enough that even tight curves remain smooth. */
/* -------------------------------------------------------------------------- */

export const MIN_SAMPLE_DISTANCE_PX = 1.5;

export const shouldAppendSample = (
  prev: CalibrationPoint,
  next: CalibrationPoint,
  minDistance = MIN_SAMPLE_DISTANCE_PX,
): boolean => {
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  return dx * dx + dy * dy >= minDistance * minDistance;
};

/* -------------------------------------------------------------------------- */
/* SVG path generation                                                        */
/*                                                                            */
/* Quadratic-Bézier smoothing using midpoint anchoring (a simple, robust     */
/* technique used by tldraw, excalidraw and similar tools). Each captured    */
/* point becomes the control point of a curve that ends at the midpoint of  */
/* itself and the next sample, producing visually smooth strokes without    */
/* requiring a heavy curve-fitting pass.                                    */
/* -------------------------------------------------------------------------- */

export const buildSmoothPath = (points: CalibrationPoint[]): string => {
  if (points.length === 0) return '';
  if (points.length === 1) {
    // Single tap — render a tiny dot via a zero-length line so the
    // stroke-linecap="round" gives us a visible mark.
    const p = points[0];
    return `M ${p.x.toFixed(2)} ${p.y.toFixed(2)} L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }
  if (points.length === 2) {
    const [a, b] = points;
    return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  }

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const next = points[i + 1];
    const mx = (p.x + next.x) / 2;
    const my = (p.y + next.y) / 2;
    d += ` Q ${p.x.toFixed(2)} ${p.y.toFixed(2)}, ${mx.toFixed(2)} ${my.toFixed(2)}`;
  }
  // Final segment: straight line to the last sample so the stroke ends
  // exactly where the user lifted the pointer (no quadratic overshoot).
  const last = points[points.length - 1];
  d += ` L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  return d;
};

/* -------------------------------------------------------------------------- */
/* Bounds + summary helpers                                                   */
/* -------------------------------------------------------------------------- */

/** Total piecewise length of a stroke in pixels. Used by panel summaries. */
export const strokeLengthPx = (points: CalibrationPoint[]): number => {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
};

/* -------------------------------------------------------------------------- */
/* Variable-width fill polygon                                                */
/*                                                                            */
/* SVG <path stroke> can't taper, so for pressure-aware strokes we generate  */
/* a closed polygon and `fill` it instead. The polygon is constructed by    */
/* offsetting each sample point along the local normal by ±half the width   */
/* dictated by that sample's pressure, then joining the offset points into  */
/* one continuous boundary. Round caps at the ends are drawn as SVG arcs.   */
/*                                                                          */
/* This is the same idea behind the popular "perfect-freehand" library but */
/* much smaller and dependency-free. With ≥1.5px sample density the visible*/
/* faceting from straight segments is below display resolution, so we don't */
/* spend time fitting Bézier curves to the boundary.                       */
/* -------------------------------------------------------------------------- */

/** Map a 0..1 pressure value to an effective width multiplier in [0.3, 1.2]. */
const widthCurve = (pressure: number): number => 0.3 + Math.max(0, Math.min(1, pressure)) * 0.9;

interface OffsetPoint { x: number; y: number; nx: number; ny: number; w: number; }

const computeOffsets = (
  points: CalibrationPoint[],
  pressures: number[],
  baseWidth: number,
): OffsetPoint[] => {
  const out: OffsetPoint[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    // Local tangent: average of incoming + outgoing edges. Endpoints get
    // whichever single edge they have. Falling back to (1,0) avoids a
    // NaN normal for the degenerate "all points coincide" case.
    let tx = 0;
    let ty = 0;
    if (i > 0) { tx += points[i].x - points[i - 1].x; ty += points[i].y - points[i - 1].y; }
    if (i < n - 1) { tx += points[i + 1].x - points[i].x; ty += points[i + 1].y - points[i].y; }
    const len = Math.hypot(tx, ty);
    const ux = len > 1e-6 ? tx / len : 1;
    const uy = len > 1e-6 ? ty / len : 0;
    // Perpendicular (90° CCW in screen coords)
    const nx = -uy;
    const ny = ux;
    const w = Math.max(0.5, baseWidth * widthCurve(pressures[i] ?? 0.5));
    out.push({ x: points[i].x, y: points[i].y, nx, ny, w });
  }
  return out;
};

/**
 * Build a fillable SVG path that traces a variable-width ribbon along the
 * sample points. `baseWidth` is the maximum width (full pressure); the
 * pressure curve scales each sample's width down from there.
 */
export const buildVariableWidthPath = (
  points: CalibrationPoint[],
  pressures: number[],
  baseWidth: number,
): string => {
  const n = points.length;
  if (n === 0) return '';

  // A single-sample stroke renders as a circle so taps still leave a mark.
  if (n === 1) {
    const p = points[0];
    const r = Math.max(0.5, (baseWidth * widthCurve(pressures[0] ?? 0.5)) / 2);
    return [
      `M ${(p.x - r).toFixed(2)} ${p.y.toFixed(2)}`,
      `A ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(p.x + r).toFixed(2)} ${p.y.toFixed(2)}`,
      `A ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(p.x - r).toFixed(2)} ${p.y.toFixed(2)}`,
      'Z',
    ].join(' ');
  }

  const off = computeOffsets(points, pressures, baseWidth);

  // Forward pass along the "left" side (positive normal direction)
  let d = `M ${(off[0].x + off[0].nx * off[0].w / 2).toFixed(2)} ${(off[0].y + off[0].ny * off[0].w / 2).toFixed(2)}`;
  for (let i = 1; i < n; i++) {
    d += ` L ${(off[i].x + off[i].nx * off[i].w / 2).toFixed(2)} ${(off[i].y + off[i].ny * off[i].w / 2).toFixed(2)}`;
  }
  // End cap: half-circle bulging forward from left to right offset.
  const last = off[n - 1];
  const rEnd = last.w / 2;
  const endRX = (last.x - last.nx * rEnd).toFixed(2);
  const endRY = (last.y - last.ny * rEnd).toFixed(2);
  d += ` A ${rEnd.toFixed(2)} ${rEnd.toFixed(2)} 0 0 1 ${endRX} ${endRY}`;
  // Reverse pass along the "right" side
  for (let i = n - 2; i >= 0; i--) {
    d += ` L ${(off[i].x - off[i].nx * off[i].w / 2).toFixed(2)} ${(off[i].y - off[i].ny * off[i].w / 2).toFixed(2)}`;
  }
  // Start cap: half-circle bulging backward from right back to left offset.
  const first = off[0];
  const rStart = first.w / 2;
  const startLX = (first.x + first.nx * rStart).toFixed(2);
  const startLY = (first.y + first.ny * rStart).toFixed(2);
  d += ` A ${rStart.toFixed(2)} ${rStart.toFixed(2)} 0 0 1 ${startLX} ${startLY} Z`;

  return d;
};

/* -------------------------------------------------------------------------- */
/* Pressure simulation (mouse + touch fallback)                               */
/*                                                                            */
/* Real pencils deposit more graphite when the hand moves slowly — both     */
/* because the lead has more time to abrade and because slow strokes        */
/* usually carry more downward force. Mirroring that on screen makes a      */
/* mouse-drawn line "feel" right: gestural sweeps come out lighter,        */
/* deliberate marks come out darker. Tablet users get true pressure via    */
/* PointerEvent.pressure and bypass this path entirely.                    */
/* -------------------------------------------------------------------------- */

/** Velocity above which simulated pressure bottoms out (image-px / ms). */
const VELOCITY_PEAK = 3;

export const simulatePressure = (
  prev: CalibrationPoint,
  prevTime: number,
  next: CalibrationPoint,
  nextTime: number,
  prevPressure: number,
): number => {
  const dt = Math.max(1, nextTime - prevTime);
  const dist = Math.hypot(next.x - prev.x, next.y - prev.y);
  const v = Math.min(VELOCITY_PEAK, dist / dt);
  // Slow → ~0.85, fast → ~0.25. Maps reasonably to a soft pencil's range.
  const target = 0.85 - (v / VELOCITY_PEAK) * 0.6;
  // Low-pass filter: weighted blend with the previous sample's pressure
  // to smooth out the noisy per-event velocity readings.
  return prevPressure * 0.6 + target * 0.4;
};

/* -------------------------------------------------------------------------- */
/* Eraser hit-testing                                                         */
/*                                                                            */
/* We treat each stroke as the polyline through its sample points (the      */
/* width fattens it visually, but the underlying geometry is the spine).    */
/* The eraser is a circle, so a stroke is "hit" iff any of its segments    */
/* passes within the eraser radius of the cursor.                          */
/* -------------------------------------------------------------------------- */

/** Squared distance from point P to segment AB. */
const distSqPointToSegment = (
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number => {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) {
    return apx * apx + apy * apy;
  }
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
};

export const eraserHitsStroke = (
  stroke: FreeLine,
  cursorX: number, cursorY: number,
  radius: number,
): boolean => {
  const r2 = radius * radius;
  const pts = stroke.points;
  if (pts.length === 0) return false;
  if (pts.length === 1) {
    const dx = pts[0].x - cursorX;
    const dy = pts[0].y - cursorY;
    return dx * dx + dy * dy <= r2;
  }
  for (let i = 1; i < pts.length; i++) {
    if (distSqPointToSegment(cursorX, cursorY,
      pts[i - 1].x, pts[i - 1].y,
      pts[i].x, pts[i].y) <= r2) {
      return true;
    }
  }
  return false;
};
