/* -------------------------------------------------------------------------- */
/* Session-storage autosave layer.                                            */
/*                                                                            */
/* Why sessionStorage and not localStorage?                                   */
/*   • Per-tab scope means two tabs can edit two different projects without   */
/*     trampling each other's autosave.                                       */
/*   • Cleared automatically when the tab/window closes — matches the user's  */
/*     "session" mental model.                                                */
/*   • Synchronous API → no chance of dropping writes during a hot edit loop. */
/*                                                                            */
/* The session draft is the single source of truth WHILE the user is editing. */
/* It's flushed to the IndexedDB persistence layer on exit (and periodically  */
/* as a crash-safety net) and then cleared.                                   */
/* -------------------------------------------------------------------------- */

import type { SessionDraft } from '../types';
import { normaliseProjectData } from './db';

const SESSION_KEY = 'graphite-session-draft-v1';

/** Read the current in-tab autosave, if any. */
export const loadSessionDraft = (): SessionDraft | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionDraft>;
    if (!parsed || typeof parsed.projectId !== 'string' || !parsed.data) {
      return null;
    }
    return {
      projectId: parsed.projectId,
      projectName: typeof parsed.projectName === 'string' ? parsed.projectName : 'Project',
      // Run the same normaliser used by IDB reads so a draft saved by an
      // older build still hydrates cleanly after the schema grows.
      data: normaliseProjectData(parsed.data),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    // Corrupt JSON — pretend there was no draft so the picker shows.
    return null;
  }
};

/**
 * Persist (overwrite) the active draft. Caller is expected to debounce —
 * sessionStorage is synchronous so a tight loop of writes will jank the
 * UI thread on large image payloads.
 */
export const saveSessionDraft = (draft: SessionDraft): void => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(draft));
  } catch (err) {
    // Most likely the storage quota: data URL images can be many MB.
    // Logged at warn level so the dev console reflects the failure but
    // the editing session keeps running (the IDB layer is the real
    // source of truth on flush anyway).
    // eslint-disable-next-line no-console
    console.warn('[projectSession] sessionStorage write failed:', err);
  }
};

/** Wipe the autosave. Called on explicit close / project switch / on-exit flush. */
export const clearSessionDraft = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing meaningful we can do; ignore.
  }
};
