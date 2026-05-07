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
  /**
   * Active pencil-grade highlights. Each grade tags the luminance bin
   * mapped to that pencil's hardness; pixels falling in *any* selected
   * bin are tinted, the rest dimmed. The set is cumulative — clicking
   * a grade toggles it in/out, the OFF button clears the entire set.
   *
   * Empty array = no highlight (formerly modelled as `'NONE'`).
   */
  highlightGrades: PencilGrade[];
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

/* -------------------------------------------------------------------------- */
/* Free-line Shapes (freehand pointer-drag sketches)                          */
/* -------------------------------------------------------------------------- */

/**
 * A single freehand stroke. Stored as an ordered list of points sampled
 * during the user's drag. Points are in image-pixel space so they zoom
 * cleanly with the rest of the overlay layers.
 *
 * `points` must contain at least two entries by the time the stroke is
 * committed — single-point "taps" are discarded by the overlay.
 */
export interface FreeLine {
  id: string;
  points: CalibrationPoint[];
  /**
   * Per-sample pressure values in [0, 1], parallel to `points` (always the
   * same length). Drives the variable-width fill on render — higher values
   * mean wider/darker, mimicking how a softer pencil deposits more graphite
   * with firmer pressure.
   *
   * Captured from `PointerEvent.pressure` on tablets/styluses. For mouse
   * and touch (which don't report meaningful pressure) we synthesise a
   * pressure curve from pointer velocity: slower = harder press, the same
   * physical relationship that holds on paper.
   */
  pressures: number[];
  /** Stroke-width multiplier baked-in at draw time (1 = panel default). */
  widthScale: number;
  /** Hex colour the stroke was drawn with. */
  color: string;
  createdAt: number;
}

export interface FreeLineState {
  strokes: FreeLine[];
  /** Master visibility toggle. */
  visible: boolean;
  /** Render only the most-recent N strokes (full history is retained). */
  showLastN: number;
  /** Default stroke width (image-pixel units, scaled into screen-px on render). */
  strokeWidth: number;
  /** Default stroke colour for new strokes. */
  color: string;
  /**
   * When true, modulate stroke width/opacity by per-sample pressure (real
   * for pen pointers, velocity-simulated for mouse/touch). When false,
   * every sample is treated as a constant 0.5 pressure for a flat line.
   */
  pressureEnabled: boolean;
  /**
   * Eraser brush radius in image-pixel units. Strokes whose geometry
   * passes within this distance of the eraser cursor are removed.
   */
  eraserSize: number;
}

/**
 * Free-line tool has three exclusive modes:
 *  - `idle`    : pointer events ignored
 *  - `drawing` : sampling points + pressure into an in-flight stroke
 *  - `erasing` : dragging the eraser brush — strokes the cursor crosses
 *                are removed live
 */
export type FreeLineMode = 'idle' | 'drawing' | 'erasing';

/* -------------------------------------------------------------------------- */
/* Trace Assist (edge-snap drawing aid)                                       */
/* -------------------------------------------------------------------------- */

/**
 * Per-project preferences for the edge-snap tracing aid. The detected
 * edge map itself is recomputed from the source image on demand and
 * therefore lives in transient app state — only these settings persist
 * with the project.
 */
export interface TraceAssist {
  /** Master switch — when false, snapping is suppressed everywhere. */
  enabled: boolean;
  /**
   * Snap aggressiveness multiplier in [0.25, 2.5]. Larger values widen
   * the search radius and lower the gradient threshold so the cursor
   * snaps to weaker edges from further away.
   */
  sensitivity: number;
  /** Render the detected edges as a faint white overlay on the image. */
  showEdges: boolean;
}

/* -------------------------------------------------------------------------- */
/* Projects — application persistence layer                                   */
/* -------------------------------------------------------------------------- */

/**
 * The complete, serialisable working state of a single drawing project.
 *
 * This is the on-disk shape that gets round-tripped through both the
 * in-tab session-storage autosave AND the IndexedDB persistence layer.
 *
 * NB: image fields are kept as data URLs (strings) rather than Blobs so
 * the same payload can be persisted to either backing store without
 * conversion. Blob storage would be more compact but would also require
 * a more elaborate marshalling layer for sessionStorage.
 */
export interface ProjectData {
  /** Current (post-crop) reference image, base64 data URL. */
  image: string | null;
  /** Pre-crop reference. Kept so "Reset crop" still works after reload. */
  originalImage: string | null;
  /** Optional drawing-in-progress overlay photo. */
  overlayImage: string | null;

  layers: LayerConfig[];
  grid: GridConfig;
  assistant: AssistantSettings;
  spotlight: SpotlightConfig;
  overlayFit: OverlayFit;

  calibration: CalibrationState;
  measurement: MeasurementState;
  lineState: LineState;
  freeLineState: FreeLineState;
  traceAssist: TraceAssist;
}

/**
 * Lightweight metadata used by the project picker UI. Excludes the heavy
 * `data` field so the picker can render quickly even with many projects.
 */
export interface ProjectMeta {
  id: string;
  name: string;
  /** Epoch ms — first time the project was created. */
  createdAt: number;
  /** Epoch ms — last time any field was persisted to IDB. */
  updatedAt: number;
  /** Small JPEG data URL (≤ ~256px on the long edge) for the picker tile. */
  thumbnail: string | null;
}

/** A full Project record: metadata + the heavy ProjectData payload. */
export interface Project extends ProjectMeta {
  data: ProjectData;
}

/**
 * Shape of the in-tab session-storage autosave entry. The `projectId`
 * pins the draft to a specific persisted project so we don't accidentally
 * overwrite a different project on flush.
 */
export interface SessionDraft {
  projectId: string;
  projectName: string;
  data: ProjectData;
  /** Epoch ms — last write. Used to detect stale drafts on restore. */
  updatedAt: number;
}
