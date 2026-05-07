/* -------------------------------------------------------------------------- */
/* IndexedDB wrapper — minimal, promise-based.                                */
/*                                                                            */
/* Two object stores keep picker reads fast even when projects contain large  */
/* (multi-MB) reference image data URLs:                                      */
/*   • `projects`     — small ProjectMeta records (id, name, dates, thumb)    */
/*   • `project_data` — heavy ProjectData blobs, one per project id           */
/*                                                                            */
/* Storing the metadata separately means listProjects() reads only kilobytes  */
/* even with dozens of saved projects. The full ProjectData is fetched lazily */
/* when a project is actually opened.                                         */
/* -------------------------------------------------------------------------- */

import type { Project, ProjectData, ProjectMeta } from '../types';
import { emptyCalibrationState } from './calibration';
import { emptyMeasurementState } from './measurement';
import { emptyLineState } from './lines';
import { emptyFreeLineState } from './freeLines';
import { emptyTraceAssist } from './edges';

const DB_NAME = 'graphite-studio';
const DB_VERSION = 1;
export const STORE_META = 'projects';
export const STORE_DATA = 'project_data';

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open (or upgrade) the database. Cached so repeated calls share a single
 * connection — IDB connections are cheap but reusing one avoids the
 * upgrade race conditions that come with parallel openers.
 */
export const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this environment.'));
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_DATA)) {
        db.createObjectStore(STORE_DATA, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // If something elsewhere requests an upgrade, surface it instead of
      // hanging — defensive guard, single-tab usage is the common case.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
  return dbPromise;
};

/* -------------------------------------------------------------------------- */
/* Low-level transaction helpers                                              */
/* -------------------------------------------------------------------------- */

/** Wrap an IDBRequest in a promise. */
const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

/* -------------------------------------------------------------------------- */
/* Project store API                                                          */
/* -------------------------------------------------------------------------- */

/**
 * List all projects (metadata only). Sorted newest-edited first so the
 * picker tile order tracks how recently each was touched.
 */
export const dbListProjects = async (): Promise<ProjectMeta[]> => {
  const db = await openDB();
  const tx = db.transaction(STORE_META, 'readonly');
  const store = tx.objectStore(STORE_META);
  const all = await wrap(store.getAll() as IDBRequest<ProjectMeta[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
};

/** Fetch a full project (metadata + data). Returns null if not found. */
export const dbGetProject = async (id: string): Promise<Project | null> => {
  const db = await openDB();
  const tx = db.transaction([STORE_META, STORE_DATA], 'readonly');
  const meta = await wrap(
    tx.objectStore(STORE_META).get(id) as IDBRequest<ProjectMeta | undefined>,
  );
  if (!meta) return null;
  const dataRow = await wrap(
    tx.objectStore(STORE_DATA).get(id) as IDBRequest<{ id: string; data: ProjectData } | undefined>,
  );
  // It's legal to have a meta row with no data row (freshly-created
  // project that was never autosaved). Treat as empty data. Also pass
  // existing data through `normaliseProjectData` so projects saved
  // before a field existed don't crash the editor on open.
  return { ...meta, data: normaliseProjectData(dataRow?.data) };
};

/**
 * Create or fully overwrite a project. Both the metadata and data rows
 * are written in a single transaction so they can never desync.
 */
export const dbPutProject = async (project: Project): Promise<void> => {
  const db = await openDB();
  const tx = db.transaction([STORE_META, STORE_DATA], 'readwrite');
  const meta: ProjectMeta = {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    thumbnail: project.thumbnail,
  };
  tx.objectStore(STORE_META).put(meta);
  tx.objectStore(STORE_DATA).put({ id: project.id, data: project.data });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save project'));
    tx.onabort = () => reject(tx.error ?? new Error('Save transaction aborted'));
  });
};

/**
 * Update only the lightweight metadata (no data write). Used for rename.
 */
export const dbPutProjectMeta = async (meta: ProjectMeta): Promise<void> => {
  const db = await openDB();
  const tx = db.transaction(STORE_META, 'readwrite');
  tx.objectStore(STORE_META).put(meta);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to update project metadata'));
  });
};

/** Delete both rows (meta + data) for a project id. */
export const dbDeleteProject = async (id: string): Promise<void> => {
  const db = await openDB();
  const tx = db.transaction([STORE_META, STORE_DATA], 'readwrite');
  tx.objectStore(STORE_META).delete(id);
  tx.objectStore(STORE_DATA).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete project'));
  });
};

/* -------------------------------------------------------------------------- */
/* Empty payload factory                                                      */
/*                                                                            */
/* Defined here (rather than projects.ts) so the storage layer can sanitise   */
/* missing/incomplete data rows without pulling the whole project service in. */
/* -------------------------------------------------------------------------- */

export const createEmptyProjectData = (): ProjectData => ({
  image: null,
  originalImage: null,
  overlayImage: null,
  layers: [
    { id: 'camera', name: 'Camera Overlay', visible: false, opacity: 0.5 },
    { id: 'overlay', name: 'Overlay Image', visible: false, opacity: 0.5 },
    { id: 'grid', name: 'Grid Overlay', visible: false, opacity: 0.3 },
    { id: 'analysis', name: 'Analysis Layer', visible: true, opacity: 1 },
    { id: 'reference', name: 'Base Reference', visible: true, opacity: 1 },
  ],
  grid: {
    enabled: false,
    rows: 4,
    cols: 4,
    color: '#ffffff',
    opacity: 0.3,
    thickness: 1,
    lineStyle: 'solid',
  },
  assistant: {
    grayscale: true,
    posterize: false,
    posterizeLevels: 5,
    highlightGrades: [],
    contrast: 0,
    brightness: 0,
    edges: false,
    invert: false,
    notan: false,
    notanThreshold: 128,
  },
  spotlight: { enabled: false, size: 200, zoom: 2, x: 0, y: 0 },
  overlayFit: 'contain',
  calibration: emptyCalibrationState(),
  measurement: emptyMeasurementState(),
  lineState: emptyLineState(),
  freeLineState: emptyFreeLineState(),
  traceAssist: emptyTraceAssist(),
});

/**
 * Forward-compatible normaliser. Older project records (saved before a
 * field existed) get an empty default for any missing slice so the
 * editor never receives an `undefined` where it expects a state object.
 *
 * Apply this at every trust boundary where ProjectData is read back from
 * disk — see `loadProject` and the session-draft loader.
 */
export const normaliseProjectData = (raw: Partial<ProjectData> | null | undefined): ProjectData => {
  const defaults = createEmptyProjectData();
  if (!raw || typeof raw !== 'object') return defaults;
  return {
    ...defaults,
    ...raw,
    // Nested state objects need explicit fallback — `...raw` would
    // otherwise overwrite the default with `undefined` if the field is
    // missing.
    layers: Array.isArray(raw.layers) && raw.layers.length > 0 ? raw.layers : defaults.layers,
    grid: { ...defaults.grid, ...(raw.grid ?? {}) },
    assistant: normaliseAssistantSettings(raw.assistant, defaults.assistant),
    spotlight: { ...defaults.spotlight, ...(raw.spotlight ?? {}) },
    calibration: raw.calibration ?? defaults.calibration,
    measurement: raw.measurement ?? defaults.measurement,
    lineState: raw.lineState ?? defaults.lineState,
    freeLineState: normaliseFreeLineState(raw.freeLineState, defaults.freeLineState),
    traceAssist: normaliseTraceAssist(raw.traceAssist, defaults.traceAssist),
  };
};

/**
 * Tonal-mapping selections moved from a single string field
 * (`highlightGrade: PencilGrade | 'NONE'`) to an array
 * (`highlightGrades: PencilGrade[]`) when cumulative selection landed.
 * Old projects keep their stored intent: `'NONE'` becomes `[]`, any
 * single grade becomes `[grade]`. Fields not relevant to this migration
 * fall through unchanged with a default-fill.
 */
const normaliseAssistantSettings = (
  raw: unknown,
  defaults: ProjectData['assistant'],
): ProjectData['assistant'] => {
  if (!raw || typeof raw !== 'object') return defaults;
  // Pull off the legacy `highlightGrade` field separately so it doesn't
  // ride along into the returned object via spread. The current type
  // doesn't declare it, so destructuring is the cleanest way to drop it.
  const { highlightGrade, highlightGrades, ...rest } = raw as Record<string, unknown> & {
    highlightGrade?: unknown;
    highlightGrades?: unknown;
  };

  // Resolve highlightGrades, preferring the new array shape.
  let resolvedGrades: ProjectData['assistant']['highlightGrades'];
  if (Array.isArray(highlightGrades)) {
    resolvedGrades = highlightGrades.filter(
      (g): g is ProjectData['assistant']['highlightGrades'][number] =>
        typeof g === 'string' && g !== 'NONE',
    );
  } else if (typeof highlightGrade === 'string' && highlightGrade !== 'NONE') {
    // v1 single-grade selection — promote to a one-element array.
    resolvedGrades = [highlightGrade as ProjectData['assistant']['highlightGrades'][number]];
  } else {
    resolvedGrades = [];
  }

  return {
    ...defaults,
    ...rest,
    highlightGrades: resolvedGrades,
  } as ProjectData['assistant'];
};

/**
 * Trace-assist preferences arrived after v1; older projects either lack
 * the field entirely or carry partial data from an earlier shape. Pick
 * defaults for anything missing/invalid so the panel always has a
 * coherent state to work from.
 */
const normaliseTraceAssist = (
  raw: Partial<ProjectData['traceAssist']> | undefined,
  defaults: ProjectData['traceAssist'],
): ProjectData['traceAssist'] => {
  if (!raw || typeof raw !== 'object') return defaults;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults.enabled,
    sensitivity: typeof raw.sensitivity === 'number' && Number.isFinite(raw.sensitivity)
      ? Math.max(0.25, Math.min(2.5, raw.sensitivity))
      : defaults.sensitivity,
    showEdges: typeof raw.showEdges === 'boolean' ? raw.showEdges : defaults.showEdges,
  };
};

/**
 * Free-line state grew per-sample pressures + pressure/eraser settings
 * after v1. Older saved strokes have only `points`; this back-fills a
 * neutral 0.5 pressure for each one so the variable-width renderer
 * doesn't crash on them and they show as flat lines.
 */
const normaliseFreeLineState = (
  raw: Partial<ProjectData['freeLineState']> | undefined,
  defaults: ProjectData['freeLineState'],
): ProjectData['freeLineState'] => {
  if (!raw || typeof raw !== 'object') return defaults;
  const strokes = Array.isArray(raw.strokes)
    ? raw.strokes.map((s) => {
        const points = Array.isArray(s.points) ? s.points : [];
        const pressures = Array.isArray(s.pressures) && s.pressures.length === points.length
          ? s.pressures
          : points.map(() => 0.5);
        return {
          id: s.id ?? `fl_${Math.random().toString(36).slice(2, 10)}`,
          points,
          pressures,
          widthScale: typeof s.widthScale === 'number' ? s.widthScale : defaults.strokeWidth,
          color: typeof s.color === 'string' ? s.color : defaults.color,
          createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
        };
      })
    : defaults.strokes;
  return {
    strokes,
    visible: typeof raw.visible === 'boolean' ? raw.visible : defaults.visible,
    showLastN: typeof raw.showLastN === 'number' ? raw.showLastN : defaults.showLastN,
    strokeWidth: typeof raw.strokeWidth === 'number' ? raw.strokeWidth : defaults.strokeWidth,
    color: typeof raw.color === 'string' ? raw.color : defaults.color,
    pressureEnabled: typeof raw.pressureEnabled === 'boolean' ? raw.pressureEnabled : defaults.pressureEnabled,
    eraserSize: typeof raw.eraserSize === 'number' ? raw.eraserSize : defaults.eraserSize,
  };
};
