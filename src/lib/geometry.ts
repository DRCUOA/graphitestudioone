/* -------------------------------------------------------------------------- */
/* Line geometry — derived metrics shared by every "draw a line" tool.        */
/*                                                                            */
/* Returns the four numbers a user cares about while placing the second       */
/* point of a line: total length, angle, and the horizontal / vertical        */
/* components. All values are converted through the active calibration so     */
/* downstream UI can render real-world units uniformly.                       */
/* -------------------------------------------------------------------------- */

import type { Calibration, CalibrationPoint, CalibrationUnit } from '../types';
import { formatMeasurement } from './calibration';

export interface LineMetrics {
  /** Raw pixel-space length — kept around for callers that need it. */
  pixelLength: number;
  /** Length in `unit`. Equals `pixelLength` when uncalibrated. */
  length: number;
  /** Calibration unit (or 'px' if no calibration is active). */
  unit: CalibrationUnit;
  /**
   * Signed horizontal delta in `unit`. Positive means rightward
   * (canvas → in image-pixel space, where x grows to the right).
   */
  dx: number;
  /**
   * Signed vertical delta in `unit`. POSITIVE means UPWARD on screen
   * (math convention — the image's pixel-space y is flipped here so the
   * value matches what the user perceives visually).
   */
  dy: number;
  /**
   * Angle of the line measured CCW from the +x axis, in degrees, in the
   * range (-180, 180]. 0° = horizontal-right, 90° = straight up,
   * −90° = straight down. Matches the convention used by most
   * design tools (Illustrator, Figma's "rotate" widget, etc.).
   */
  angleDeg: number;
  /** Convenience flag for callers that want to badge "no scale set". */
  calibrated: boolean;
}

/**
 * Compute geometry of a line between two image-pixel points, expressed
 * in the active calibration's unit. Pure function — safe for use in
 * render paths.
 */
export const computeLineMetrics = (
  from: CalibrationPoint,
  to: CalibrationPoint,
  cal: Calibration | null,
): LineMetrics => {
  const dxPx = to.x - from.x;
  // image-pixel space: y grows downward
  const dyPx = to.y - from.y;
  const pixelLength = Math.sqrt(dxPx * dxPx + dyPx * dyPx);

  // Negate dy so the resulting angle reads in math/visual convention
  // rather than image-pixel convention. This way a user dragging
  // up-and-to-the-right sees a positive angle, matching their intuition.
  const angleRad = Math.atan2(-dyPx, dxPx);
  const angleDeg = (angleRad * 180) / Math.PI;

  if (cal && cal.pixelsPerUnit > 0) {
    const k = cal.pixelsPerUnit;
    return {
      pixelLength,
      length: pixelLength / k,
      unit: cal.unit,
      dx: dxPx / k,
      // Flip into math/visual convention to match `angleDeg` above.
      dy: -dyPx / k,
      angleDeg,
      calibrated: true,
    };
  }
  return {
    pixelLength,
    length: pixelLength,
    unit: 'px',
    dx: dxPx,
    dy: -dyPx,
    angleDeg,
    calibrated: false,
  };
};

/* -------------------------------------------------------------------------- */
/* Display formatting                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Format a single calibrated value for the metrics HUD. Always positive —
 * direction is conveyed by the arrow icon next to the value, not the sign.
 */
const fmtMagnitude = (value: number, unit: CalibrationUnit): string => {
  const abs = Math.abs(value);
  if (unit === 'px') return `${abs.toFixed(0)} px`;
  return formatMeasurement(abs, unit);
};

/**
 * Strings ready to drop into a rendering layer. Direction is encoded as
 * a Unicode arrow prefixed onto the dx / dy strings so the user can read
 * "where the line is heading" at a glance without parsing a sign.
 */
export interface FormattedLineMetrics {
  /** Total length, e.g. "5.20 cm" or "63 px". */
  length: string;
  /** Signed angle, e.g. "32.0°" / "−147.5°". */
  angle: string;
  /** Horizontal component prefixed by → (right) or ← (left). */
  dx: string;
  /** Vertical component prefixed by ↑ (up) or ↓ (down). */
  dy: string;
}

export const formatLineMetrics = (m: LineMetrics): FormattedLineMetrics => {
  // U+2212 MINUS SIGN reads cleaner than a hyphen in numeric labels.
  const angleStr = m.angleDeg < 0
    ? `−${Math.abs(m.angleDeg).toFixed(1)}°`
    : `${m.angleDeg.toFixed(1)}°`;

  const dxArrow = m.dx >= 0 ? '→' : '←';
  const dyArrow = m.dy >= 0 ? '↑' : '↓';

  return {
    length: fmtMagnitude(m.length, m.unit),
    angle: angleStr,
    dx: `${dxArrow} ${fmtMagnitude(m.dx, m.unit)}`,
    dy: `${dyArrow} ${fmtMagnitude(m.dy, m.unit)}`,
  };
};
