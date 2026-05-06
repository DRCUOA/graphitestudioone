import React from 'react';
import {
  Tag,
  Plus,
  Eye,
  EyeOff,
  Trash2,
} from 'lucide-react';
import {
  Calibration,
  Measurement,
  MeasurementMode,
  MeasurementState,
} from '../types';
import {
  distance,
  formatMeasurement,
  pxToUnits,
} from '../lib/calibration';

interface Props {
  state: MeasurementState;
  mode: MeasurementMode;
  /** Active calibration is required to display real-world distances. */
  calibration: Calibration | null;
  imageLoaded: boolean;
  /** Calibration must exist before measurements are meaningful. */
  calibrationExists: boolean;

  onStart: () => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onToggleMarkerVisible: (id: string) => void;
  onToggleShowAll: () => void;
}

/**
 * Sidebar section for managing custom measurement markers (e.g. "Left
 * pupil → right nipple"). Mirrors the layout patterns of CalibrationPanel
 * so the two read as siblings.
 */
export const MeasurementPanel: React.FC<Props> = ({
  state,
  mode,
  calibration,
  imageLoaded,
  calibrationExists,
  onStart,
  onCancel,
  onDelete,
  onToggleMarkerVisible,
  onToggleShowAll,
}) => {
  const placing = mode !== 'idle';
  const canStart = imageLoaded && calibrationExists && !placing;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
          Measurements
        </label>
        <Tag className="w-3 h-3 text-zinc-600" />
      </div>

      {/* CTA / status banner */}
      {placing ? (
        <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
          <p className="text-[11px] text-amber-300 font-medium leading-snug">
            {mode === 'placingA' && 'Click first point of the measurement.'}
            {mode === 'placingB' && 'Click second point to define the line.'}
            {mode === 'awaitingName' && 'Name this measurement in the dialog.'}
          </p>
          <button
            type="button"
            onClick={onCancel}
            className="w-full px-3 py-2 border border-zinc-700 hover:border-zinc-500 rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 hover:text-zinc-100 transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onStart}
          disabled={!canStart}
          title={
            !imageLoaded
              ? 'Upload a reference image first'
              : !calibrationExists
              ? 'Calibrate scale before adding measurements'
              : 'Click two points to add a named measurement'
          }
          className="w-full px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-zinc-950 text-[10px] font-bold uppercase tracking-widest rounded flex items-center justify-center gap-2 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add Measurement
        </button>
      )}

      {/* Master visibility toggle */}
      {state.measurements.length > 0 && (
        <button
          type="button"
          onClick={onToggleShowAll}
          className="w-full px-2 py-1.5 border border-zinc-800 hover:border-zinc-600 rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 flex items-center justify-center gap-1.5 transition-colors"
          title={state.showAll ? 'Hide all measurement markers' : 'Show all measurement markers'}
        >
          {state.showAll ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          {state.showAll ? 'Markers Shown' : 'Markers Hidden'}
        </button>
      )}

      {/* List */}
      {state.measurements.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
            Saved ({state.measurements.length})
          </div>
          <ul className="space-y-1">
            {state.measurements
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((m) => (
                <MeasurementRow
                  key={m.id}
                  m={m}
                  calibration={calibration}
                  showAll={state.showAll}
                  onToggleVisible={() => onToggleMarkerVisible(m.id)}
                  onDelete={() => onDelete(m.id)}
                />
              ))}
          </ul>
        </div>
      )}

      {!calibrationExists && state.measurements.length === 0 && (
        <p className="text-[9px] text-zinc-600 leading-snug">
          Calibrate the scale first — measurements display distances in
          your chosen real-world unit (cm, mm, in).
        </p>
      )}
    </section>
  );
};

/* -------------------------------------------------------------------------- */
/* Sub-component                                                              */
/* -------------------------------------------------------------------------- */

interface RowProps {
  m: Measurement;
  calibration: Calibration | null;
  showAll: boolean;
  onToggleVisible: () => void;
  onDelete: () => void;
}

const MeasurementRow: React.FC<RowProps> = ({
  m,
  calibration,
  showAll,
  onToggleVisible,
  onDelete,
}) => {
  const px = distance(m.pointA, m.pointB);
  const { value, unit } = pxToUnits(px, calibration);
  const distanceLabel = unit === 'px'
    ? `${px.toFixed(1)} px`
    : formatMeasurement(value, unit);
  const dimmed = !showAll || !m.visible;

  return (
    <li>
      <div
        className={`group flex items-center gap-2 rounded px-2 py-1.5 border transition-colors ${
          dimmed
            ? 'bg-transparent border-zinc-800 opacity-50'
            : 'bg-amber-500/5 border-amber-500/30'
        }`}
      >
        <button
          type="button"
          onClick={onToggleVisible}
          className="text-zinc-500 hover:text-amber-300 transition-colors"
          title={m.visible ? 'Hide marker' : 'Show marker'}
        >
          {m.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-zinc-200 truncate" title={m.name}>
            {m.name}
          </div>
          <div className="text-[9px] font-mono text-zinc-500">
            {distanceLabel}
          </div>
        </div>
        <button
          type="button"
          onClick={onDelete}
          title="Delete measurement"
          className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-all"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </li>
  );
};
