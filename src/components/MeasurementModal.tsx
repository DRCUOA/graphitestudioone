import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Tag, X } from 'lucide-react';
import { Calibration, CalibrationPoint } from '../types';
import {
  distance,
  formatMeasurement,
  pxToUnits,
} from '../lib/calibration';

interface Props {
  open: boolean;
  pointA: CalibrationPoint | null;
  pointB: CalibrationPoint | null;
  /** Active calibration so we can show the real-world distance live. */
  calibration: Calibration | null;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

/**
 * Asks the user to name a freshly-placed measurement marker. Distance is
 * derived from the two points + active calibration; the user only provides
 * an identifier (e.g. "Left pupil → right nipple").
 */
export const MeasurementModal: React.FC<Props> = ({
  open,
  pointA,
  pointB,
  calibration,
  onConfirm,
  onCancel,
}) => {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const distanceLabel = useMemo(() => {
    if (!pointA || !pointB) return null;
    const px = distance(pointA, pointB);
    const { value, unit } = pxToUnits(px, calibration);
    if (unit === 'px') return `${px.toFixed(1)} px`;
    return formatMeasurement(value, unit);
  }, [pointA, pointB, calibration]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(name.trim() || 'Measurement');
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <Tag className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-50">Name Measurement</h2>
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                Step 3 of 3 · Identify this marker
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
            aria-label="Cancel measurement"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <p className="text-xs text-zinc-400 leading-relaxed">
            Give this measurement a memorable name so you can spot it on the
            reference later.
          </p>

          {distanceLabel && (
            <div className="rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2 flex items-center justify-between">
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                Distance
              </span>
              <span className="text-xs font-mono text-amber-300">
                {distanceLabel}
              </span>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block">
              Marker name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='e.g. "Left pupil → right nipple"'
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-amber-500"
              autoComplete="off"
            />
          </div>
        </div>

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
            className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-[11px] font-bold uppercase tracking-widest rounded transition-colors"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
};
