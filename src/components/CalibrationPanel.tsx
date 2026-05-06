import React, { useState } from 'react';
import {
  Ruler,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Trash2,
  Undo2,
  Redo2,
  Check,
  Plus,
  FileText,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { CalibrationMode, CalibrationState, CalibrationUnit } from '../types';
import {
  formatScaleRatio,
  getActiveCalibration,
  PAPER_PRESET_UNITS,
  PAPER_SIZE_LIST,
  PaperSizeKey,
  UNIT_LABEL,
} from '../lib/calibration';

interface Props {
  state: CalibrationState;
  mode: CalibrationMode;
  /** True when there's an image loaded; calibration is meaningless without one. */
  imageLoaded: boolean;
  canUndo: boolean;
  canRedo: boolean;

  onStart: () => void;
  onCancel: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleLock: () => void;
  onToggleVisible: () => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Create a calibration from an ISO 216 paper preset, treating the entire
   *  reference image as that physical sheet. */
  onCreateFromPaperPreset: (paper: PaperSizeKey, unit: CalibrationUnit) => void;
}

/**
 * Sidebar section dedicated to the Scale Calibration tool. Houses the
 * primary "Calibrate Scale" CTA, the list of saved calibrations (with
 * select/delete), and global toggles (lock, show, undo/redo).
 */
export const CalibrationPanel: React.FC<Props> = ({
  state,
  mode,
  imageLoaded,
  canUndo,
  canRedo,
  onStart,
  onCancel,
  onSelect,
  onDelete,
  onToggleLock,
  onToggleVisible,
  onUndo,
  onRedo,
  onCreateFromPaperPreset,
}) => {
  const active = getActiveCalibration(state);
  const calibrating = mode !== 'idle';

  // Paper-preset section is collapsible to keep the sidebar tidy. Default
  // collapsed when a calibration already exists, expanded otherwise so new
  // users discover the shortcut.
  const [paperOpen, setPaperOpen] = useState(state.calibrations.length === 0);
  const [paperUnit, setPaperUnit] = useState<CalibrationUnit>('mm');
  const presetsDisabled = !imageLoaded || state.locked || calibrating;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
          Scale Calibration
        </label>
        <Ruler className="w-3 h-3 text-zinc-600" />
      </div>

      {/* Status / live ratio */}
      <div className="rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2">
        {active ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                Active
              </span>
              <span className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_currentColor]" />
                Calibrated
              </span>
            </div>
            <div className="mt-1.5 text-xs text-zinc-200 truncate" title={active.name}>
              {active.name}
            </div>
            <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
              {formatScaleRatio(active)}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
              Status
            </span>
            <span className="text-[10px] font-mono text-zinc-600">Not calibrated</span>
          </div>
        )}
      </div>

      {/* Primary CTA + cancel */}
      {calibrating ? (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2">
          <p className="text-[11px] text-emerald-300 font-medium leading-snug">
            {mode === 'placingA' && 'Click first point on the reference image.'}
            {mode === 'placingB' && 'Click second point to define the scale line.'}
            {mode === 'awaitingDistance' && 'Enter the real-world distance in the dialog.'}
          </p>
          <button
            type="button"
            onClick={onCancel}
            className="w-full px-3 py-2 border border-zinc-700 hover:border-zinc-500 rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 hover:text-zinc-100 transition-colors"
          >
            Cancel calibration
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onStart}
          disabled={!imageLoaded || state.locked}
          title={
            !imageLoaded
              ? 'Upload a reference image first'
              : state.locked
              ? 'Scale is locked — unlock to recalibrate'
              : 'Click two points on the image to define a real-world distance'
          }
          className="w-full px-3 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-zinc-950 text-[10px] font-bold uppercase tracking-widest rounded flex items-center justify-center gap-2 transition-colors"
        >
          <Ruler className="w-3 h-3" />
          {state.calibrations.length > 0 ? 'Add Calibration' : 'Calibrate Scale'}
        </button>
      )}

      {/* Toggles row */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onToggleLock}
          disabled={!active}
          title={state.locked ? 'Unlock scale' : 'Lock scale'}
          className="px-2 py-1.5 border border-zinc-800 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 flex items-center justify-center gap-1.5 transition-colors"
        >
          {state.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
          {state.locked ? 'Locked' : 'Lock'}
        </button>
        <button
          type="button"
          onClick={onToggleVisible}
          disabled={!active}
          title={state.visible ? 'Hide overlay' : 'Show overlay'}
          className="px-2 py-1.5 border border-zinc-800 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 flex items-center justify-center gap-1.5 transition-colors"
        >
          {state.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          {state.visible ? 'Shown' : 'Hidden'}
        </button>
      </div>

      {/* Undo/redo row */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo last calibration change (Ctrl/Cmd+Z)"
          className="px-2 py-1.5 border border-zinc-800 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 flex items-center justify-center gap-1.5 transition-colors"
        >
          <Undo2 className="w-3 h-3" />
          Undo
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl/Cmd+Shift+Z)"
          className="px-2 py-1.5 border border-zinc-800 hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 flex items-center justify-center gap-1.5 transition-colors"
        >
          <Redo2 className="w-3 h-3" />
          Redo
        </button>
      </div>

      {/* Paper-size preset shortcut. Treats the full image as the chosen
          ISO 216 sheet — orientation auto-detected from aspect ratio. */}
      <div className="rounded border border-zinc-800 bg-zinc-950/40 overflow-hidden">
        <button
          type="button"
          onClick={() => setPaperOpen((v) => !v)}
          className="w-full px-2.5 py-2 flex items-center justify-between text-left hover:bg-zinc-900/40 transition-colors"
          title="Calibrate by treating the image as a standard A-series paper size"
        >
          <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-zinc-400">
            <FileText className="w-3 h-3" />
            Paper Preset
          </span>
          {paperOpen ? (
            <ChevronDown className="w-3 h-3 text-zinc-500" />
          ) : (
            <ChevronRight className="w-3 h-3 text-zinc-500" />
          )}
        </button>

        {paperOpen && (
          <div className="px-2.5 pb-2.5 pt-1 space-y-2 border-t border-zinc-800/80">
            <p className="text-[9px] text-zinc-600 leading-snug">
              Picks ISO 216 dimensions assuming the image fills the sheet.
              Orientation is auto-detected from the aspect ratio.
            </p>

            {/* Unit toggle: mm / cm / in (px excluded for paper) */}
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mr-1">
                Unit
              </span>
              {PAPER_PRESET_UNITS.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setPaperUnit(u)}
                  disabled={presetsDisabled}
                  className={`flex-1 py-1 text-[9px] font-mono uppercase tracking-widest rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    paperUnit === u
                      ? 'bg-zinc-200 text-zinc-950 border-zinc-200'
                      : 'bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-700'
                  }`}
                  title={`Store calibration in ${UNIT_LABEL[u]}`}
                >
                  {UNIT_LABEL[u]}
                </button>
              ))}
            </div>

            {/* Size grid */}
            <div className="grid grid-cols-3 gap-1">
              {PAPER_SIZE_LIST.map((p) => {
                const widthLabel = p.shortMm;
                const heightLabel = p.longMm;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => onCreateFromPaperPreset(p.key, paperUnit)}
                    disabled={presetsDisabled}
                    title={`Calibrate as ${p.label} (${widthLabel} × ${heightLabel} mm). Orientation will follow the image's aspect ratio.`}
                    className="group flex flex-col items-start gap-0.5 px-2 py-1.5 rounded border border-zinc-800 hover:border-emerald-500/60 hover:bg-emerald-500/5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-zinc-800 disabled:hover:bg-transparent transition-colors text-left"
                  >
                    <span className="text-[11px] font-mono font-bold text-zinc-200 group-hover:text-emerald-300 group-disabled:text-zinc-200">
                      {p.label}
                    </span>
                    <span className="text-[9px] font-mono text-zinc-500 leading-none">
                      {widthLabel}×{heightLabel}mm
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Saved calibration list */}
      {state.calibrations.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
              Saved ({state.calibrations.length})
            </span>
            {!state.locked && !calibrating && (
              <button
                type="button"
                onClick={onStart}
                disabled={!imageLoaded}
                title="Add another calibration"
                className="text-zinc-500 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            )}
          </div>
          <ul className="space-y-1">
            {state.calibrations
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((c) => {
                const isActive = c.id === state.activeId;
                return (
                  <li key={c.id}>
                    <div
                      className={`group flex items-center gap-2 rounded px-2 py-1.5 border transition-colors ${
                        isActive
                          ? 'bg-emerald-500/10 border-emerald-500/40'
                          : 'bg-transparent border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(c.id)}
                        className="flex-1 min-w-0 text-left flex items-center gap-2"
                        title="Activate this calibration"
                      >
                        <span
                          className={`w-3 h-3 flex items-center justify-center rounded-sm border transition-colors ${
                            isActive
                              ? 'border-emerald-400 bg-emerald-400 text-zinc-950'
                              : 'border-zinc-700 text-transparent'
                          }`}
                        >
                          <Check className="w-2.5 h-2.5" />
                        </span>
                        <span className="flex-1 min-w-0">
                          <div
                            className={`text-xs truncate ${
                              isActive ? 'text-zinc-100' : 'text-zinc-300'
                            }`}
                          >
                            {c.name}
                          </div>
                          <div className="text-[9px] font-mono text-zinc-500 truncate">
                            {formatScaleRatio(c)}
                          </div>
                        </span>
                      </button>
                      {!state.locked && (
                        <button
                          type="button"
                          onClick={() => onDelete(c.id)}
                          title="Delete calibration"
                          className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-all"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </section>
  );
};
