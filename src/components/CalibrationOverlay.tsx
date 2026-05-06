import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Calibration,
  CalibrationMode,
  CalibrationPoint,
  CalibrationUnit,
} from '../types';
import {
  distance,
  formatMeasurement,
  pxToUnits,
} from '../lib/calibration';

/* -------------------------------------------------------------------------- */
/* Sub-pixel coordinate helpers                                               */
/* -------------------------------------------------------------------------- */

/**
 * Convert a pointer event to image-space coordinates with sub-pixel
 * precision. The overlay SVG is sized to fit the image element via CSS, so
 * we map clientX/Y back through the SVG's bounding rect.
 */
const eventToImagePoint = (
  e: React.PointerEvent<SVGSVGElement> | React.PointerEvent<SVGCircleElement>,
  svg: SVGSVGElement | null,
  imageWidth: number,
  imageHeight: number,
): CalibrationPoint | null => {
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  // clientX/Y are floats on most browsers; preserve them for sub-pixel.
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
  mode: CalibrationMode;
  /** Active stored calibration, drawn so the user can see/move the line. */
  activeCalibration: Calibration | null;
  /** Whether to render the active calibration's line + markers. */
  showActive: boolean;
  /** When true, markers are not draggable. */
  locked: boolean;
  /** Provisional points being placed during the wizard flow. */
  draftA: CalibrationPoint | null;
  draftB: CalibrationPoint | null;
  /** Live cursor position while in a placing state — used to draw a rubber
   *  band line from `draftA` to wherever the cursor is now. */
  hoverPoint: CalibrationPoint | null;

  onCanvasClick: (point: CalibrationPoint) => void;
  onHover: (point: CalibrationPoint | null) => void;
  /** Drag of an existing calibration's A or B endpoint. */
  onActivePointDrag: (which: 'A' | 'B', point: CalibrationPoint) => void;
  /** End of drag — used to commit the change to undo history. */
  onActivePointDragEnd: () => void;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * SVG overlay sitting on top of the reference canvas. It both:
 *  1. Captures pointer clicks while in calibration placement mode.
 *  2. Renders the visual artefacts (markers, dashed line, distance label)
 *     for the in-progress draft AND the saved active calibration.
 *
 * The SVG uses a `viewBox` matching the reference image's intrinsic pixel
 * size so all geometry below is expressed in image coordinates and stays
 * accurate at any zoom level.
 */
export const CalibrationOverlay: React.FC<Props> = ({
  imageWidth,
  imageHeight,
  mode,
  activeCalibration,
  showActive,
  locked,
  draftA,
  draftB,
  hoverPoint,
  onCanvasClick,
  onHover,
  onActivePointDrag,
  onActivePointDragEnd,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingActive, setDraggingActive] = useState<'A' | 'B' | null>(null);
  const isPlacing = mode === 'placingA' || mode === 'placingB';

  /* ------------------------------------------------------------------ */
  /* Pointer handlers — placement clicks                                */
  /* ------------------------------------------------------------------ */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!isPlacing) return;
      // Don't hijack clicks meant for an existing marker handle.
      if ((e.target as Element).getAttribute('data-handle')) return;
      const pt = eventToImagePoint(e, svgRef.current, imageWidth, imageHeight);
      if (pt) onCanvasClick(pt);
    },
    [isPlacing, imageWidth, imageHeight, onCanvasClick],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!isPlacing) return;
      const pt = eventToImagePoint(e, svgRef.current, imageWidth, imageHeight);
      if (!pt) return;
      onHover(pt);
    },
    [isPlacing, imageWidth, imageHeight, onHover],
  );

  const handlePointerLeave = useCallback(() => {
    if (isPlacing) onHover(null);
  }, [isPlacing, onHover]);

  /* ------------------------------------------------------------------ */
  /* Active marker dragging                                             */
  /* ------------------------------------------------------------------ */
  // Drag tracking goes through window-level handlers so we keep working
  // even when the SVG itself has pointer-events: none (its default state
  // when not in placement mode — see comment on the <svg> element below).
  useEffect(() => {
    if (!draggingActive) return;
    const onMove = (e: PointerEvent) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = ((e.clientX - rect.left) / rect.width) * imageWidth;
      const y = ((e.clientY - rect.top) / rect.height) * imageHeight;
      onActivePointDrag(draggingActive, { x, y });
    };
    const onUp = () => {
      setDraggingActive(null);
      onActivePointDragEnd();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [
    draggingActive,
    imageWidth,
    imageHeight,
    onActivePointDrag,
    onActivePointDragEnd,
  ]);

  const startMarkerDrag = (
    which: 'A' | 'B',
    e: React.PointerEvent<SVGCircleElement>,
  ) => {
    if (locked || isPlacing) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDraggingActive(which);
  };

  /* ------------------------------------------------------------------ */
  /* Geometry derived for rendering                                     */
  /* ------------------------------------------------------------------ */
  // Marker radius / line widths are expressed in IMAGE-pixel units (because
  // the SVG viewBox is in image units). We scale them so they remain a
  // visually consistent size regardless of how big the source image is.
  const markerRadius = Math.max(6, Math.min(imageWidth, imageHeight) * 0.012);
  const strokeWidth = Math.max(1, markerRadius * 0.18);
  const labelFontSize = Math.max(10, markerRadius * 1.4);

  // Decide what to draw as the "in-progress" line:
  //  - placingA → nothing yet
  //  - placingB → from draftA to current hover point
  //  - awaitingDistance → between draftA and draftB
  let inProgressFrom: CalibrationPoint | null = null;
  let inProgressTo: CalibrationPoint | null = null;
  if (mode === 'placingB' && draftA && hoverPoint) {
    inProgressFrom = draftA;
    inProgressTo = hoverPoint;
  } else if (mode === 'awaitingDistance' && draftA && draftB) {
    inProgressFrom = draftA;
    inProgressTo = draftB;
  }

  const inProgressDistancePx =
    inProgressFrom && inProgressTo
      ? distance(inProgressFrom, inProgressTo)
      : 0;
  const inProgressMeasurement = inProgressFrom && inProgressTo
    ? formatLiveDistance(inProgressDistancePx, activeCalibration?.unit ?? 'px',
        activeCalibration)
    : '';

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="none"
      className="absolute inset-0 z-[60]"
      style={{
        // The SVG itself only captures clicks while in placement mode.
        // Outside of that, individual markers manage their own pointer
        // events (see PointMarker). This is critical so sibling overlays
        // (rulers, measurements) can receive events when this one is idle.
        pointerEvents: isPlacing ? 'auto' : 'none',
        cursor: isPlacing ? 'crosshair' : 'default',
        width: '100%',
        height: '100%',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {/* --------------- Active stored calibration --------------- */}
      {showActive && activeCalibration && (
        <CalibrationLine
          from={activeCalibration.pointA}
          to={activeCalibration.pointB}
          label={`${formatMeasurement(activeCalibration.realDistance, activeCalibration.unit)}`}
          color="#22d3ee" /* cyan-400 */
          dashed={false}
          markerRadius={markerRadius}
          strokeWidth={strokeWidth}
          labelFontSize={labelFontSize}
          interactive={!locked && !isPlacing}
          onStartDragA={(e) => startMarkerDrag('A', e)}
          onStartDragB={(e) => startMarkerDrag('B', e)}
        />
      )}

      {/* --------------- In-progress draft --------------- */}
      {inProgressFrom && inProgressTo && (
        <CalibrationLine
          from={inProgressFrom}
          to={inProgressTo}
          label={inProgressMeasurement}
          color="#10b981" /* emerald-500 */
          dashed
          markerRadius={markerRadius}
          strokeWidth={strokeWidth}
          labelFontSize={labelFontSize}
          interactive={false}
        />
      )}

      {/* Show the lone first point during placingB so the user has visual
          confirmation between clicks. */}
      {mode === 'placingB' && draftA && (!hoverPoint) && (
        <PointMarker
          point={draftA}
          label="A"
          color="#10b981"
          radius={markerRadius}
          strokeWidth={strokeWidth}
          fontSize={labelFontSize}
        />
      )}
    </svg>
  );
};

/* -------------------------------------------------------------------------- */
/* Sub-components                                                             */
/* -------------------------------------------------------------------------- */

interface CalibrationLineProps {
  from: CalibrationPoint;
  to: CalibrationPoint;
  label: string;
  color: string;
  dashed: boolean;
  markerRadius: number;
  strokeWidth: number;
  labelFontSize: number;
  interactive: boolean;
  onStartDragA?: (e: React.PointerEvent<SVGCircleElement>) => void;
  onStartDragB?: (e: React.PointerEvent<SVGCircleElement>) => void;
}

const CalibrationLine: React.FC<CalibrationLineProps> = ({
  from,
  to,
  label,
  color,
  dashed,
  markerRadius,
  strokeWidth,
  labelFontSize,
  interactive,
  onStartDragA,
  onStartDragB,
}) => {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  // Estimate the label box width/height in viewBox units. We can't measure
  // text in SVG without rendering it once, so we approximate from font size
  // and character count — close enough for a small badge.
  const labelPadding = labelFontSize * 0.5;
  const labelHeight = labelFontSize * 1.6;
  const labelWidth = label.length * labelFontSize * 0.62 + labelPadding * 2;

  return (
    <g>
      {/* Drop shadow stroke for legibility against light photos */}
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="#000"
        strokeOpacity={0.6}
        strokeWidth={strokeWidth * 2.4}
      />
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={dashed ? `${strokeWidth * 4} ${strokeWidth * 3}` : undefined}
      />

      <PointMarker
        point={from}
        label="A"
        color={color}
        radius={markerRadius}
        strokeWidth={strokeWidth}
        fontSize={labelFontSize}
        interactive={interactive}
        onPointerDown={onStartDragA}
      />
      <PointMarker
        point={to}
        label="B"
        color={color}
        radius={markerRadius}
        strokeWidth={strokeWidth}
        fontSize={labelFontSize}
        interactive={interactive}
        onPointerDown={onStartDragB}
      />

      {/* Distance label — small pill near the midpoint */}
      {label && (
        <g transform={`translate(${midX - labelWidth / 2}, ${midY - labelHeight - markerRadius * 0.5})`}>
          <rect
            x={0}
            y={0}
            width={labelWidth}
            height={labelHeight}
            rx={labelHeight / 2}
            ry={labelHeight / 2}
            fill="#000"
            fillOpacity={0.75}
            stroke={color}
            strokeWidth={Math.max(1, strokeWidth * 0.5)}
          />
          <text
            x={labelWidth / 2}
            y={labelHeight / 2}
            fill="#fff"
            fontSize={labelFontSize}
            fontFamily="JetBrains Mono, monospace"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {label}
          </text>
        </g>
      )}
    </g>
  );
};

interface PointMarkerProps {
  point: CalibrationPoint;
  label: 'A' | 'B';
  color: string;
  radius: number;
  strokeWidth: number;
  fontSize: number;
  interactive?: boolean;
  onPointerDown?: (e: React.PointerEvent<SVGCircleElement>) => void;
}

const PointMarker: React.FC<PointMarkerProps> = ({
  point,
  label,
  color,
  radius,
  strokeWidth,
  fontSize,
  interactive = false,
  onPointerDown,
}) => (
  <g>
    <circle
      cx={point.x}
      cy={point.y}
      r={radius}
      fill="#000"
      fillOpacity={0.7}
      stroke={color}
      strokeWidth={strokeWidth}
      data-handle={interactive ? '1' : undefined}
      onPointerDown={interactive ? onPointerDown : undefined}
      style={{
        cursor: interactive ? 'grab' : 'default',
        // Explicit pointerEvents so the marker is draggable even when its
        // parent SVG has pointer-events: none (which is the default once
        // placement mode ends — see comment on the parent <svg>).
        pointerEvents: interactive ? 'auto' : 'none',
      }}
    />
    <text
      x={point.x}
      y={point.y}
      fill={color}
      fontSize={fontSize * 0.85}
      fontFamily="JetBrains Mono, monospace"
      fontWeight="bold"
      textAnchor="middle"
      dominantBaseline="central"
      pointerEvents="none"
    >
      {label}
    </text>
  </g>
);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Live distance label rules:
 *  - If we already have an active calibration, show in its real-world unit.
 *  - Otherwise, show raw image pixels — useful while *defining* the very
 *    first calibration since real-world units don't exist yet.
 */
function formatLiveDistance(
  pixels: number,
  _preferredUnit: CalibrationUnit,
  activeCalibration: Calibration | null,
): string {
  const { value, unit } = pxToUnits(pixels, activeCalibration);
  if (unit === 'px') return `${pixels.toFixed(1)} px`;
  return formatMeasurement(value, unit);
}
