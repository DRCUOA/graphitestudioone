import React, { useMemo } from 'react';
import { Calibration } from '../types';
import { convertUnit } from '../lib/calibration';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Thickness of the ruler bar in IMAGE-pixel units. Sized relative to the
 *  image so it stays visible at any image resolution; scales with zoom. */
const RULER_THICKNESS_FACTOR = 0.025;
/** Cap the absolute thickness so very large images don't get massive bars. */
const MAX_RULER_THICKNESS = 60;
/** Min thickness — small images shouldn't have hair-thin rulers. */
const MIN_RULER_THICKNESS = 18;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Image pixels per millimetre derived from the active calibration. */
const pxPerMm = (cal: Calibration): number =>
  cal.unit === 'px' ? 0 : cal.pixelsPerUnit / convertUnit(1, cal.unit, 'mm');

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

interface Props {
  imageWidth: number;
  imageHeight: number;
  /** Calibration must be present and use a metric/imperial real-world unit
   *  (not `px`) for the ruler to make sense. */
  calibration: Calibration | null;
  /** Show only when the user has explicitly locked the scale. */
  visible: boolean;
}

/**
 * Cm/mm rulers anchored to the X (top) and Y (left) edges of the reference
 * image. Tick marks are drawn in image-pixel space so they line up exactly
 * with image features at every zoom level.
 *
 *  - Major ticks every 1 cm (with numeric label).
 *  - Mid  ticks every 5 mm.
 *  - Minor ticks every 1 mm.
 *
 * Pointer-events are disabled — these are purely visual.
 */
export const RulerOverlay: React.FC<Props> = ({
  imageWidth,
  imageHeight,
  calibration,
  visible,
}) => {
  // Bail out of rendering if we don't have a real-world unit to work with.
  const ppmm = calibration ? pxPerMm(calibration) : 0;
  const ready = visible && !!calibration && ppmm > 0;

  // Sized in image-pixel space; both rulers use the same thickness so they
  // join cleanly at the corner.
  const thickness = Math.min(
    MAX_RULER_THICKNESS,
    Math.max(MIN_RULER_THICKNESS, Math.min(imageWidth, imageHeight) * RULER_THICKNESS_FACTOR),
  );

  /* ------------------------------------------------------------------ */
  /* Tick generation                                                    */
  /* ------------------------------------------------------------------ */
  const xTicks = useMemo(
    () => (ready ? buildTicks(imageWidth, ppmm) : []),
    [ready, imageWidth, ppmm],
  );
  const yTicks = useMemo(
    () => (ready ? buildTicks(imageHeight, ppmm) : []),
    [ready, imageHeight, ppmm],
  );

  if (!ready || !calibration) return null;

  // Font/stroke sized in image-pixel units. Scale gracefully with thickness
  // so labels read clearly at any image resolution.
  const labelFontSize = thickness * 0.45;
  const strokeWidthMajor = Math.max(1, thickness * 0.05);
  const strokeWidthMinor = Math.max(0.5, thickness * 0.025);

  return (
    <>
      {/* ----- TOP RULER (X axis) ------------------------------------ */}
      <svg
        className="absolute pointer-events-none z-[55]"
        style={{
          // Position above the image. Negative top in image-pixel units
          // because the parent <motion.div> applies CSS-scale=zoom and the
          // canvases below use the same image-pixel coordinate space.
          top: -thickness,
          left: 0,
          width: imageWidth,
          height: thickness,
        }}
        viewBox={`0 0 ${imageWidth} ${thickness}`}
        preserveAspectRatio="none"
      >
        <rect
          x={0}
          y={0}
          width={imageWidth}
          height={thickness}
          fill="rgba(9,9,11,0.9)"
          stroke="rgba(63,63,70,0.8)"
          strokeWidth={strokeWidthMinor}
        />
        {xTicks.map((t, i) => {
          const x = t.mm * ppmm;
          const tickHeight =
            t.kind === 'major' ? thickness * 0.6 : t.kind === 'mid' ? thickness * 0.35 : thickness * 0.2;
          return (
            <g key={i}>
              <line
                x1={x}
                y1={thickness}
                x2={x}
                y2={thickness - tickHeight}
                stroke={t.kind === 'major' ? '#e4e4e7' : '#71717a'}
                strokeWidth={t.kind === 'major' ? strokeWidthMajor : strokeWidthMinor}
              />
              {t.kind === 'major' && t.mm > 0 && (
                <text
                  x={x + thickness * 0.08}
                  y={thickness * 0.5}
                  fill="#a1a1aa"
                  fontSize={labelFontSize}
                  fontFamily="JetBrains Mono, monospace"
                  dominantBaseline="central"
                >
                  {formatCmLabel(t.mm)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* ----- LEFT RULER (Y axis) ----------------------------------- */}
      <svg
        className="absolute pointer-events-none z-[55]"
        style={{
          top: 0,
          left: -thickness,
          width: thickness,
          height: imageHeight,
        }}
        viewBox={`0 0 ${thickness} ${imageHeight}`}
        preserveAspectRatio="none"
      >
        <rect
          x={0}
          y={0}
          width={thickness}
          height={imageHeight}
          fill="rgba(9,9,11,0.9)"
          stroke="rgba(63,63,70,0.8)"
          strokeWidth={strokeWidthMinor}
        />
        {yTicks.map((t, i) => {
          const y = t.mm * ppmm;
          const tickWidth =
            t.kind === 'major' ? thickness * 0.6 : t.kind === 'mid' ? thickness * 0.35 : thickness * 0.2;
          return (
            <g key={i}>
              <line
                x1={thickness}
                y1={y}
                x2={thickness - tickWidth}
                y2={y}
                stroke={t.kind === 'major' ? '#e4e4e7' : '#71717a'}
                strokeWidth={t.kind === 'major' ? strokeWidthMajor : strokeWidthMinor}
              />
              {t.kind === 'major' && t.mm > 0 && (
                <text
                  x={thickness * 0.5}
                  y={y + thickness * 0.08}
                  fill="#a1a1aa"
                  fontSize={labelFontSize}
                  fontFamily="JetBrains Mono, monospace"
                  textAnchor="middle"
                  // Rotate -90° around the label position so cm numbers run
                  // top-to-bottom along the vertical ruler.
                  transform={`rotate(-90 ${thickness * 0.5} ${y + thickness * 0.08})`}
                  dominantBaseline="central"
                >
                  {formatCmLabel(t.mm)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* ----- CORNER PATCH ------------------------------------------ */}
      {/* Joins the two rulers visually at the (0,0) corner with a small
          "0" label so the user knows where measurements originate. */}
      <div
        className="absolute z-[56] pointer-events-none flex items-center justify-center font-mono"
        style={{
          top: -thickness,
          left: -thickness,
          width: thickness,
          height: thickness,
          background: 'rgba(9,9,11,0.95)',
          border: '1px solid rgba(63,63,70,0.8)',
          color: '#a1a1aa',
          fontSize: labelFontSize,
        }}
      >
        cm
      </div>
    </>
  );
};

/* -------------------------------------------------------------------------- */
/* Tick generator                                                             */
/* -------------------------------------------------------------------------- */

interface Tick {
  mm: number;
  kind: 'major' | 'mid' | 'minor';
}

/**
 * Build the list of tick marks for a single ruler. Adapts density to the
 * total length so very large images (e.g. A0 ≈ 1189 mm) don't render 1000+
 * minor ticks that aren't visually distinguishable anyway.
 */
function buildTicks(imageLengthPx: number, ppmm: number): Tick[] {
  const totalMm = imageLengthPx / ppmm;

  // Density LOD: pick the smallest "minor" tick step that keeps total tick
  // count manageable. For very long rulers we drop sub-cm ticks entirely.
  let minorStep: number; // in mm
  let midStep: number;
  let majorStep: number;
  if (totalMm <= 200) {
    minorStep = 1; midStep = 5; majorStep = 10; // typical A4-ish range
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

/** Render a millimetre value in centimetres for the major-tick label. */
function formatCmLabel(mm: number): string {
  const cm = mm / 10;
  // Whole numbers when possible — cleaner than "1.0", "2.0", etc.
  return Number.isInteger(cm) ? `${cm}` : cm.toFixed(1);
}
