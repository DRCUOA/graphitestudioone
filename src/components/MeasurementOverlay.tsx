import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Calibration,
  CalibrationPoint,
  Measurement,
  MeasurementMode,
} from '../types';
import {
  distance,
  formatMeasurement,
  pxToUnits,
} from '../lib/calibration';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const eventToImagePoint = (
  clientX: number,
  clientY: number,
  svg: SVGSVGElement | null,
  imageWidth: number,
  imageHeight: number,
): CalibrationPoint | null => {
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const x = ((clientX - rect.left) / rect.width) * imageWidth;
  const y = ((clientY - rect.top) / rect.height) * imageHeight;
  return { x, y };
};

/* -------------------------------------------------------------------------- */
/* Props                                                                      */
/* -------------------------------------------------------------------------- */

interface Props {
  imageWidth: number;
  imageHeight: number;
  /** All saved measurements. Visibility filtering happens here so the
   *  parent doesn't need to filter. */
  measurements: Measurement[];
  /** Master visibility toggle from MeasurementState. */
  showAll: boolean;
  /** Active calibration — used to render real-world distances on labels. */
  calibration: Calibration | null;
  /** Current placement state (idle / placingA / placingB / awaitingName). */
  mode: MeasurementMode;
  /** When true (e.g. paired with calibration lock), markers are read-only. */
  locked: boolean;

  draftA: CalibrationPoint | null;
  draftB: CalibrationPoint | null;
  hoverPoint: CalibrationPoint | null;

  onCanvasClick: (point: CalibrationPoint) => void;
  onHover: (point: CalibrationPoint | null) => void;
  /** Drag of an existing measurement's endpoint. */
  onMeasurementPointDrag: (
    measurementId: string,
    which: 'A' | 'B',
    point: CalibrationPoint,
  ) => void;
  onMeasurementPointDragEnd: () => void;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * SVG overlay that handles custom measurement markers ("Left pupil → right
 * nipple", etc.). Draws all visible markers, lets users drag endpoints,
 * and captures clicks during placement.
 *
 * Uses the same pointer-events strategy as CalibrationOverlay: the SVG is
 * only event-receiving while in placement mode, otherwise individual
 * marker handles enable their own pointer events.
 */
export const MeasurementOverlay: React.FC<Props> = ({
  imageWidth,
  imageHeight,
  measurements,
  showAll,
  calibration,
  mode,
  locked,
  draftA,
  draftB,
  hoverPoint,
  onCanvasClick,
  onHover,
  onMeasurementPointDrag,
  onMeasurementPointDragEnd,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<{ id: string; which: 'A' | 'B' } | null>(null);
  const isPlacing = mode === 'placingA' || mode === 'placingB';

  /* ------------------------------------------------------------------ */
  /* Pointer handlers — placement clicks                                */
  /* ------------------------------------------------------------------ */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!isPlacing) return;
      // Don't hijack clicks on a marker handle.
      if ((e.target as Element).getAttribute('data-handle')) return;
      const pt = eventToImagePoint(
        e.clientX,
        e.clientY,
        svgRef.current,
        imageWidth,
        imageHeight,
      );
      if (pt) onCanvasClick(pt);
    },
    [isPlacing, imageWidth, imageHeight, onCanvasClick],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!isPlacing) return;
      const pt = eventToImagePoint(
        e.clientX,
        e.clientY,
        svgRef.current,
        imageWidth,
        imageHeight,
      );
      if (pt) onHover(pt);
    },
    [isPlacing, imageWidth, imageHeight, onHover],
  );

  const handlePointerLeave = useCallback(() => {
    if (isPlacing) onHover(null);
  }, [isPlacing, onHover]);

  /* ------------------------------------------------------------------ */
  /* Marker dragging — window-level so it works regardless of SVG       */
  /* pointer-events state.                                              */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const pt = eventToImagePoint(
        e.clientX,
        e.clientY,
        svgRef.current,
        imageWidth,
        imageHeight,
      );
      if (pt) onMeasurementPointDrag(dragging.id, dragging.which, pt);
    };
    const onUp = () => {
      setDragging(null);
      onMeasurementPointDragEnd();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [
    dragging,
    imageWidth,
    imageHeight,
    onMeasurementPointDrag,
    onMeasurementPointDragEnd,
  ]);

  const startMarkerDrag = (
    id: string,
    which: 'A' | 'B',
    e: React.PointerEvent<SVGCircleElement>,
  ) => {
    if (locked || isPlacing) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragging({ id, which });
  };

  /* ------------------------------------------------------------------ */
  /* Geometry / styling                                                 */
  /* ------------------------------------------------------------------ */
  const markerRadius = Math.max(5, Math.min(imageWidth, imageHeight) * 0.01);
  const strokeWidth = Math.max(1, markerRadius * 0.18);
  const labelFontSize = Math.max(10, markerRadius * 1.4);
  // Distinct colour from calibration (cyan) so users tell them apart.
  const COLOR = '#fbbf24'; // amber-400

  const visibleMeasurements = showAll ? measurements.filter((m) => m.visible) : [];

  // Draft preview: from draftA to current cursor (placingB) or to draftB
  // (awaitingName).
  let draftFrom: CalibrationPoint | null = null;
  let draftTo: CalibrationPoint | null = null;
  if (mode === 'placingB' && draftA && hoverPoint) {
    draftFrom = draftA;
    draftTo = hoverPoint;
  } else if (mode === 'awaitingName' && draftA && draftB) {
    draftFrom = draftA;
    draftTo = draftB;
  }
  const draftPx = draftFrom && draftTo ? distance(draftFrom, draftTo) : 0;
  const draftReal = draftFrom && draftTo
    ? formatLiveDistance(draftPx, calibration)
    : '';

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="none"
      className="absolute inset-0 z-[58]"
      style={{
        // Same coexistence pattern as CalibrationOverlay: only swallow
        // pointer events during placement; markers manage their own.
        pointerEvents: isPlacing ? 'auto' : 'none',
        cursor: isPlacing ? 'crosshair' : 'default',
        width: '100%',
        height: '100%',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {/* --------------- Saved measurements --------------- */}
      {visibleMeasurements.map((m) => {
        const realLabel = formatLiveDistance(distance(m.pointA, m.pointB), calibration);
        return (
          <MarkerLine
            key={m.id}
            from={m.pointA}
            to={m.pointB}
            label={`${m.name} · ${realLabel}`}
            color={COLOR}
            dashed={false}
            markerRadius={markerRadius}
            strokeWidth={strokeWidth}
            labelFontSize={labelFontSize}
            interactive={!locked && !isPlacing}
            onStartDragA={(e) => startMarkerDrag(m.id, 'A', e)}
            onStartDragB={(e) => startMarkerDrag(m.id, 'B', e)}
          />
        );
      })}

      {/* --------------- In-progress draft --------------- */}
      {draftFrom && draftTo && (
        <MarkerLine
          from={draftFrom}
          to={draftTo}
          label={draftReal}
          color={COLOR}
          dashed
          markerRadius={markerRadius}
          strokeWidth={strokeWidth}
          labelFontSize={labelFontSize}
          interactive={false}
        />
      )}

      {/* Single A point during placingB before user moves the cursor. */}
      {mode === 'placingB' && draftA && !hoverPoint && (
        <SinglePointMarker
          point={draftA}
          color={COLOR}
          radius={markerRadius}
          strokeWidth={strokeWidth}
        />
      )}
    </svg>
  );
};

/* -------------------------------------------------------------------------- */
/* Sub-components                                                             */
/* -------------------------------------------------------------------------- */

interface MarkerLineProps {
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

const MarkerLine: React.FC<MarkerLineProps> = ({
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
  const labelPadding = labelFontSize * 0.5;
  const labelHeight = labelFontSize * 1.6;
  const labelWidth = label.length * labelFontSize * 0.58 + labelPadding * 2;

  return (
    <g>
      {/* Halo for legibility against bright photos */}
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
      <SinglePointMarker
        point={from}
        color={color}
        radius={markerRadius}
        strokeWidth={strokeWidth}
        interactive={interactive}
        onPointerDown={onStartDragA}
      />
      <SinglePointMarker
        point={to}
        color={color}
        radius={markerRadius}
        strokeWidth={strokeWidth}
        interactive={interactive}
        onPointerDown={onStartDragB}
      />
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
            fillOpacity={0.78}
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

interface SinglePointProps {
  point: CalibrationPoint;
  color: string;
  radius: number;
  strokeWidth: number;
  interactive?: boolean;
  onPointerDown?: (e: React.PointerEvent<SVGCircleElement>) => void;
}

const SinglePointMarker: React.FC<SinglePointProps> = ({
  point,
  color,
  radius,
  strokeWidth,
  interactive = false,
  onPointerDown,
}) => (
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
      pointerEvents: interactive ? 'auto' : 'none',
    }}
  />
);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatLiveDistance(pixels: number, cal: Calibration | null): string {
  const { value, unit } = pxToUnits(pixels, cal);
  if (unit === 'px') return `${pixels.toFixed(1)} px`;
  return formatMeasurement(value, unit);
}
