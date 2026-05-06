export type PencilGrade = '9B' | '8B' | '7B' | '6B' | '5B' | '4B' | '3B' | '2B' | 'B' | 'HB' | 'F' | 'H' | '2H' | '3H' | '4H' | '5H' | '6H' | '7H' | '8H' | '9H';

/** Stroke style for grid overlay lines. */
export type GridLineStyle = 'solid' | 'dashed';

export interface GridConfig {
  enabled: boolean;
  rows: number;
  cols: number;
  color: string;
  opacity: number;
  thickness: number;
  /** Whether grid lines render as continuous strokes or repeating dashes. */
  lineStyle: GridLineStyle;
}

export interface AssistantSettings {
  grayscale: boolean;
  posterize: boolean;
  posterizeLevels: number;
  highlightGrade: PencilGrade | 'NONE';
  contrast: number;
  brightness: number;
  edges: boolean;
  invert: boolean;
  notan: boolean;
  notanThreshold: number;
}

export type LayerId = 'reference' | 'analysis' | 'grid' | 'camera' | 'overlay';

export type OverlayFit = 'contain' | 'cover' | 'fill';

export interface LayerConfig {
  id: LayerId;
  name: string;
  visible: boolean;
  opacity: number;
}

export interface SpotlightConfig {
  enabled: boolean;
  size: number;
  zoom: number;
  x: number;
  y: number;
}

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* -------------------------------------------------------------------------- */
/* Scale Calibration                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Real-world units the user can calibrate against.
 * `px` is a fallback identity unit (1 unit = 1 image pixel) used when no
 * physical reference is available.
 */
export type CalibrationUnit = 'mm' | 'cm' | 'in' | 'px';

/**
 * A single calibration point in IMAGE-PIXEL coordinates.
 * Coordinates are kept as floats to preserve sub-pixel precision regardless
 * of current zoom level.
 */
export interface CalibrationPoint {
  x: number;
  y: number;
}

/**
 * One named calibration: the two anchor points the user clicked plus the
 * real-world distance/unit they entered. `pixelsPerUnit` is the derived
 * multiplier all rulers/grids/measurement tools should use.
 */
export interface Calibration {
  id: string;
  name: string;
  pointA: CalibrationPoint;
  pointB: CalibrationPoint;
  /** Real-world distance the user entered between A and B. */
  realDistance: number;
  unit: CalibrationUnit;
  /** Image pixels per one `unit`. Cached from the points + distance. */
  pixelsPerUnit: number;
  /** Epoch ms; used purely for sort order in the calibration list. */
  createdAt: number;
}

/**
 * Project-level scale state. Stored on the project so calibrations persist
 * across sessions alongside the loaded reference image.
 */
export interface CalibrationState {
  calibrations: Calibration[];
  activeId: string | null;
  /** When true, new calibrations cannot be added and existing ones cannot
   *  be moved. Useful once the user is happy with the chosen scale. */
  locked: boolean;
  /** Toggle the on-canvas overlay (markers + scale line) without losing
   *  the calibration data itself. */
  visible: boolean;
}

/**
 * Tracks where the user is in the multi-click calibration flow.
 *  - `idle`     : not calibrating
 *  - `placingA` : waiting for the first click
 *  - `placingB` : first point placed, waiting for the second
 *  - `awaitingDistance` : both points placed, modal asking for real distance
 */
export type CalibrationMode = 'idle' | 'placingA' | 'placingB' | 'awaitingDistance';

/* -------------------------------------------------------------------------- */
/* Custom Measurements                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A user-defined named distance between two points on the reference image
 * (e.g. "Left pupil → right nipple"). Real-world distance is derived from
 * the active calibration so changing the calibration updates all
 * measurements automatically.
 */
export interface Measurement {
  id: string;
  name: string;
  pointA: CalibrationPoint;
  pointB: CalibrationPoint;
  /** Per-marker visibility toggle. */
  visible: boolean;
  createdAt: number;
}

export interface MeasurementState {
  measurements: Measurement[];
  /** Master toggle — hides every marker without losing data. */
  showAll: boolean;
}

/**
 * Placement state for a new measurement marker. Mirrors `CalibrationMode`.
 */
export type MeasurementMode = 'idle' | 'placingA' | 'placingB' | 'awaitingName';

/* -------------------------------------------------------------------------- */
/* Line Shapes (free-form construction lines)                                 */
/* -------------------------------------------------------------------------- */

/**
 * A bare line segment drawn by the user purely for construction/sketch
 * guidance. Carries no name, no distance, no labels — just two anchor
 * points in image-pixel space.
 */
export interface DrawnLine {
  id: string;
  pointA: CalibrationPoint;
  pointB: CalibrationPoint;
  createdAt: number;
}

export interface LineState {
  lines: DrawnLine[];
  /** Master visibility toggle ("line-shape" toggle). */
  visible: boolean;
  /** Cap on how many of the most recent lines to render. The full history
   *  is always kept on disk; this just affects display. Min 1. */
  showLastN: number;
}

/**
 * Line drawing is continuous: once both points are placed the line is
 * committed and we drop straight back to `placingA` for the next stroke.
 * Esc / clicking "Stop" returns to `idle`.
 */
export type LineMode = 'idle' | 'placingA' | 'placingB';
