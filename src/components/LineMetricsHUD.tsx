import React from 'react';
import type { CalibrationPoint } from '../types';
import { type LineMetrics, formatLineMetrics } from '../lib/geometry';

/* -------------------------------------------------------------------------- */
/* Props                                                                      */
/* -------------------------------------------------------------------------- */

interface Props {
  /** Line endpoints in image-pixel space. */
  from: CalibrationPoint;
  to: CalibrationPoint;
  /** Pre-computed metrics. Pure function of `from`/`to` + calibration. */
  metrics: LineMetrics;
  /** Image dimensions — used to clamp the badge inside the canvas. */
  imageWidth: number;
  imageHeight: number;
  /** Theme accent colour — should match the parent overlay's primary stroke. */
  color: string;
  /** SVG-units font size; matches the surrounding overlay's label scale. */
  fontSize: number;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Two-row HUD that floats over the in-flight line during placement.
 *
 * Row 1: total length + angle
 * Row 2: signed horizontal (→/←) and vertical (↑/↓) components
 *
 * Designed to be drop-in renderable from any overlay that draws a draft
 * line — the parent passes the same `from` / `to` / metrics it already has.
 *
 * Positioned just above the midpoint by default. If that would clip the
 * top edge of the image we flip below; left/right is clamped so the badge
 * never spills outside the canvas viewport.
 */
export const LineMetricsHUD: React.FC<Props> = ({
  from,
  to,
  metrics,
  imageWidth,
  imageHeight,
  color,
  fontSize,
}) => {
  const f = formatLineMetrics(metrics);

  // Row strings — two of them so the badge stays compact even on long lines.
  // Two-space gap between length & angle reads as a visual divider without
  // needing an actual separator glyph.
  const row1 = `${f.length}   ∠ ${f.angle}`;
  const row2 = `${f.dx}    ${f.dy}`;

  // Monospace 0.6em char width is a safe overestimate for JetBrains Mono.
  const charW = fontSize * 0.6;
  const padX = fontSize * 0.7;
  const padY = fontSize * 0.45;
  const lineHeight = fontSize * 1.35;
  const widestChars = Math.max(row1.length, row2.length);
  const boxW = widestChars * charW + padX * 2;
  const boxH = lineHeight * 2 + padY * 2;

  // Anchor near the midpoint of the line, offset above so the cursor
  // doesn't sit on top of the badge while the user is still moving.
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const offsetAbove = fontSize * 1.6;

  // Try-above-first: if the badge would clip the top of the canvas,
  // flip it below the midpoint instead.
  const wantTop = midY - boxH - offsetAbove;
  const flipBelow = wantTop < 0;
  const top = flipBelow ? midY + offsetAbove : wantTop;

  // Horizontal clamp — keep the badge inside [0, imageWidth].
  const idealLeft = midX - boxW / 2;
  const left = Math.max(0, Math.min(imageWidth - boxW, idealLeft));

  // If the line is degenerate (start ≈ end) the badge would jitter
  // distractingly. Skip render until there's a real line to describe.
  if (metrics.pixelLength < 1) return null;

  return (
    <g transform={`translate(${left}, ${top})`} pointerEvents="none">
      {/* Subtle drop-shadow halo for legibility against bright photos. */}
      <rect
        x={-1}
        y={-1}
        width={boxW + 2}
        height={boxH + 2}
        rx={fontSize * 0.55}
        fill="#000"
        fillOpacity={0.25}
      />
      <rect
        x={0}
        y={0}
        width={boxW}
        height={boxH}
        rx={fontSize * 0.5}
        fill="#0a0a0a"
        fillOpacity={0.92}
        stroke={color}
        strokeWidth={1.4}
      />
      <text
        x={padX}
        y={padY + fontSize}
        fill="#ffffff"
        fontSize={fontSize}
        fontFamily="JetBrains Mono, monospace"
        fontWeight={600}
      >
        {row1}
      </text>
      <text
        x={padX}
        y={padY + fontSize + lineHeight}
        fill="#d4d4d8"
        fontSize={fontSize * 0.95}
        fontFamily="JetBrains Mono, monospace"
      >
        {row2}
      </text>
      {/* Small "PX" hint when no calibration is active so the user
          knows why the units look wrong. */}
      {!metrics.calibrated && (
        <text
          x={boxW - padX}
          y={padY + fontSize}
          fill="#a1a1aa"
          fontSize={fontSize * 0.7}
          fontFamily="JetBrains Mono, monospace"
          textAnchor="end"
        >
          uncalibrated
        </text>
      )}
    </g>
  );
};
