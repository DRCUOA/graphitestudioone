import React from 'react';
import {
  Slash,
  Plus,
  Eye,
  EyeOff,
  Trash2,
  Undo2,
} from 'lucide-react';
import { LineMode, LineState } from '../types';
import { LINE_SHOW_N_MAX, LINE_SHOW_N_MIN } from '../lib/lines';

interface Props {
  state: LineState;
  mode: LineMode;
  imageLoaded: boolean;

  onStart: () => void;
  onStop: () => void;
  onToggleVisible: () => void;
  onChangeShowLastN: (n: number) => void;
  onUndoLast: () => void;
  onClearAll: () => void;
}

/**
 * Sidebar section for the "Line Shapes" tool — quick two-click freehand
 * lines with no measurements attached. Adds a master visibility toggle
 * plus an integer "show last N" selector so the canvas stays tidy.
 */
export const LinePanel: React.FC<Props> = ({
  state,
  mode,
  imageLoaded,
  onStart,
  onStop,
  onToggleVisible,
  onChangeShowLastN,
  onUndoLast,
  onClearAll,
}) => {
  const drawing = mode !== 'idle';
  const total = state.lines.length;
  const showing = state.visible
    ? Math.min(total, Math.max(LINE_SHOW_N_MIN, state.showLastN))
    : 0;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
          Line Shapes
        </label>
        <Slash className="w-3 h-3 text-zinc-600" />
      </div>

      {/* Drawing CTA */}
      {drawing ? (
        <div className="rounded border border-violet-500/40 bg-violet-500/5 p-3 space-y-2">
          <p className="text-[11px] text-violet-300 font-medium leading-snug">
            {mode === 'placingA' && 'Click first point of the line.'}
            {mode === 'placingB' && 'Click second point — the line will be saved automatically.'}
          </p>
          <p className="text-[9px] text-violet-300/60 leading-snug">
            Continuous mode: keep clicking pairs of points to add more lines.
            Press Esc or Stop to exit.
          </p>
          <button
            type="button"
            onClick={onStop}
            className="w-full px-3 py-2 border border-zinc-700 hover:border-zinc-500 rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 hover:text-zinc-100 transition-colors"
          >
            Stop drawing
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onStart}
          disabled={!imageLoaded}
          title={
            !imageLoaded
              ? 'Upload a reference image first'
              : 'Click two points on the image to draw a line. Stays in draw mode until Esc / Stop.'
          }
          className="w-full px-3 py-2 bg-violet-500 hover:bg-violet-400 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-zinc-50 text-[10px] font-bold uppercase tracking-widest rounded flex items-center justify-center gap-2 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Draw Line
        </button>
      )}

      {/* "line-shape" visibility toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs">Line Shapes</span>
        <button
          type="button"
          onClick={onToggleVisible}
          disabled={total === 0}
          className={`w-8 h-4 rounded-full relative transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            state.visible ? 'bg-violet-400' : 'bg-zinc-800'
          }`}
          title={state.visible ? 'Hide line shapes overlay' : 'Show line shapes overlay'}
          aria-label="Toggle line shapes visibility"
        >
          <div
            className={`absolute top-1 left-1 w-2 h-2 rounded-full bg-[#0a0a0a] transition-transform ${
              state.visible ? 'translate-x-4' : ''
            }`}
          />
        </button>
      </div>

      {/* "Show last N" integer selector */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono opacity-60">Show last (N)</span>
          <span className="text-[10px] font-mono text-zinc-500">
            {showing} / {total}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              onChangeShowLastN(
                Math.max(LINE_SHOW_N_MIN, state.showLastN - 1),
              )
            }
            disabled={state.showLastN <= LINE_SHOW_N_MIN}
            className="px-2 py-1 border border-zinc-800 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-[10px] font-mono text-zinc-400 transition-colors"
            title="Show one fewer"
            aria-label="Decrease N"
          >
            −
          </button>
          <input
            type="number"
            min={LINE_SHOW_N_MIN}
            max={LINE_SHOW_N_MAX}
            value={state.showLastN}
            onChange={(e) => {
              const raw = parseInt(e.target.value, 10);
              if (Number.isNaN(raw)) return;
              onChangeShowLastN(
                Math.max(LINE_SHOW_N_MIN, Math.min(LINE_SHOW_N_MAX, raw)),
              );
            }}
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-zinc-100 text-center focus:outline-none focus:border-violet-500"
            title="How many of the most recently drawn lines to display"
          />
          <button
            type="button"
            onClick={() =>
              onChangeShowLastN(
                Math.min(LINE_SHOW_N_MAX, state.showLastN + 1),
              )
            }
            disabled={state.showLastN >= LINE_SHOW_N_MAX}
            className="px-2 py-1 border border-zinc-800 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-[10px] font-mono text-zinc-400 transition-colors"
            title="Show one more"
            aria-label="Increase N"
          >
            +
          </button>
          {/* Quick "all" preset — sets N to the current line count so every
              drawn line becomes visible without forcing the user to type. */}
          <button
            type="button"
            onClick={() => onChangeShowLastN(Math.max(LINE_SHOW_N_MIN, total))}
            disabled={total === 0 || state.showLastN >= total}
            className="px-2 py-1 border border-zinc-800 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-[9px] font-mono uppercase tracking-widest text-zinc-400 transition-colors"
            title="Show every drawn line"
          >
            All
          </button>
        </div>
      </div>

      {/* Maintenance row */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onUndoLast}
          disabled={total === 0}
          className="px-2 py-1.5 border border-zinc-800 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 flex items-center justify-center gap-1.5 transition-colors"
          title="Remove the most recently drawn line"
        >
          <Undo2 className="w-3 h-3" />
          Undo Last
        </button>
        <button
          type="button"
          onClick={onClearAll}
          disabled={total === 0}
          className="px-2 py-1.5 border border-zinc-800 hover:border-red-700 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-zinc-800 disabled:hover:text-zinc-300 rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 flex items-center justify-center gap-1.5 transition-colors"
          title="Delete every drawn line"
        >
          <Trash2 className="w-3 h-3" />
          Clear All
        </button>
      </div>

      {total > 0 && !state.visible && (
        <p className="text-[9px] text-zinc-600 leading-snug flex items-center gap-1">
          <EyeOff className="w-2.5 h-2.5" />
          {total} line{total === 1 ? '' : 's'} hidden — toggle to show.
        </p>
      )}
    </section>
  );
};
