import {
  Calibration,
  CalibrationState,
  GridConfig,
  LineState,
  MeasurementState,
  OverlayFit,
} from '../types';
import {
  convertUnit,
  distance,
  formatMeasurement,
  pxToUnits,
} from './calibration';
import { visibleLines } from './lines';

/* -------------------------------------------------------------------------- */
/* Public API surface                                                         */
/* -------------------------------------------------------------------------- */

export type ExportLayerKey =
  | 'reference'
  | 'analysis'
  | 'overlay'
  | 'grid'
  | 'rulers'
  | 'calibration'
  | 'measurements'
  | 'lines';

/** Per-layer opacity in 0..1. A value of 0 means "exclude from export". */
export type ExportOpacities = Record<ExportLayerKey, number>;

/** Metadata used by the modal to render the layer list — built from the
 *  current app state via {@link buildExportLayerMetas}. */
export interface ExportLayerMeta {
  key: ExportLayerKey;
  label: string;
  description: string;
  /** True when the underlying data exists (e.g. an overlay image is loaded,
   *  measurements have been recorded, etc.). Disabled rows are still shown
   *  for discoverability but their slider is greyed out. */
  available: boolean;
  /** The default opacity to seed the slider with — usually mirrors the
   *  current on-screen visibility so "Open → Export" gives the same image
   *  the user is looking at. */
  defaultOpacity: number;
}

export interface ExportComposeArgs {
  imageElement: HTMLImageElement;
  referenceCanvas: HTMLCanvasElement | null;
  analysisCanvas: HTMLCanvasElement | null;
  overlayImageElement: HTMLImageElement | null;
  overlayFit: OverlayFit;
  grid: GridConfig;
  calibration: CalibrationState;
  activeCalibration: Calibration | null;
  measurement: MeasurementState;
  lineState: LineState;
  opacities: ExportOpacities;
}

/* -------------------------------------------------------------------------- */
/* Layer descriptor builder                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Inspect current app state and produce one row per known layer. Defaults
 * are seeded from the live workspace so re-exporting feels like "save what
 * I'm looking at" out of the box, while the modal still lets the user
 * dial each layer up or down.
 */
export const buildExportLayerMetas = (input: {
  hasReference: boolean;
  referenceLayerVisible: boolean;
  referenceLayerOpacity: number;
  analysisLayerVisible: boolean;
  analysisLayerOpacity: number;
  hasOverlayImage: boolean;
  overlayLayerVisible: boolean;
  overlayLayerOpacity: number;
  grid: GridConfig;
  rulersVisible: boolean;
  hasCalibration: boolean;
  calibrationVisible: boolean;
  measurementCount: number;
  measurementsVisible: boolean;
  lineCount: number;
  linesVisible: boolean;
}): ExportLayerMeta[] => {
  const live = (visible: boolean, opacity: number) => (visible ? opacity : 0);
  return [
    {
      key: 'reference',
      label: 'Reference Image',
      description: 'Base photo with brightness/contrast adjustments only.',
      available: input.hasReference,
      defaultOpacity: live(input.referenceLayerVisible, input.referenceLayerOpacity),
    },
    {
      key: 'analysis',
      label: 'Analysis',
      description: 'Reference with all assistant filters (grayscale, edges, posterize, etc.) applied.',
      available: input.hasReference,
      defaultOpacity: live(input.analysisLayerVisible, input.analysisLayerOpacity),
    },
    {
      key: 'overlay',
      label: 'Overlay Image',
      description: 'Photo of your in-progress drawing layered over the reference.',
      available: input.hasOverlayImage,
      defaultOpacity: input.hasOverlayImage
        ? live(input.overlayLayerVisible, input.overlayLayerOpacity)
        : 0,
    },
    {
      key: 'grid',
      label: 'Grid',
      description: 'Proportional grid lines.',
      available: input.grid.enabled,
      defaultOpacity: input.grid.enabled ? input.grid.opacity : 0,
    },
    {
      key: 'rulers',
      label: 'Rulers (cm/mm)',
      description: 'X and Y rulers along the image edges. Requires a calibration.',
      available: input.hasCalibration,
      defaultOpacity: input.rulersVisible ? 1 : 0,
    },
    {
      key: 'calibration',
      label: 'Calibration Markers',
      description: 'Active calibration line and A/B endpoints.',
      available: input.hasCalibration,
      defaultOpacity: input.calibrationVisible ? 1 : 0,
    },
    {
      key: 'measurements',
      label: 'Measurements',
      description: 'Custom named measurement markers.',
      available: input.measurementCount > 0,
      defaultOpacity: input.measurementsVisible && input.measurementCount > 0 ? 1 : 0,
    },
    {
      key: 'lines',
      label: 'Line Shapes',
      description: 'Free-form construction lines.',
      available: input.lineCount > 0,
      defaultOpacity: input.linesVisible && input.lineCount > 0 ? 1 : 0,
    },
  ];
};

/* -------------------------------------------------------------------------- */
/* Composition entry point                                                    */
/* -------------------------------------------------------------------------- */

/** Same constants used by the live RulerOverlay so the export looks identical. */
const RULER_THICKNESS_FACTOR = 0.025;
const MAX_RULER_THICKNESS = 60;
const MIN_RULER_THICKNESS = 18;

const computeRulerThickness = (w: number, h: number): number =>
  Math.min(
    MAX_RULER_THICKNESS,
    Math.max(MIN_RULER_THICKNESS, Math.min(w, h) * RULER_THICKNESS_FACTOR),
  );

/**
 * Compose every requested layer onto a single canvas at the user's chosen
 * opacities. Returns the canvas so the caller can both display a preview
 * and toDataURL it for download.
 *
 * Layer ordering (back → front, matches the live viewport):
 *   reference → analysis → overlay image → grid → calibration markers
 *   → measurement markers → line shapes → rulers (drawn last so their
 *     opaque background panels can overlay any tick marks the other
 *     layers might have placed near the image edges)
 */
export const composeExport = (args: ExportComposeArgs): HTMLCanvasElement => {
  const { imageElement, opacities, activeCalibration } = args;
  const w = imageElement.width;
  const h = imageElement.height;

  // Decide whether the canvas needs extra room for rulers. Rulers sit
  // OUTSIDE the image area in the live view — to preserve that look we
  // grow the canvas by the ruler thickness on the top & left, and shift
  // every other layer down/right by the same amount.
  const includeRulers =
    opacities.rulers > 0 &&
    !!activeCalibration &&
    activeCalibration.unit !== 'px';
  const rulerThickness = includeRulers ? computeRulerThickness(w, h) : 0;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w + rulerThickness);
  canvas.height = Math.round(h + rulerThickness);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Solid background — png exports with transparency tend to confuse some
  // downstream tools (chat clients, printers). Zinc-950 matches the app's
  // workspace bg so the export blends with the in-app preview.
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Image-space drawing all happens with this transform applied so layer
  // functions can think in 0..imageWidth × 0..imageHeight.
  ctx.save();
  ctx.translate(rulerThickness, rulerThickness);

  if (opacities.reference > 0 && args.referenceCanvas) {
    drawCanvasLayer(ctx, args.referenceCanvas, opacities.reference);
  }
  if (opacities.analysis > 0 && args.analysisCanvas) {
    drawCanvasLayer(ctx, args.analysisCanvas, opacities.analysis);
  }
  if (opacities.overlay > 0 && args.overlayImageElement) {
    drawOverlayImage(
      ctx,
      args.overlayImageElement,
      args.overlayFit,
      w,
      h,
      opacities.overlay,
    );
  }
  if (opacities.grid > 0 && args.grid.enabled) {
    drawGrid(ctx, args.grid, w, h, opacities.grid);
  }
  if (opacities.calibration > 0 && activeCalibration) {
    drawCalibration(ctx, activeCalibration, w, h, opacities.calibration);
  }
  if (opacities.measurements > 0 && args.measurement.measurements.length > 0) {
    drawMeasurements(ctx, args.measurement, activeCalibration, w, h, opacities.measurements);
  }
  if (opacities.lines > 0 && args.lineState.lines.length > 0) {
    drawLines(ctx, args.lineState, w, h, opacities.lines);
  }

  ctx.restore();

  // Rulers drawn in CANVAS coordinates (no translate) so we can reach the
  // top-left strips outside the image area.
  if (includeRulers && activeCalibration) {
    drawRulers(ctx, activeCalibration, w, h, opacities.rulers, rulerThickness);
  }

  return canvas;
};

/* -------------------------------------------------------------------------- */
/* Layer drawing primitives                                                   */
/* -------------------------------------------------------------------------- */

const drawCanvasLayer = (
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  opacity: number,
) => {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(src, 0, 0);
  ctx.restore();
};

const drawOverlayImage = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  fit: OverlayFit,
  w: number,
  h: number,
  opacity: number,
) => {
  if (img.width === 0 || img.height === 0) return;
  const imgAspect = img.width / img.height;
  const targetAspect = w / h;
  let dw: number, dh: number;
  if (fit === 'fill') {
    dw = w;
    dh = h;
  } else if (fit === 'contain') {
    if (imgAspect > targetAspect) {
      dw = w;
      dh = w / imgAspect;
    } else {
      dh = h;
      dw = h * imgAspect;
    }
  } else {
    // cover
    if (imgAspect > targetAspect) {
      dh = h;
      dw = h * imgAspect;
    } else {
      dw = w;
      dh = w / imgAspect;
    }
  }
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
};

const drawGrid = (
  ctx: CanvasRenderingContext2D,
  grid: GridConfig,
  w: number,
  h: number,
  layerOpacity: number,
) => {
  ctx.save();
  // Multiply the per-layer export opacity with the grid's own opacity so a
  // user with `grid.opacity=0.3` who exports at `grid=0.5` gets ~0.15 — the
  // expected "half of half" result.
  ctx.globalAlpha = layerOpacity * grid.opacity;
  ctx.strokeStyle = grid.color;
  ctx.lineWidth = grid.thickness;
  if (grid.lineStyle === 'dashed') {
    const dashLen = Math.max(4, grid.thickness * 6);
    const gapLen = Math.max(3, grid.thickness * 4);
    ctx.setLineDash([dashLen, gapLen]);
  }
  for (let i = 1; i < grid.cols; i++) {
    const x = (i / grid.cols) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let i = 1; i < grid.rows; i++) {
    const y = (i / grid.rows) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
};

/* ---------- Calibration ---------- */

const drawCalibration = (
  ctx: CanvasRenderingContext2D,
  cal: Calibration,
  w: number,
  h: number,
  opacity: number,
) => {
  ctx.save();
  ctx.globalAlpha = opacity;
  const markerRadius = Math.max(6, Math.min(w, h) * 0.012);
  const strokeWidth = Math.max(1, markerRadius * 0.18);
  const fontSize = Math.max(10, markerRadius * 1.4);
  const COLOR = '#22d3ee'; // cyan-400 — matches CalibrationOverlay

  drawSegmentWithMarkers(ctx, cal.pointA, cal.pointB, {
    color: COLOR,
    strokeWidth,
    markerRadius,
    dashed: false,
    label: formatMeasurement(cal.realDistance, cal.unit),
    labelFontSize: fontSize,
  });
  ctx.restore();
};

/* ---------- Measurements ---------- */

const drawMeasurements = (
  ctx: CanvasRenderingContext2D,
  state: MeasurementState,
  activeCal: Calibration | null,
  w: number,
  h: number,
  opacity: number,
) => {
  if (!state.showAll) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  const markerRadius = Math.max(5, Math.min(w, h) * 0.01);
  const strokeWidth = Math.max(1, markerRadius * 0.18);
  const fontSize = Math.max(10, markerRadius * 1.4);
  const COLOR = '#fbbf24'; // amber-400

  for (const m of state.measurements) {
    if (!m.visible) continue;
    const px = distance(m.pointA, m.pointB);
    const { value, unit } = pxToUnits(px, activeCal);
    const distLabel =
      unit === 'px' ? `${px.toFixed(1)} px` : formatMeasurement(value, unit);
    drawSegmentWithMarkers(ctx, m.pointA, m.pointB, {
      color: COLOR,
      strokeWidth,
      markerRadius,
      dashed: false,
      label: `${m.name} · ${distLabel}`,
      labelFontSize: fontSize,
    });
  }
  ctx.restore();
};

/* ---------- Lines ---------- */

const drawLines = (
  ctx: CanvasRenderingContext2D,
  state: LineState,
  w: number,
  h: number,
  opacity: number,
) => {
  const lines = visibleLines(state);
  if (lines.length === 0) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  const strokeWidth = Math.max(1.5, Math.min(w, h) * 0.0025);
  const haloWidth = strokeWidth * 2.4;
  const COLOR = '#a78bfa'; // violet-400

  lines.forEach((l, idx) => {
    // Mirrors the LineOverlay age-fade so older lines sit back.
    const ageOpacity =
      lines.length <= 1 ? 1 : 0.35 + (0.65 * idx) / (lines.length - 1);
    ctx.save();
    ctx.globalAlpha = opacity * ageOpacity;
    ctx.lineCap = 'round';

    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = haloWidth;
    ctx.beginPath();
    ctx.moveTo(l.pointA.x, l.pointA.y);
    ctx.lineTo(l.pointB.x, l.pointB.y);
    ctx.stroke();

    ctx.strokeStyle = COLOR;
    ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    ctx.moveTo(l.pointA.x, l.pointA.y);
    ctx.lineTo(l.pointB.x, l.pointB.y);
    ctx.stroke();

    ctx.restore();
  });
  ctx.restore();
};

/* ---------- Shared segment renderer (used by calibration + measurements) ---- */

interface SegmentStyle {
  color: string;
  strokeWidth: number;
  markerRadius: number;
  dashed: boolean;
  label: string;
  labelFontSize: number;
}

const drawSegmentWithMarkers = (
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  s: SegmentStyle,
) => {
  ctx.save();
  ctx.lineCap = 'round';

  // Halo for legibility on bright photos
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = s.strokeWidth * 2.4;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  // Main stroke
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.strokeWidth;
  if (s.dashed) {
    ctx.setLineDash([s.strokeWidth * 4, s.strokeWidth * 3]);
  } else {
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // A / B endpoint dots
  for (const p of [a, b]) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, s.markerRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.strokeWidth;
    ctx.stroke();
  }

  // Label pill at the midpoint
  if (s.label) {
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const padding = s.labelFontSize * 0.5;
    const labelHeight = s.labelFontSize * 1.6;
    // Approximate label width — same heuristic as the overlay components.
    const labelWidth = s.label.length * s.labelFontSize * 0.6 + padding * 2;
    const x = midX - labelWidth / 2;
    const y = midY - labelHeight - s.markerRadius * 0.5;

    // Rounded rect
    const r = labelHeight / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.strokeStyle = s.color;
    ctx.lineWidth = Math.max(1, s.strokeWidth * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + labelWidth - r, y);
    ctx.arcTo(x + labelWidth, y, x + labelWidth, y + r, r);
    ctx.lineTo(x + labelWidth, y + labelHeight - r);
    ctx.arcTo(x + labelWidth, y + labelHeight, x + labelWidth - r, y + labelHeight, r);
    ctx.lineTo(x + r, y + labelHeight);
    ctx.arcTo(x, y + labelHeight, x, y + labelHeight - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = `${s.labelFontSize}px JetBrains Mono, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.label, midX, y + labelHeight / 2);
  }

  ctx.restore();
};

/* ---------- Rulers ---------- */

const drawRulers = (
  ctx: CanvasRenderingContext2D,
  cal: Calibration,
  imageWidth: number,
  imageHeight: number,
  opacity: number,
  thickness: number,
) => {
  if (cal.unit === 'px') return;
  const ppmm = cal.pixelsPerUnit / convertUnit(1, cal.unit, 'mm');
  if (ppmm <= 0) return;

  ctx.save();
  ctx.globalAlpha = opacity;
  const fontSize = thickness * 0.45;
  ctx.font = `${fontSize}px JetBrains Mono, monospace`;
  ctx.textBaseline = 'middle';

  // ---- TOP RULER (X axis) ----
  ctx.fillStyle = 'rgba(9,9,11,0.9)';
  ctx.fillRect(thickness, 0, imageWidth, thickness);
  ctx.strokeStyle = 'rgba(63,63,70,0.8)';
  ctx.lineWidth = 1;
  ctx.strokeRect(thickness + 0.5, 0.5, imageWidth - 1, thickness - 1);

  const xTicks = buildTicks(imageWidth, ppmm);
  for (const t of xTicks) {
    const x = thickness + t.mm * ppmm;
    const tickLen =
      t.kind === 'major'
        ? thickness * 0.6
        : t.kind === 'mid'
        ? thickness * 0.35
        : thickness * 0.2;
    ctx.strokeStyle = t.kind === 'major' ? '#e4e4e7' : '#71717a';
    ctx.lineWidth = t.kind === 'major' ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, thickness);
    ctx.lineTo(x, thickness - tickLen);
    ctx.stroke();
    if (t.kind === 'major' && t.mm > 0) {
      ctx.fillStyle = '#a1a1aa';
      ctx.textAlign = 'left';
      ctx.fillText(formatCmLabel(t.mm), x + thickness * 0.08, thickness * 0.5);
    }
  }

  // ---- LEFT RULER (Y axis) ----
  ctx.fillStyle = 'rgba(9,9,11,0.9)';
  ctx.fillRect(0, thickness, thickness, imageHeight);
  ctx.strokeStyle = 'rgba(63,63,70,0.8)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, thickness + 0.5, thickness - 1, imageHeight - 1);

  const yTicks = buildTicks(imageHeight, ppmm);
  for (const t of yTicks) {
    const y = thickness + t.mm * ppmm;
    const tickLen =
      t.kind === 'major'
        ? thickness * 0.6
        : t.kind === 'mid'
        ? thickness * 0.35
        : thickness * 0.2;
    ctx.strokeStyle = t.kind === 'major' ? '#e4e4e7' : '#71717a';
    ctx.lineWidth = t.kind === 'major' ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(thickness, y);
    ctx.lineTo(thickness - tickLen, y);
    ctx.stroke();
    if (t.kind === 'major' && t.mm > 0) {
      ctx.save();
      ctx.translate(thickness * 0.5, y + thickness * 0.08);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = '#a1a1aa';
      ctx.textAlign = 'center';
      ctx.fillText(formatCmLabel(t.mm), 0, 0);
      ctx.restore();
    }
  }

  // ---- CORNER PATCH ----
  ctx.fillStyle = 'rgba(9,9,11,0.95)';
  ctx.fillRect(0, 0, thickness, thickness);
  ctx.strokeStyle = 'rgba(63,63,70,0.8)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, thickness - 1, thickness - 1);
  ctx.fillStyle = '#a1a1aa';
  ctx.textAlign = 'center';
  ctx.fillText('cm', thickness / 2, thickness / 2);

  ctx.restore();
};

/* -------------------------------------------------------------------------- */
/* Tick generation (mirror of RulerOverlay)                                   */
/* -------------------------------------------------------------------------- */

interface Tick {
  mm: number;
  kind: 'major' | 'mid' | 'minor';
}

function buildTicks(imageLengthPx: number, ppmm: number): Tick[] {
  const totalMm = imageLengthPx / ppmm;
  let minorStep: number;
  let midStep: number;
  let majorStep: number;
  if (totalMm <= 200) {
    minorStep = 1; midStep = 5; majorStep = 10;
  } else if (totalMm <= 600) {
    minorStep = 2; midStep = 10; majorStep = 50;
  } else {
    minorStep = 10; midStep = 50; majorStep = 100;
  }
  const ticks: Tick[] = [];
  const maxMm = Math.floor(totalMm);
  for (let mm = 0; mm <= maxMm; mm += minorStep) {
    let kind: Tick['kind'] = 'minor';
    if (mm % majorStep === 0) kind = 'major';
    else if (mm % midStep === 0) kind = 'mid';
    ticks.push({ mm, kind });
  }
  return ticks;
}

function formatCmLabel(mm: number): string {
  const cm = mm / 10;
  return Number.isInteger(cm) ? `${cm}` : cm.toFixed(1);
}

/* -------------------------------------------------------------------------- */
/* Download helper                                                            */
/* -------------------------------------------------------------------------- */

export const downloadCanvasAsPng = (
  canvas: HTMLCanvasElement,
  filename: string,
) => {
  const link = document.createElement('a');
  link.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
};
