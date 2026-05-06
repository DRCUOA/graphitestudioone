import { CalibrationPoint, DrawnLine, LineState } from '../types';

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

export const createLine = (
  pointA: CalibrationPoint,
  pointB: CalibrationPoint,
): DrawnLine => ({
  id:
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `line_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  pointA: { ...pointA },
  pointB: { ...pointB },
  createdAt: Date.now(),
});

/** Min/max bounds for the "Show last N" integer selector. */
export const LINE_SHOW_N_MIN = 1;
export const LINE_SHOW_N_MAX = 999;

/**
 * Filter the visible subset for rendering: most recent N lines, in
 * chronological order. Returns an empty array when the state is hidden.
 */
export const visibleLines = (state: LineState): DrawnLine[] => {
  if (!state.visible || state.lines.length === 0) return [];
  const n = Math.max(LINE_SHOW_N_MIN, Math.min(LINE_SHOW_N_MAX, state.showLastN));
  return state.lines.slice(-n);
};

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = 'graphite-project-lines-v1';

export const emptyLineState = (): LineState => ({
  lines: [],
  visible: true,
  showLastN: 5,
});

export const loadLineState = (): LineState => {
  if (typeof window === 'undefined') return emptyLineState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyLineState();
    const parsed = JSON.parse(raw) as Partial<LineState>;
    return {
      lines: Array.isArray(parsed.lines) ? parsed.lines : [],
      visible: parsed.visible ?? true,
      showLastN:
        typeof parsed.showLastN === 'number'
          ? Math.max(LINE_SHOW_N_MIN, Math.min(LINE_SHOW_N_MAX, parsed.showLastN))
          : 5,
    };
  } catch {
    return emptyLineState();
  }
};

export const saveLineState = (state: LineState): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort persistence — drop silently on quota errors.
  }
};
