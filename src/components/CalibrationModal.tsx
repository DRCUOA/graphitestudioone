import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ruler, X } from 'lucide-react';
import {
  CalibrationPoint,
  CalibrationUnit,
} from '../types';
import { distance, UNIT_FULL_NAME } from '../lib/calibration';

const UNITS: CalibrationUnit[] = ['mm', 'cm', 'in', 'px'];

interface Props {
  open: boolean;
  pointA: CalibrationPoint | null;
  pointB: CalibrationPoint | null;
  /** Default unit pre-selected in the dropdown — usually the unit of the
   *  currently-active calibration so users don't have to re-pick it. */
  defaultUnit?: CalibrationUnit;
  onConfirm: (input: {
    realDistance: number;
    unit: CalibrationUnit;
    name: string;
  }) => void;
  onCancel: () => void;
}

/**
 * Modal that asks the user "what is the real distance between these two
 * points?" once both calibration points have been placed. Submitting it is
 * what actually creates the Calibration record on the project.
 */
export const CalibrationModal: React.FC<Props> = ({
  open,
  pointA,
  pointB,
  defaultUnit = 'cm',
  onConfirm,
  onCancel,
}) => {
  const [distanceStr, setDistanceStr] = useState('');
  const [unit, setUnit] = useState<CalibrationUnit>(defaultUnit);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset form whenever the modal (re-)opens so stale values don't leak.
  useEffect(() => {
    if (open) {
      setDistanceStr('');
      setName('');
      setUnit(defaultUnit);
      // Auto-focus the most important field after mount.
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open, defaultUnit]);

  // Esc closes the modal everywhere.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const pixelDistance = useMemo(() => {
    if (!pointA || !pointB) return 0;
    return distance(pointA, pointB);
  }, [pointA, pointB]);

  const numericDistance = parseFloat(distanceStr);
  const isValid = !isNaN(numericDistance) && numericDistance > 0;

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    onConfirm({
      realDistance: numericDistance,
      unit,
      name: name.trim(),
    });
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onCancel}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <Ruler className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-50">Define Reference Scale</h2>
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                Step 3 of 3 · Real-world distance
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
            aria-label="Cancel calibration"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          <p className="text-xs text-zinc-400 leading-relaxed">
            What is the real-world distance between the two points you placed?
            This calibrates every ruler, grid, and measurement tool to your
            paper.
          </p>

          <div className="rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2 flex items-center justify-between">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
              Pixel distance
            </span>
            <span className="text-xs font-mono text-zinc-200">
              {pixelDistance.toFixed(2)} px
            </span>
          </div>

          {/* Distance + unit row */}
          <div className="space-y-2">
            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block">
              Real distance
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="number"
                step="any"
                min="0"
                value={distanceStr}
                onChange={(e) => setDistanceStr(e.target.value)}
                placeholder="e.g. 5"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm font-mono text-zinc-100 focus:outline-none focus:border-emerald-500"
                inputMode="decimal"
                autoComplete="off"
              />
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as CalibrationUnit)}
                className="bg-zinc-950 border border-zinc-800 rounded px-2 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-emerald-500 appearance-none cursor-pointer"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_FULL_NAME[u]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Optional name */}
          <div className="space-y-2">
            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block">
              Name <span className="text-zinc-700">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='e.g. "A4 Full Height" or "Portrait Head"'
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zinc-800 bg-zinc-950/40">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-[11px] font-mono uppercase tracking-widest text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid}
            className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-zinc-950 text-[11px] font-bold uppercase tracking-widest rounded transition-colors"
          >
            Set scale
          </button>
        </div>
      </form>
    </div>
  );
};
