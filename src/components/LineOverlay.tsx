import React, { useCallback, useRef } from 'react';
import {
  CalibrationPoint,
  DrawnLine,
  LineMode,
} from '../types';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const eventToImagePoint = (
  e: React.PointerEvent<SVGSVGElement>,
  svg: SVGSVGElement | null,
  imageWidth: number,
  imageHeight: number,
): CalibrationPoint | null => {
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const x = ((e.clientX - rect.left) / rect.width) * imageWidth;
  const y = ((e.clientY - rect.top) / rect.height) * imageHeight;
  return { x, y };
};

/* -------------------------------------------------------------------------- */
/* Props                                                                      */
/* -------------------------------------------------------------------------- */

interface Props {
  imageWidth: number;
  imageHeight: number;
  /** Pre-filtered subset of lines to render (caller decides last-N). */
  lines: DrawnLine[];
  mode: LineMode;
  /** Provisional first-point being placed in continuous-draw mode. */
  draftA: CalibrationPoint | null;
  hoverPoint: CalibrationPoint | null;

  onCanvasClick: (point: CalibrationPoint) => void;
  onHover: (point: CalibrationPoint | null) => void;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * SVG overlay for free-form construction lines. Unlike measurement
 * markers, these are unlabelled and not draggable — they're meant to be
 * placed quickly and either kept or wiped via the panel.
 *
 * Pointer events follow the same coexistence pattern as the calibration
 * and measurement overlays: the SVG only swallows events while in
 * placement mode.
 */
export const LineOverlay: React.FC<Props> = ({
  imageWidth,
  imageHeight,
  lines,
  mode,
  draftA,
  hoverPoint,
  onCanvasClick,
  onHover,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const isPlacing = mode === 'placingA' || mode === 'placingB';

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!isPlacing) return;
      const pt = eventToImagePoint(e, svgRef.current, imageWidth, imageHeight);
      if (pt) onCanvasClick(pt);
    },
    [isPlacing, imageWidth, imageHeight, onCanvasClick],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!isPlacing) return;
      const pt = eventToImagePoint(e, svgRef.current, imageWidth, imageHeight);
      if (pt) onHover(pt);
    },
    [isPlacing, imageWidth, imageHeight, onHover],
  );

  const handlePointerLeave = useCallback(() => {
    if (isPlacing) onHover(null);
  }, [isPlacing, onHover]);

  // Stroke geometry scales with image size so lines stay visible at any
  // resolution; matches the conventions used by the other overlays.
  const strokeWidth = Math.max(1.5, Math.min(imageWidth, imageHeight) * 0.0025);
  const haloWidth = strokeWidth * 2.4;
  // Distinct hue from cyan (calibration) and amber (measurements).
  const COLOR = '#a78bfa'; // violet-400

  // Live rubber-band preview between the first click and the cursor.
  const draftFrom = mode === 'placingB' ? draftA : null;
  const draftTo = mode === 'placingB' ? hoverPoint : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="none"
      className="absolute inset-0 z-[57]"
      style={{
        pointerEvents: isPlacing ? 'auto' : 'none',
        cursor: isPlacing ? 'crosshair' : 'default',
        width: '100%',
        height: '100%',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {/* --------------- Saved lines --------------- */}
      {lines.map((l, idx) => {
        // Subtle fade for older lines so the most recent ones read first.
        const ageOpacity = lines.length <= 1
          ? 1
          : 0.35 + (0.65 * idx) / (lines.length - 1);
        return (
          <g key={l.id} opacity={ageOpacity}>
            <line
              x1={l.pointA.x}
              y1={l.pointA.y}
              x2={l.pointB.x}
              y2={l.pointB.y}
              stroke="#000"
              strokeOpacity={0.55}
              strokeWidth={haloWidth}
              strokeLinecap="round"
            />
            <line
              x1={l.pointA.x}
              y1={l.pointA.y}
              x2={l.pointB.x}
              y2={l.pointB.y}
              stroke={COLOR}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          </g>
        );
      })}

      {/* --------------- In-flight rubber band --------------- */}
      {draftFrom && draftTo && (
        <g>
          <line
            x1={draftFrom.x}
            y1={draftFrom.y}
            x2={draftTo.x}
            y2={draftTo.y}
            stroke="#000"
            strokeOpacity={0.55}
            strokeWidth={haloWidth}
            strokeLinecap="round"
          />
          <line
            x1={draftFrom.x}
            y1={draftFrom.y}
            x2={draftTo.x}
            y2={draftTo.y}
            stroke={COLOR}
            strokeWidth={strokeWidth}
            strokeDasharray={`${strokeWidth * 4} ${strokeWidth * 3}`}
            strokeLinecap="round"
          />
        </g>
      )}

      {/* Single dot for the lone first-point before the user moves. */}
      {mode === 'placingB' && draftA && !hoverPoint && (
        <circle
          cx={draftA.x}
          cy={draftA.y}
          r={Math.max(3, strokeWidth * 1.6)}
          fill={COLOR}
        />
      )}
    </svg>
  );
};
