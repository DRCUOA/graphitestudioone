import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Calibration,
  CalibrationPoint,
  FreeLine,
  FreeLineMode,
} from '../types';
import {
  buildVariableWidthPath,
  eraserHitsStroke,
  shouldAppendSample,
  simulatePressure,
} from '../lib/freeLines';
import { formatMeasurement, pxToUnits } from '../lib/calibration';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Convert client coords to image-pixel space for whichever SVG hosts us. */
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
  return {
    x: ((clientX - rect.left) / rect.width) * imageWidth,
    y: ((clientY - rect.top) / rect.height) * imageHeight,
  };
};

/* -------------------------------------------------------------------------- */
/* Props                                                                      */
/* -------------------------------------------------------------------------- */

interface Props {
  imageWidth: number;
  imageHeight: number;
  /** Pre-filtered subset of strokes to render (caller decides last-N). */
  strokes: FreeLine[];
  mode: FreeLineMode;
  /** Default stroke width (image-pixel units) — used for the in-flight stroke. */
  defaultStrokeWidth: number;
  /** Default stroke colour — used for the in-flight stroke. */
  defaultColor: string;
  /** When false, every captured sample uses constant 0.5 pressure (flat line). */
  pressureEnabled: boolean;
  /** Eraser brush radius in image-pixel units (only consulted in `erasing`). */
  eraserSize: number;
  /** Active calibration — drives the in-flight length HUD (null = uncalibrated). */
  calibration: Calibration | null;
  /**
   * Optional point-level snap. When provided and returning a point, every
   * captured sample is shifted to the snap target. Returning null means
   * "no snap available" — the raw pointer position is used. Callers
   * should respect Shift-to-bypass at the source so we don't have to
   * thread modifier state through the overlay tree.
   */
  snap?: ((x: number, y: number) => { x: number; y: number } | null) | null;
  /** Called once on pointer-up with the captured stroke geometry + pressures. */
  onCommitStroke: (points: CalibrationPoint[], pressures: number[]) => void;
  /** Called when the eraser brush deletes one or more strokes. */
  onEraseStrokes: (ids: string[]) => void;
}

/* -------------------------------------------------------------------------- */
/* StrokePath — memo'd renderer for a single committed stroke.                */
/* -------------------------------------------------------------------------- */

interface StrokePathProps {
  stroke: FreeLine;
  baselineWidth: number;
  opacity: number;
}
const StrokePath: React.FC<StrokePathProps> = React.memo(({ stroke, baselineWidth, opacity }) => {
  const w = baselineWidth * stroke.widthScale;
  const d = buildVariableWidthPath(stroke.points, stroke.pressures, w);
  return (
    <g opacity={opacity}>
      {/* Slight halo so light strokes still read on bright photos. */}
      <path d={d} fill="#000" fillOpacity={0.18} stroke="none" />
      <path d={d} fill={stroke.color} stroke="none" />
    </g>
  );
});

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Pressure-aware freehand SVG overlay with an eraser brush.
 *
 * Drawing pipeline:
 *   1. pointerdown captures the first sample + initial pressure.
 *   2. pointermove appends a sample if it's far enough from the previous
 *      one. Pressure comes from `e.pressure` for `pen` pointers; mice and
 *      touch get a velocity-derived simulation so the resulting stroke
 *      still tapers like a real pencil.
 *   3. pointerup commits via `onCommitStroke` and immediately readies the
 *      next stroke (continuous mode).
 *
 * Erasing pipeline:
 *   • pointer drag in `erasing` mode samples cursor positions and removes
 *     any visible stroke whose spine passes within `eraserSize` of any
 *     sampled position. Removal is per-stroke and immediate (the user
 *     sees strokes vanish under the brush) — matches the mental model of
 *     a kneaded eraser lifting marks rather than an art eraser smudging
 *     pixels.
 */
export const FreeLineOverlay: React.FC<Props> = ({
  imageWidth,
  imageHeight,
  strokes,
  mode,
  defaultStrokeWidth,
  defaultColor,
  pressureEnabled,
  eraserSize,
  calibration,
  snap,
  onCommitStroke,
  onEraseStrokes,
}) => {
  // Convenience: apply snap if available, else passthrough. Centralised
  // here so both the move handler and the cursor preview stay consistent.
  const applySnap = useCallback(
    (raw: CalibrationPoint): CalibrationPoint => {
      if (!snap) return raw;
      const hit = snap(raw.x, raw.y);
      return hit ? { x: hit.x, y: hit.y } : raw;
    },
    [snap],
  );
  const svgRef = useRef<SVGSVGElement>(null);
  const isDrawing = mode === 'drawing';
  const isErasing = mode === 'erasing';
  const isInteractive = isDrawing || isErasing;

  /* ------------------------------------------------------------------ */
  /* In-flight draft state                                              */
  /* ------------------------------------------------------------------ */
  const [draftPoints, setDraftPoints] = useState<CalibrationPoint[]>([]);
  const [draftPressures, setDraftPressures] = useState<number[]>([]);
  const draftPointsRef = useRef<CalibrationPoint[]>([]);
  const draftPressuresRef = useRef<number[]>([]);
  const drawingRef = useRef(false);
  const lastSampleTimeRef = useRef(0);

  /* ------------------------------------------------------------------ */
  /* Cursor tracking — drives both the eraser indicator and the         */
  /* in-flight length HUD. We track both the raw pointer position and   */
  /* its snapped target so we can visualise the magnetism (a short     */
  /* line + dot pair when they diverge).                               */
  /* ------------------------------------------------------------------ */
  const [cursor, setCursor] = useState<CalibrationPoint | null>(null);
  const [cursorRaw, setCursorRaw] = useState<CalibrationPoint | null>(null);

  const erasingRef = useRef(false);

  /* ------------------------------------------------------------------ */
  /* Pointer capture — drawing                                          */
  /* ------------------------------------------------------------------ */

  const samplePressure = useCallback(
    (e: React.PointerEvent<SVGSVGElement> | PointerEvent): number => {
      if (!pressureEnabled) return 0.5;
      // Real pen devices report pressure in (0, 1]. PointerEvent reports
      // 0.5 for mouse/touch as a default, so we don't trust those — we
      // synthesise from velocity instead.
      if (e.pointerType === 'pen' && e.pressure > 0) {
        return e.pressure;
      }
      // For non-pen, return 0.5 as a sentinel; the move handler will
      // overwrite it with a velocity-derived value once it has a prior
      // sample to reference.
      return 0.5;
    },
    [pressureEnabled],
  );

  const beginStroke = useCallback(
    (e: React.PointerEvent<SVGSVGElement>, pt: CalibrationPoint) => {
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture can throw on detached elements — ignore.
      }
      drawingRef.current = true;
      const initialPressure = samplePressure(e);
      draftPointsRef.current = [pt];
      draftPressuresRef.current = [initialPressure];
      lastSampleTimeRef.current = e.timeStamp;
      setDraftPoints([pt]);
      setDraftPressures([initialPressure]);
    },
    [samplePressure],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!isInteractive) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const pt = eventToImagePoint(
        e.clientX, e.clientY,
        svgRef.current, imageWidth, imageHeight,
      );
      if (!pt) return;
      if (isDrawing) {
        // Snap the very first sample so the stroke begins on an outline
        // rather than a few pixels off it.
        beginStroke(e, applySnap(pt));
      } else if (isErasing) {
        try {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
        } catch { /* noop */ }
        erasingRef.current = true;
        setCursor(pt);
        // Immediate first hit so a click (no drag) still erases.
        const radius = Math.max(0.5, eraserSize);
        const hits = strokes
          .filter((s) => eraserHitsStroke(s, pt.x, pt.y, radius))
          .map((s) => s.id);
        if (hits.length > 0) onEraseStrokes(hits);
      }
    },
    [isInteractive, isDrawing, isErasing, imageWidth, imageHeight, beginStroke, strokes, eraserSize, onEraseStrokes],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!isInteractive) return;
      const rawPt = eventToImagePoint(
        e.clientX, e.clientY,
        svgRef.current, imageWidth, imageHeight,
      );
      if (!rawPt) return;
      // Snap is applied to every sample (including idle hovers) so the
      // crosshair previews exactly where a point would land if the user
      // clicked. Erasing intentionally uses the raw cursor — the user
      // wants to remove what's literally under their pointer.
      const pt = isDrawing ? applySnap(rawPt) : rawPt;

      // Always update cursor — the eraser indicator and length HUD use it
      // even when the pointer isn't down.
      setCursor(pt);
      setCursorRaw(rawPt);

      if (isDrawing && drawingRef.current) {
        const lastPt = draftPointsRef.current[draftPointsRef.current.length - 1];
        if (lastPt && !shouldAppendSample(lastPt, pt)) return;

        // Pressure: real for pen, simulated from velocity otherwise.
        let pressure: number;
        if (pressureEnabled && e.pointerType === 'pen' && e.pressure > 0) {
          pressure = e.pressure;
        } else if (pressureEnabled) {
          const prevPressure = draftPressuresRef.current[draftPressuresRef.current.length - 1] ?? 0.5;
          pressure = lastPt
            ? simulatePressure(lastPt, lastSampleTimeRef.current, pt, e.timeStamp, prevPressure)
            : prevPressure;
        } else {
          pressure = 0.5;
        }

        draftPointsRef.current = [...draftPointsRef.current, pt];
        draftPressuresRef.current = [...draftPressuresRef.current, pressure];
        lastSampleTimeRef.current = e.timeStamp;
        setDraftPoints(draftPointsRef.current);
        setDraftPressures(draftPressuresRef.current);
      } else if (isErasing && erasingRef.current) {
        const radius = Math.max(0.5, eraserSize);
        const hits = strokes
          .filter((s) => eraserHitsStroke(s, pt.x, pt.y, radius))
          .map((s) => s.id);
        if (hits.length > 0) onEraseStrokes(hits);
      }
    },
    [isInteractive, isDrawing, isErasing, imageWidth, imageHeight, pressureEnabled, strokes, eraserSize, onEraseStrokes],
  );

  const finishStroke = useCallback(() => {
    if (drawingRef.current) {
      drawingRef.current = false;
      const pts = draftPointsRef.current;
      const prs = draftPressuresRef.current;
      draftPointsRef.current = [];
      draftPressuresRef.current = [];
      setDraftPoints([]);
      setDraftPressures([]);
      // Discard accidental taps — a single point isn't a stroke.
      if (pts.length >= 2) onCommitStroke(pts, prs);
    }
    erasingRef.current = false;
  }, [onCommitStroke]);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch { /* noop */ }
      finishStroke();
    },
    [finishStroke],
  );

  const handlePointerLeave = useCallback(() => {
    // Hide the cursor indicator when the pointer leaves the SVG; if a
    // stroke is in flight `finishStroke` will be called by the
    // window-level safety net below.
    setCursor(null);
    setCursorRaw(null);
  }, []);

  // Defensive: capture release outside the SVG (browser menu mid-drag, etc.).
  useEffect(() => {
    if (!isInteractive) return;
    const onWindowUp = () => finishStroke();
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowUp);
    return () => {
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowUp);
    };
  }, [isInteractive, finishStroke]);

  /* ------------------------------------------------------------------ */
  /* Geometry / styling                                                 */
  /* ------------------------------------------------------------------ */

  // Strokes scale with image size so the on-screen weight reads similarly
  // for a 4K reference vs a 600px sketch. The user's `strokeWidth` value
  // is a multiplier on this baseline.
  const baselineStroke = Math.max(0.5, Math.min(imageWidth, imageHeight) * 0.0015);
  const cursorScale = Math.min(imageWidth, imageHeight) / 600; // for fixed-size icons

  /* ------------------------------------------------------------------ */
  /* In-flight length HUD (calibrated when possible)                    */
  /* ------------------------------------------------------------------ */
  const draftLengthPx = (() => {
    if (draftPoints.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < draftPoints.length; i++) {
      const dx = draftPoints[i].x - draftPoints[i - 1].x;
      const dy = draftPoints[i].y - draftPoints[i - 1].y;
      total += Math.sqrt(dx * dx + dy * dy);
    }
    return total;
  })();

  const draftLengthLabel = (() => {
    if (draftLengthPx <= 0) return null;
    if (calibration) {
      const { value, unit } = pxToUnits(draftLengthPx, calibration);
      return formatMeasurement(value, unit);
    }
    return `${Math.round(draftLengthPx)} px`;
  })();

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="none"
      className="absolute inset-0 z-[59]"
      style={{
        // Same coexistence contract as the other overlays: only swallow
        // events while the tool is active.
        pointerEvents: isInteractive ? 'auto' : 'none',
        cursor: isInteractive ? 'none' : 'default',
        width: '100%',
        height: '100%',
        // Hint the browser that this layer will repaint a lot during a
        // stroke — promotes to its own compositor layer on most engines.
        willChange: isInteractive ? 'transform' : 'auto',
        // Tablet/touch: prevent native panning from stealing pointer events.
        touchAction: isInteractive ? 'none' : 'auto',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      {/* --------------- Saved strokes --------------- */}
      {strokes.map((s, idx) => {
        // Subtle age fade so the most recent strokes read first.
        const ageOpacity = strokes.length <= 1
          ? 1
          : 0.55 + (0.45 * idx) / (strokes.length - 1);
        return (
          <StrokePath key={s.id} stroke={s} baselineWidth={baselineStroke} opacity={ageOpacity} />
        );
      })}

      {/* --------------- In-flight stroke --------------- */}
      {draftPoints.length > 0 && (() => {
        const w = baselineStroke * defaultStrokeWidth;
        const d = buildVariableWidthPath(draftPoints, draftPressures, w);
        return (
          <g>
            <path d={d} fill="#000" fillOpacity={0.18} stroke="none" />
            <path d={d} fill={defaultColor} stroke="none" />
          </g>
        );
      })()}

      {/* --------------- Eraser cursor (image-px circle) --------------- */}
      {isErasing && cursor && (
        <g pointerEvents="none">
          <circle
            cx={cursor.x}
            cy={cursor.y}
            r={Math.max(2, eraserSize)}
            fill="rgba(244, 114, 182, 0.10)"
            stroke="#fb7185"
            strokeWidth={Math.max(1, cursorScale)}
            strokeDasharray={`${4 * cursorScale} ${3 * cursorScale}`}
          />
          {/* Centre dot for precise placement. */}
          <circle cx={cursor.x} cy={cursor.y} r={Math.max(1, cursorScale * 0.8)} fill="#fb7185" />
        </g>
      )}

      {/* --------------- Snap-magnet visualisation --------------- */}
      {/* Visible whenever the snap target is meaningfully different from
          the raw pointer position. Communicates "I shifted your point" so
          users learn to predict the snap and Shift-bypass when needed. */}
      {isDrawing && cursor && cursorRaw && (() => {
        const dx = cursor.x - cursorRaw.x;
        const dy = cursor.y - cursorRaw.y;
        const offset = Math.hypot(dx, dy);
        if (offset < 1.5) return null;
        return (
          <g pointerEvents="none">
            <line
              x1={cursorRaw.x} y1={cursorRaw.y}
              x2={cursor.x} y2={cursor.y}
              stroke="#34d399" strokeOpacity={0.6}
              strokeWidth={Math.max(0.75, cursorScale * 0.75)}
              strokeDasharray={`${2 * cursorScale} ${2 * cursorScale}`}
            />
            <circle
              cx={cursor.x} cy={cursor.y} r={Math.max(2, cursorScale * 2)}
              fill="none" stroke="#34d399" strokeWidth={Math.max(1, cursorScale)}
            />
            <circle
              cx={cursor.x} cy={cursor.y} r={Math.max(0.8, cursorScale * 0.8)}
              fill="#34d399"
            />
          </g>
        );
      })()}

      {/* --------------- Draw cursor crosshair --------------- */}
      {isDrawing && cursor && !drawingRef.current && (
        <g pointerEvents="none" stroke="#fb7185" strokeWidth={Math.max(1, cursorScale)} fill="none">
          <line x1={cursor.x - 6 * cursorScale} y1={cursor.y} x2={cursor.x + 6 * cursorScale} y2={cursor.y} />
          <line x1={cursor.x} y1={cursor.y - 6 * cursorScale} x2={cursor.x} y2={cursor.y + 6 * cursorScale} />
        </g>
      )}

      {/* --------------- In-flight length HUD --------------- */}
      {/* Floats above the cursor while a stroke is in flight so the user
          can practice "draw a 5 cm gesture" without looking away. */}
      {isDrawing && draftLengthLabel && cursor && (() => {
        const fs = 13 * cursorScale;
        const padX = 6 * cursorScale;
        const padY = 4 * cursorScale;
        const text = draftLengthLabel;
        // Crude width estimate so the badge sits flush around the text;
        // SVG can't measure text without a DOM bounce so we approximate
        // assuming ~0.55em per glyph for our monospace label.
        const approxW = text.length * fs * 0.6 + padX * 2;
        const h = fs + padY * 2;
        // Position above the cursor; flip below if too close to the top.
        const above = cursor.y > h + 12 * cursorScale;
        const cy = above ? cursor.y - 12 * cursorScale - h : cursor.y + 12 * cursorScale;
        const cx = Math.max(0, Math.min(imageWidth - approxW, cursor.x - approxW / 2));
        return (
          <g pointerEvents="none">
            <rect
              x={cx} y={cy} width={approxW} height={h} rx={3 * cursorScale} ry={3 * cursorScale}
              fill="#0a0a0a" fillOpacity={0.85}
              stroke="#fb7185" strokeOpacity={0.6} strokeWidth={Math.max(0.5, cursorScale * 0.5)}
            />
            <text
              x={cx + approxW / 2} y={cy + h / 2 + fs * 0.35}
              fill="#fafafa" fontSize={fs} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              textAnchor="middle"
            >
              {text}
            </text>
          </g>
        );
      })()}
    </svg>
  );
};
