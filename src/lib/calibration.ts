import {
  Calibration,
  CalibrationPoint,
  CalibrationState,
  CalibrationUnit,
} from '../types';

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Euclidean distance between two image-space points (sub-pixel precision). */
export const distance = (a: CalibrationPoint, b: CalibrationPoint): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

/** Conversion factor from a real-world unit into millimetres. */
const MM_PER_UNIT: Record<CalibrationUnit, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
  // `px` is dimensionless — we never convert it through mm. See
  // `convertUnit` for the special-case path.
  px: 0,
};

/** Display label for each unit — used in the UI badges. */
export const UNIT_LABEL: Record<CalibrationUnit, string> = {
  mm: 'mm',
  cm: 'cm',
  in: 'in',
  px: 'px',
};

/** Long-form name used in the unit dropdown. */
export const UNIT_FULL_NAME: Record<CalibrationUnit, string> = {
  mm: 'Millimetres',
  cm: 'Centimetres',
  in: 'Inches',
  px: 'Pixels',
};

/**
 * Convert a value between real-world units. Pixel-mode is dimensionless and
 * therefore non-convertible — callers should detect it and fall back.
 */
export const convertUnit = (
  value: number,
  from: CalibrationUnit,
  to: CalibrationUnit,
): number => {
  if (from === to) return value;
  if (from === 'px' || to === 'px') return value;
  return (value * MM_PER_UNIT[from]) / MM_PER_UNIT[to];
};

/**
 * Compute the canonical `pixelsPerUnit` value from the two anchor points and
 * the user-entered real distance. Falls back to 1 if the line has zero length
 * to avoid divide-by-zero when both points coincide.
 */
export const computePixelsPerUnit = (
  pointA: CalibrationPoint,
  pointB: CalibrationPoint,
  realDistance: number,
): number => {
  const px = distance(pointA, pointB);
  if (realDistance <= 0 || px <= 0) return 1;
  return px / realDistance;
};

/**
 * Build a fully-formed Calibration record from raw user input. ID + timestamp
 * are generated here so callers don't have to remember.
 */
export const createCalibration = (input: {
  name: string;
  pointA: CalibrationPoint;
  pointB: CalibrationPoint;
  realDistance: number;
  unit: CalibrationUnit;
}): Calibration => ({
  id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `cal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  name: input.name.trim() || 'Untitled calibration',
  pointA: { ...input.pointA },
  pointB: { ...input.pointB },
  realDistance: input.realDistance,
  unit: input.unit,
  pixelsPerUnit: computePixelsPerUnit(
    input.pointA,
    input.pointB,
    input.realDistance,
  ),
  createdAt: Date.now(),
});

/** Convenience accessor used throughout the UI. */
export const getActiveCalibration = (
  state: CalibrationState,
): Calibration | null =>
  state.calibrations.find((c) => c.id === state.activeId) ?? null;

/* -------------------------------------------------------------------------- */
/* Conversions / formatting                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Convert a length in image pixels into the active calibration's real-world
 * unit. Returns the raw pixel count if no calibration is active so callers
 * can keep rendering something meaningful.
 */
export const pxToUnits = (
  pixels: number,
  cal: Calibration | null,
): { value: number; unit: CalibrationUnit } => {
  if (!cal || cal.pixelsPerUnit <= 0) return { value: pixels, unit: 'px' };
  return { value: pixels / cal.pixelsPerUnit, unit: cal.unit };
};

/** Reverse of {@link pxToUnits} — used by tools that want N units in pixels. */
export const unitsToPx = (
  value: number,
  unit: CalibrationUnit,
  cal: Calibration | null,
): number => {
  if (!cal || cal.pixelsPerUnit <= 0) return value;
  // Convert into the calibration's native unit first, then multiply.
  const converted = unit === 'px' ? value : convertUnit(value, unit, cal.unit);
  return converted * cal.pixelsPerUnit;
};

/**
 * Pretty-print a measurement. Uses 2 decimals for cm/in, 1 for mm, 0 for px.
 * Intentionally locale-independent so values look the same in every region.
 */
export const formatMeasurement = (
  value: number,
  unit: CalibrationUnit,
): string => {
  const decimals = unit === 'cm' || unit === 'in' ? 2 : unit === 'mm' ? 1 : 0;
  return `${value.toFixed(decimals)} ${UNIT_LABEL[unit]}`;
};

/** Format the scale ratio shown in the status badge: e.g. "1 cm = 42.3 px". */
export const formatScaleRatio = (cal: Calibration): string =>
  `1 ${UNIT_LABEL[cal.unit]} = ${cal.pixelsPerUnit.toFixed(1)} px`;

/* -------------------------------------------------------------------------- */
/* Paper-size presets (ISO 216 A-series)                                      */
/* -------------------------------------------------------------------------- */

/** Identifiers for the supported A-series sizes. */
export type PaperSizeKey =
  | 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8';

/** A single ISO 216 paper definition. Dimensions are stored in millimetres
 *  (the SI base for paper) and converted on demand for other units. */
export interface PaperSize {
  key: PaperSizeKey;
  label: string;
  /** Short edge length in mm. */
  shortMm: number;
  /** Long edge length in mm. */
  longMm: number;
}

/**
 * ISO 216 A-series sheet sizes. Values are the standard short × long
 * dimensions in millimetres. Used by the "Calibrate from paper preset"
 * workflow which assumes the reference image fills the entire sheet.
 */
export const PAPER_SIZES: Record<PaperSizeKey, PaperSize> = {
  A0: { key: 'A0', label: 'A0', shortMm: 841, longMm: 1189 },
  A1: { key: 'A1', label: 'A1', shortMm: 594, longMm: 841 },
  A2: { key: 'A2', label: 'A2', shortMm: 420, longMm: 594 },
  A3: { key: 'A3', label: 'A3', shortMm: 297, longMm: 420 },
  A4: { key: 'A4', label: 'A4', shortMm: 210, longMm: 297 },
  A5: { key: 'A5', label: 'A5', shortMm: 148, longMm: 210 },
  A6: { key: 'A6', label: 'A6', shortMm: 105, longMm: 148 },
  A7: { key: 'A7', label: 'A7', shortMm: 74, longMm: 105 },
  A8: { key: 'A8', label: 'A8', shortMm: 52, longMm: 74 },
};

/** Iteration-friendly list, preserving the canonical A0 → A8 order. */
export const PAPER_SIZE_LIST: PaperSize[] = (
  ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'] as PaperSizeKey[]
).map((k) => PAPER_SIZES[k]);

/** Units that make sense for physical paper. `px` is excluded because paper
 *  has no native pixel dimension. */
export const PAPER_PRESET_UNITS: CalibrationUnit[] = ['mm', 'cm', 'in'];

/**
 * Build a Calibration record from a paper preset, treating the entire
 * reference image as that physical sheet. Orientation is auto-detected
 * from the image aspect ratio so a landscape photo uses the paper's long
 * edge horizontally and a portrait photo uses it vertically.
 *
 * The calibration line is laid along the image's LONG edge — this gives
 * the highest pixel-distance / real-distance ratio and therefore the
 * lowest rounding error in downstream measurements.
 */
export const createCalibrationFromPaperPreset = (input: {
  paper: PaperSize;
  imageWidth: number;
  imageHeight: number;
  /** Storage unit for the calibration. Must be a real-world unit. */
  unit?: CalibrationUnit;
}): Calibration => {
  const unit: CalibrationUnit = input.unit && input.unit !== 'px' ? input.unit : 'mm';
  const isLandscape = input.imageWidth >= input.imageHeight;

  // Image's long edge corresponds to the paper's long edge.
  const realDistanceMm = input.paper.longMm;
  const realDistance = convertUnit(realDistanceMm, 'mm', unit);

  // The two anchor points: corner → opposite corner along the long edge.
  const pointA: CalibrationPoint = { x: 0, y: 0 };
  const pointB: CalibrationPoint = isLandscape
    ? { x: input.imageWidth, y: 0 }
    : { x: 0, y: input.imageHeight };

  // Display name like "A4 Portrait (210 × 297 mm)" so users can tell the
  // saved calibrations apart at a glance.
  const widthMm = isLandscape ? input.paper.longMm : input.paper.shortMm;
  const heightMm = isLandscape ? input.paper.shortMm : input.paper.longMm;
  const orientation = isLandscape ? 'Landscape' : 'Portrait';
  const name = `${input.paper.label} ${orientation} (${widthMm} × ${heightMm} mm)`;

  return createCalibration({
    name,
    pointA,
    pointB,
    realDistance,
    unit,
  });
};

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = 'graphite-project-calibration-v1';

/** Initial empty calibration state for new projects. */
export const emptyCalibrationState = (): CalibrationState => ({
  calibrations: [],
  activeId: null,
  locked: false,
  visible: true,
});

export const loadCalibrationState = (): CalibrationState => {
  if (typeof window === 'undefined') return emptyCalibrationState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyCalibrationState();
    const parsed = JSON.parse(raw) as Partial<CalibrationState>;
    return {
      calibrations: Array.isArray(parsed.calibrations) ? parsed.calibrations : [],
      activeId: parsed.activeId ?? null,
      locked: Boolean(parsed.locked),
      visible: parsed.visible ?? true,
    };
  } catch {
    // Corrupt JSON / unavailable storage — start fresh rather than crash.
    return emptyCalibrationState();
  }
};

export const saveCalibrationState = (state: CalibrationState): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort; quota errors should not interrupt the drawing session.
  }
};
