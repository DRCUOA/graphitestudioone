import React from 'react';
import { Magnet, Loader2, Eye, EyeOff } from 'lucide-react';
import type { TraceAssist } from '../types';

/* -------------------------------------------------------------------------- */
/* Props                                                                      */
/* -------------------------------------------------------------------------- */

export type TraceAssistStatus =
  | 'no-image'      // no reference loaded yet
  | 'computing'     // Sobel pass running in worker
  | 'ready'         // edge map available, snap is active
  | 'failed';       // worker errored — best-effort log, no crash

interface Props {
  state: TraceAssist;
  status: TraceAssistStatus;
  /** True when an edge map exists — drives the "Show edges" toggle's enabled state. */
  hasEdgeMap: boolean;
  imageLoaded: boolean;

  onToggleEnabled: () => void;
  onChangeSensitivity: (s: number) => void;
  onToggleShowEdges: () => void;
  onRecompute: () => void;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Sidebar panel for the Trace Assist (edge-snap) drawing aid.
 *
 * The panel is positioned right after Free Draw because both tools share
 * the same workflow context: lay marks down on top of a reference photo.
 * Snap applies to Free Draw, Line, and Measurement clicks alike, so the
 * controls live in one place rather than being duplicated per tool.
 */
export const TraceAssistPanel: React.FC<Props> = ({
  state,
  status,
  hasEdgeMap,
  imageLoaded,
  onToggleEnabled,
  onChangeSensitivity,
  onToggleShowEdges,
  onRecompute,
}) => {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
          Trace Assist
        </label>
        <Magnet className="w-3 h-3 text-zinc-600" />
      </div>

      {/* ----------------- Status row ----------------- */}
      <div className="text-[9px] font-mono uppercase tracking-widest">
        {status === 'no-image' && (
          <span className="text-zinc-600">— Upload an image to enable snap —</span>
        )}
        {status === 'computing' && (
          <span className="text-amber-400 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            Detecting edges…
          </span>
        )}
        {status === 'ready' && (
          <span className="text-emerald-400">● Edge map ready</span>
        )}
        {status === 'failed' && (
          <span className="text-red-400">⚠ Edge detection failed</span>
        )}
      </div>

      {/* ----------------- Master toggle ----------------- */}
      <div className="flex items-center justify-between">
        <span className="text-xs">Snap to edges</span>
        <button
          type="button"
          onClick={onToggleEnabled}
          disabled={!hasEdgeMap}
          className={`w-8 h-4 rounded-full relative transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            state.enabled ? 'bg-emerald-400' : 'bg-zinc-800'
          }`}
          title={
            !hasEdgeMap
              ? 'Edge map not ready yet'
              : state.enabled
                ? 'Snap is ON — drawn points are pulled to nearby edges. Hold Shift to bypass momentarily.'
                : 'Snap is OFF — drawn points stay where you put them.'
          }
          aria-label="Toggle edge snapping"
        >
          <div
            className={`absolute top-1 left-1 w-2 h-2 rounded-full bg-[#0a0a0a] transition-transform ${
              state.enabled ? 'translate-x-4' : ''
            }`}
          />
        </button>
      </div>

      {/* ----------------- Sensitivity slider ----------------- */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono opacity-60">Sensitivity</span>
          <span className="text-[10px] font-mono">{state.sensitivity.toFixed(2)}×</span>
        </div>
        <input
          type="range"
          min={0.25}
          max={2.5}
          step={0.05}
          value={state.sensitivity}
          onChange={(e) => onChangeSensitivity(parseFloat(e.target.value))}
          disabled={!state.enabled || !hasEdgeMap}
          className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-400 disabled:opacity-40"
          title="Higher values widen the snap radius and latch onto subtler features. Lower values only catch crisp outlines very close to the cursor."
        />
        <div className="flex items-center justify-between text-[8px] font-mono text-zinc-600 uppercase tracking-widest">
          <span>Crisp · Near</span>
          <span>Loose · Far</span>
        </div>
      </div>

      {/* ----------------- Show edges preview ----------------- */}
      <div className="flex items-center justify-between">
        <span className="text-xs flex items-center gap-1.5">
          {state.showEdges ? <Eye className="w-3 h-3 opacity-60" /> : <EyeOff className="w-3 h-3 opacity-60" />}
          Show detected edges
        </span>
        <button
          type="button"
          onClick={onToggleShowEdges}
          disabled={!hasEdgeMap}
          className={`w-8 h-4 rounded-full relative transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            state.showEdges ? 'bg-emerald-400' : 'bg-zinc-800'
          }`}
          title="Render the detected outlines as a faint white wireframe over the reference. Useful for tuning sensitivity."
          aria-label="Toggle detected edges preview"
        >
          <div
            className={`absolute top-1 left-1 w-2 h-2 rounded-full bg-[#0a0a0a] transition-transform ${
              state.showEdges ? 'translate-x-4' : ''
            }`}
          />
        </button>
      </div>

      {/* ----------------- Recompute (manual fallback) ----------------- */}
      <button
        type="button"
        onClick={onRecompute}
        disabled={!imageLoaded || status === 'computing'}
        className="w-full px-3 py-1.5 border border-zinc-800 hover:border-emerald-700 hover:text-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-zinc-800 disabled:hover:text-zinc-300 rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 transition-colors"
        title="Re-run edge detection. Useful if you tweaked image processing (contrast / posterise / etc.) and want the edge map to track the new look."
      >
        Recompute edges
      </button>

      {/* ----------------- Tip ----------------- */}
      <p className="text-[9px] text-zinc-600 leading-snug">
        Tip: while drawing or placing points, your cursor magnetises to the
        strongest nearby outline in the photo. Hold <span className="font-mono text-zinc-400">Shift</span> to
        place a point exactly where the cursor is, ignoring the snap.
      </p>
    </section>
  );
};
