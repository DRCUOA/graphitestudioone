import { CalibrationPoint, Measurement, MeasurementState } from '../types';

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

export const createMeasurement = (input: {
  name: string;
  pointA: CalibrationPoint;
  pointB: CalibrationPoint;
}): Measurement => ({
  id:
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `mea_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  name: input.name.trim() || 'Untitled measurement',
  pointA: { ...input.pointA },
  pointB: { ...input.pointB },
  visible: true,
  createdAt: Date.now(),
});

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = 'graphite-project-measurements-v1';

export const emptyMeasurementState = (): MeasurementState => ({
  measurements: [],
  showAll: true,
});

export const loadMeasurementState = (): MeasurementState => {
  if (typeof window === 'undefined') return emptyMeasurementState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyMeasurementState();
    const parsed = JSON.parse(raw) as Partial<MeasurementState>;
    return {
      measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
      showAll: parsed.showAll ?? true,
    };
  } catch {
    // Corrupt storage — start fresh rather than crash.
    return emptyMeasurementState();
  }
};

export const saveMeasurementState = (state: MeasurementState): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota / private-mode failures — purely best-effort.
  }
};
