import React from 'react';
import {
  PenLine,
  Pencil,
  Eraser,
  Activity,
  EyeOff,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { FreeLineMode, FreeLineState } from '../types';
import {
  ERASER_MAX,
  ERASER_MIN,
  FREELINE_SHOW_N_MAX,
  FREELINE_SHOW_N_MIN,
} from '../lib/freeLines';

/* -------------------------------------------------------------------------- */
/* Props                                                                      */
/* -------------------------------------------------------------------------- */

interface Props {
  state: FreeLineState;
  mode: FreeLineMode;
  imageLoaded: boolean;

  onStartDraw: () => void;
  onStartErase: () => void;
  onStop: () => void;
  onToggleVisible: () => void;
  onChangeShowLastN: (n: number) => void;
  onChangeStrokeWidth: (w: number) => void;
  onChangeColor: (hex: string) => void;
  onTogglePressure: () => void;
  onChangeEraserSize: (n: number) => void;
  onUndoLast: () => void;
  onClearAll: () => void;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Sidebar section for the freehand "Free Draw" tool. Three modes
 * (idle / drawing / erasing) plus pressure-response toggle and eraser
 * brush size. Layout mirrors LinePanel for visual consistency.
 */
export const FreeLinePanel: React.FC<Props> = ({
  state,
  mode,
  imageLoaded,
  onStartDraw,
  onStartErase,
  onStop,
  onToggleVisible,
  onChangeShowLastN,
  onChangeStrokeWidth,
  onChangeColor,
  onTogglePressure,
  onChangeEraserSize,
  onUndoLast,
  onClearAll,
}) => {
  const drawing = mode === 'drawing';
  const erasing = mode === 'erasing';
  const total = state.strokes.length;
  const showing = state.visible
    ? Math.min(total, Math.max(FREELINE_SHOW_N_MIN, state.showLastN))
    : 0;

  const SWATCHES = ['#fb7185', '#f59e0b', '#22d3ee', '#a3e635', '#a78bfa', '#ffffff', '#000000'];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
          Free Draw
        </label>
        <PenLine className="w-3 h-3 text-zinc-600" />
      </div>

      {/* ----------------- Mode CTAs ----------------- */}
      {drawing ? (
        <div className="rounded border border-rose-500/40 bg-rose-500/5 p-3 space-y-2">
          <p className="text-[11px] text-rose-300 font-medium leading-snug">
            Click and drag to sketch.
          </p>
          <p className="text-[9px] text-rose-300/60 leading-snug">
            Continuous mode — release to commit, drag again for the next
            stroke. {state.pressureEnabled
              ? 'Pressure adapts width: slower / firmer = darker.'
              : 'Pressure response is OFF — flat lines.'} Press Esc or Stop to exit.
          </p>
          <button
            type="button"
            onClick={onStop}
            className="w-full px-3 py-2 border border-zinc-700 hover:border-zinc-500 rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 hover:text-zinc-100 transition-colors"
          >
            Stop drawing
          </button>
        </div>
      ) : erasing ? (
        <div className="rounded border border-rose-500/40 bg-rose-500/5 p-3 space-y-2">
          <p className="text-[11px] text-rose-300 font-medium leading-snug">
            Drag the eraser circle over strokes to remove them.
          </p>
          <p className="text-[9px] text-rose-300/60 leading-snug">
            Whole strokes are removed at a time — like lifting marks with
            a kneaded eraser. Press Esc or Stop to exit.
          </p>
          <button
            type="button"
            onClick={onStop}
            className="w-full px-3 py-2 border border-zinc-700 hover:border-zinc-500 rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 hover:text-zinc-100 transition-colors"
          >
            Stop erasing
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onStartDraw}
            disabled={!imageLoaded}
            title={
              !imageLoaded
                ? 'Upload a reference image first'
                : 'Drag to sketch freeform strokes. Continuous draw mode until Esc / Stop.'
            }
            className="px-3 py-2 bg-rose-500 hover:bg-rose-400 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-zinc-50 text-[10px] font-bold uppercase tracking-widest rounded flex items-center justify-center gap-1.5 transition-colors"
          >
            <Pencil className="w-3 h-3" />
            Draw
          </button>
          <button
            type="button"
            onClick={onStartErase}
            disabled={!imageLoaded || total === 0}
            title={
              !imageLoaded
                ? 'Upload a reference image first'
                : total === 0
                  ? 'Nothing to erase yet'
                  : 'Drag the brush over strokes to lift them off.'
            }
            className="px-3 py-2 border border-rose-500/60 hover:bg-rose-500/10 disabled:border-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-rose-300 text-[10px] font-bold uppercase tracking-widest rounded flex items-center justify-center gap-1.5 transition-colors"
          >
            <Eraser className="w-3 h-3" />
            Erase
          </button>
        </div>
      )}

      {/* ----------------- Visibility ----------------- */}
      <div className="flex items-center justify-between">
        <span className="text-xs">Free strokes</span>
        <button
          type="button"
          onClick={onToggleVisible}
          disabled={total === 0}
          className={`w-8 h-4 rounded-full relative transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            state.visible ? 'bg-rose-400' : 'bg-zinc-800'
          }`}
          title={state.visible ? 'Hide free-draw overlay' : 'Show free-draw overlay'}
          aria-label="Toggle free-draw visibility"
        >
          <div
            className={`absolute top-1 left-1 w-2 h-2 rounded-full bg-[#0a0a0a] transition-transform ${
              state.visible ? 'translate-x-4' : ''
            }`}
          />
        </button>
      </div>

      {/* ----------------- Pressure response ----------------- */}
      <div className="flex items-center justify-between">
        <span className="text-xs flex items-center gap-1.5">
          <Activity className="w-3 h-3 opacity-60" />
          Pressure response
        </span>
        <button
          type="button"
          onClick={onTogglePressure}
          className={`w-8 h-4 rounded-full relative transition-colors ${
            state.pressureEnabled ? 'bg-rose-400' : 'bg-zinc-800'
          }`}
          title={
            state.pressureEnabled
              ? 'Tablet pressure / velocity simulation ON — strokes taper like a real pencil.'
              : 'Pressure response OFF — flat constant-width strokes.'
          }
          aria-label="Toggle pressure response"
        >
          <div
            className={`absolute top-1 left-1 w-2 h-2 rounded-full bg-[#0a0a0a] transition-transform ${
              state.pressureEnabled ? 'translate-x-4' : ''
            }`}
          />
        </button>
      </div>

      {/* ----------------- Stroke width ----------------- */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono opacity-60">Stroke width</span>
          <span className="text-[10px] font-mono">{state.strokeWidth.toFixed(1)}×</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={10}
          step={0.5}
          value={state.strokeWidth}
          onChange={(e) => onChangeStrokeWidth(parseFloat(e.target.value))}
          className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-rose-400"
          title="Default maximum stroke weight (pressure scales each sample below this)."
        />
      </div>

      {/* ----------------- Eraser size ----------------- */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono opacity-60">Eraser size</span>
          <span className="text-[10px] font-mono">{Math.round(state.eraserSize)} px</span>
        </div>
        <input
          type="range"
          min={ERASER_MIN}
          max={ERASER_MAX}
          step={1}
          value={state.eraserSize}
          onChange={(e) => onChangeEraserSize(parseFloat(e.target.value))}
          className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-rose-400"
          title="Brush radius for the Erase tool. Larger = remove more strokes per pass."
        />
      </div>

      {/* ----------------- Stroke colour ----------------- */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono opacity-60">Colour</span>
          <span className="text-[10px] font-mono uppercase">{state.color}</span>
        </div>
        <div className="flex items-center gap-2">
          <label
            className="relative w-7 h-7 rounded border border-zinc-800 hover:border-zinc-600 transition-colors cursor-pointer overflow-hidden flex-shrink-0"
            title="Pick any colour for new strokes"
            style={{ backgroundColor: state.color }}
          >
            <input
              type="color"
              value={state.color}
              onChange={(e) => onChangeColor(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>
          <div className="flex items-center gap-1 flex-1 flex-wrap">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChangeColor(c)}
                className={`w-4 h-4 rounded-sm border transition-all ${
                  state.color.toLowerCase() === c.toLowerCase()
                    ? 'border-zinc-200 scale-110'
                    : 'border-zinc-700 hover:border-zinc-500'
                }`}
                style={{ backgroundColor: c }}
                title={`Set stroke colour to ${c}`}
                aria-label={`Set stroke colour to ${c}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ----------------- Show-last-N ----------------- */}
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
              onChangeShowLastN(Math.max(FREELINE_SHOW_N_MIN, state.showLastN - 1))
            }
            disabled={state.showLastN <= FREELINE_SHOW_N_MIN}
            className="px-2 py-1 border border-zinc-800 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-[10px] font-mono text-zinc-400 transition-colors"
            title="Show one fewer"
            aria-label="Decrease N"
          >
            −
          </button>
          <input
            type="number"
            min={FREELINE_SHOW_N_MIN}
            max={FREELINE_SHOW_N_MAX}
            value={state.showLastN}
            onChange={(e) => {
              const raw = parseInt(e.target.value, 10);
              if (Number.isNaN(raw)) return;
              onChangeShowLastN(
                Math.max(FREELINE_SHOW_N_MIN, Math.min(FREELINE_SHOW_N_MAX, raw)),
              );
            }}
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-zinc-100 text-center focus:outline-none focus:border-rose-500"
            title="How many of the most recently drawn strokes to display"
          />
          <button
            type="button"
            onClick={() =>
              onChangeShowLastN(Math.min(FREELINE_SHOW_N_MAX, state.showLastN + 1))
            }
            disabled={state.showLastN >= FREELINE_SHOW_N_MAX}
            className="px-2 py-1 border border-zinc-800 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-[10px] font-mono text-zinc-400 transition-colors"
            title="Show one more"
            aria-label="Increase N"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => onChangeShowLastN(Math.max(FREELINE_SHOW_N_MIN, total))}
            disabled={total === 0 || state.showLastN >= total}
            className="px-2 py-1 border border-zinc-800 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-[9px] font-mono uppercase tracking-widest text-zinc-400 transition-colors"
            title="Show every drawn stroke"
          >
            All
          </button>
        </div>
      </div>

      {/* ----------------- Maintenance ----------------- */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onUndoLast}
          disabled={total === 0}
          className="px-2 py-1.5 border border-zinc-800 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 flex items-center justify-center gap-1.5 transition-colors"
          title="Remove the most recently drawn stroke"
        >
          <Undo2 className="w-3 h-3" />
          Undo Last
        </button>
        <button
          type="button"
          onClick={onClearAll}
          disabled={total === 0}
          className="px-2 py-1.5 border border-zinc-800 hover:border-red-700 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-zinc-800 disabled:hover:text-zinc-300 rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 flex items-center justify-center gap-1.5 transition-colors"
          title="Delete every drawn stroke"
        >
          <Trash2 className="w-3 h-3" />
          Clear All
        </button>
      </div>

      {total > 0 && !state.visible && (
        <p className="text-[9px] text-zinc-600 leading-snug flex items-center gap-1">
          <EyeOff className="w-2.5 h-2.5" />
          {total} stroke{total === 1 ? '' : 's'} hidden — toggle to show.
        </p>
      )}
    </section>
  );
};
