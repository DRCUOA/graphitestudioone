/* -------------------------------------------------------------------------- */
/* Project entity — high-level CRUD + helpers.                                */
/*                                                                            */
/* This is the "service layer" the rest of the app should talk to. It owns    */
/* id generation, timestamping, thumbnail derivation, and round-trips through */
/* the IndexedDB wrapper in db.ts. Components must never touch IDB directly.  */
/* -------------------------------------------------------------------------- */

import type { Project, ProjectData, ProjectMeta } from '../types';
import {
  createEmptyProjectData,
  dbDeleteProject,
  dbGetProject,
  dbListProjects,
  dbPutProject,
  dbPutProjectMeta,
} from './db';

/* -------------------------------------------------------------------------- */
/* ID + naming                                                                */
/* -------------------------------------------------------------------------- */

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** Default project name when the user doesn't supply one. */
export const defaultProjectName = (): string => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `Untitled ${yyyy}-${mm}-${dd}`;
};

/* -------------------------------------------------------------------------- */
/* Thumbnail derivation                                                       */
/* -------------------------------------------------------------------------- */

const THUMB_MAX_EDGE = 320;

/**
 * Render a small JPEG thumbnail from the project's reference image so the
 * picker tile has a preview. Returns null if no reference is set or the
 * image fails to decode (offscreen / corrupt data).
 *
 * Uses lossy JPEG at quality 0.7 — the picker doesn't need fidelity, and
 * keeping thumbnails sub-50KB means the metadata store stays tiny.
 */
export const buildThumbnail = async (
  imageDataUrl: string | null,
): Promise<string | null> => {
  if (!imageDataUrl) return null;
  try {
    const img = await loadHTMLImage(imageDataUrl);
    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
};

/** Promise-wrapped HTMLImageElement loader. Used by thumbnail + project open. */
export const loadHTMLImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image data URL'));
    img.src = src;
  });

/* -------------------------------------------------------------------------- */
/* CRUD                                                                       */
/* -------------------------------------------------------------------------- */

/** List metadata for every saved project, newest-edited first. */
export const listProjects = (): Promise<ProjectMeta[]> => dbListProjects();

/** Open a project for editing. Returns null when the id no longer exists. */
export const loadProject = (id: string): Promise<Project | null> =>
  dbGetProject(id);

/**
 * Create a fresh project record and persist it. The returned Project is
 * what the caller should adopt as the active session.
 *
 * Image fields are optional — a brand-new project may be created without
 * a reference image (the user can upload one later from the sidebar).
 */
export const createProject = async (input: {
  name?: string;
  initialImage?: string | null;
}): Promise<Project> => {
  const now = Date.now();
  const data: ProjectData = {
    ...createEmptyProjectData(),
    image: input.initialImage ?? null,
    originalImage: input.initialImage ?? null,
  };
  const project: Project = {
    id: newId(),
    name: (input.name?.trim() || defaultProjectName()),
    createdAt: now,
    updatedAt: now,
    thumbnail: await buildThumbnail(data.image),
    data,
  };
  await dbPutProject(project);
  return project;
};

/**
 * Persist the latest snapshot of an open project. Recomputes the thumbnail
 * (image may have been changed/cropped) and bumps `updatedAt`.
 */
export const saveProject = async (input: {
  id: string;
  name: string;
  createdAt: number;
  data: ProjectData;
}): Promise<ProjectMeta> => {
  const meta: ProjectMeta = {
    id: input.id,
    name: input.name,
    createdAt: input.createdAt,
    updatedAt: Date.now(),
    thumbnail: await buildThumbnail(input.data.image),
  };
  await dbPutProject({ ...meta, data: input.data });
  return meta;
};

/** Rename without re-writing the heavy data row. */
export const renameProject = async (
  meta: ProjectMeta,
  name: string,
): Promise<ProjectMeta> => {
  const next: ProjectMeta = {
    ...meta,
    name: name.trim() || defaultProjectName(),
    updatedAt: Date.now(),
  };
  await dbPutProjectMeta(next);
  return next;
};

export const deleteProject = (id: string): Promise<void> => dbDeleteProject(id);

/* -------------------------------------------------------------------------- */
/* File → data URL helper                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Read a user-uploaded File into a base64 data URL. Used by the picker's
 * "New Project" flow and (downstream) by the in-app reference uploader.
 */
export const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsDataURL(file);
  });
