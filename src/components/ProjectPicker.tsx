import React, { useEffect, useRef, useState } from 'react';
import { FolderOpen, Plus, Upload, X, Trash2, Image as ImageIcon, Clock } from 'lucide-react';
import type { ProjectMeta } from '../types';
import { fileToDataUrl } from '../lib/projects';

interface Props {
  /** Already-loaded list of project metadata. */
  projects: ProjectMeta[];
  /** When true the picker is non-dismissible (no current project to fall back to). */
  blocking: boolean;
  onOpenProject: (id: string) => void;
  onCreateProject: (input: { name: string; initialImage: string | null }) => void;
  onDeleteProject: (id: string) => void;
  /** Optional dismiss for the non-blocking case (e.g. "switch project" entry). */
  onClose?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Compact human-friendly date stamp ("today 14:32", "yesterday", "Apr 12"). */
const formatStamp = (epoch: number): string => {
  const d = new Date(epoch);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `today ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return 'yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Welcome / project-management screen. Mounted on app startup whenever there
 * is no active session draft, and reachable on demand via the header so the
 * user can switch projects mid-session.
 *
 * Two panes, switched by the small tab strip:
 *   • Open existing — grid of saved projects
 *   • New project   — upload reference + name, creates and opens immediately
 */
export const ProjectPicker: React.FC<Props> = ({
  projects,
  blocking,
  onOpenProject,
  onCreateProject,
  onDeleteProject,
  onClose,
}) => {
  // Default to the "new" tab when there are no saved projects yet so the
  // first-run user lands on the most useful surface.
  const [tab, setTab] = useState<'open' | 'new'>(() =>
    projects.length === 0 ? 'new' : 'open',
  );

  // Two-step delete: clicking trash arms a confirm state on that single tile.
  // Avoids a modal-on-modal and the disruption of `window.confirm`.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Esc-to-dismiss for the non-blocking case.
  useEffect(() => {
    if (blocking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [blocking, onClose]);

  // If the available project list shrinks to zero (e.g. last one deleted)
  // while the picker is open, snap to the "new" tab so the user always has
  // a path forward.
  useEffect(() => {
    if (projects.length === 0) setTab('new');
  }, [projects.length]);

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-md"
      onClick={blocking ? undefined : onClose}
    >
      <div
        className="w-[760px] max-w-[92vw] max-h-[90vh] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center">
              <div className="w-3 h-3 bg-zinc-300 rotate-45" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-50 tracking-tight">
                Graphite Studio
              </h2>
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                Project Workspace
              </p>
            </div>
          </div>
          {!blocking && (
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-200 transition-colors"
              aria-label="Close project picker"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Tab strip */}
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-zinc-800">
          <TabButton
            active={tab === 'open'}
            disabled={projects.length === 0}
            onClick={() => setTab('open')}
            icon={<FolderOpen className="w-3.5 h-3.5" />}
            label={`Open Project${projects.length > 0 ? ` (${projects.length})` : ''}`}
          />
          <TabButton
            active={tab === 'new'}
            onClick={() => setTab('new')}
            icon={<Plus className="w-3.5 h-3.5" />}
            label="New Project"
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
          {tab === 'open' ? (
            <OpenPane
              projects={projects}
              pendingDeleteId={pendingDeleteId}
              onArmDelete={setPendingDeleteId}
              onConfirmDelete={(id) => {
                onDeleteProject(id);
                setPendingDeleteId(null);
              }}
              onOpen={onOpenProject}
            />
          ) : (
            <NewPane onCreate={onCreateProject} />
          )}
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Sub-components                                                             */
/* -------------------------------------------------------------------------- */

const TabButton: React.FC<{
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, disabled, onClick, icon, label }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`flex items-center gap-2 px-3 py-2 -mb-px border-b-2 text-[11px] font-mono uppercase tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      active
        ? 'border-emerald-500 text-zinc-100'
        : 'border-transparent text-zinc-500 hover:text-zinc-300'
    }`}
  >
    {icon}
    {label}
  </button>
);

/* ------------------------------ Open pane -------------------------------- */

const OpenPane: React.FC<{
  projects: ProjectMeta[];
  pendingDeleteId: string | null;
  onArmDelete: (id: string | null) => void;
  onConfirmDelete: (id: string) => void;
  onOpen: (id: string) => void;
}> = ({ projects, pendingDeleteId, onArmDelete, onConfirmDelete, onOpen }) => {
  if (projects.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-500">
        <FolderOpen className="w-10 h-10 mx-auto mb-3 text-zinc-700" />
        <p className="text-sm">No saved projects yet.</p>
        <p className="text-[11px] font-mono text-zinc-600 mt-1 uppercase tracking-widest">
          Switch to “New Project” to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      {projects.map((p) => {
        const armed = pendingDeleteId === p.id;
        return (
          <div
            key={p.id}
            className="group relative border border-zinc-800 hover:border-zinc-600 transition-colors rounded-lg overflow-hidden bg-zinc-950/40 flex flex-col"
          >
            <button
              type="button"
              onClick={() => onOpen(p.id)}
              className="aspect-video bg-zinc-950 border-b border-zinc-800 overflow-hidden flex items-center justify-center group-hover:bg-zinc-900 transition-colors"
              title={`Open “${p.name}”`}
            >
              {p.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.thumbnail}
                  alt={p.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <ImageIcon className="w-8 h-8 text-zinc-700" />
              )}
            </button>
            <div className="p-3 flex flex-col gap-1">
              <button
                type="button"
                onClick={() => onOpen(p.id)}
                className="text-left text-xs text-zinc-200 font-medium truncate hover:text-emerald-300 transition-colors"
                title={p.name}
              >
                {p.name}
              </button>
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  {formatStamp(p.updatedAt)}
                </span>
                {armed ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onConfirmDelete(p.id)}
                      className="text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded bg-red-600 text-white hover:bg-red-500 transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => onArmDelete(null)}
                      className="text-[9px] font-mono uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onArmDelete(p.id)}
                    className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"
                    title={`Delete “${p.name}”`}
                    aria-label={`Delete project ${p.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ------------------------------- New pane -------------------------------- */

const NewPane: React.FC<{
  onCreate: (input: { name: string; initialImage: string | null }) => void;
}> = ({ onCreate }) => {
  const [name, setName] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Auto-focus the name field on mount so keyboard users can dive in.
  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const url = await fileToDataUrl(file);
      setImageDataUrl(url);
    } finally {
      setReading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate({ name: name.trim(), initialImage: imageDataUrl });
  };

  // Submit button is enabled even without an image — a project can be
  // created empty and the user can upload a reference later from the sidebar.
  const submitLabel = imageDataUrl ? 'Create & open project' : 'Create empty project';

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block">
          Project name
        </label>
        <input
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Portrait study — May 2026"
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500"
          autoComplete="off"
        />
        <p className="text-[10px] text-zinc-600">
          Defaults to <span className="font-mono">Untitled YYYY-MM-DD</span> if left blank.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block">
          Reference image <span className="text-zinc-700">(optional)</span>
        </label>
        <div
          onClick={() => fileRef.current?.click()}
          className="group relative border-2 border-dashed border-zinc-800 hover:border-zinc-600 transition-colors rounded-lg overflow-hidden aspect-video flex flex-col items-center justify-center cursor-pointer bg-zinc-900/50"
          title="Pick a high-resolution photograph to use as the drawing reference."
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          {imageDataUrl ? (
            <>
              <img
                src={imageDataUrl}
                className="w-full h-full object-contain opacity-90"
                alt="Reference preview"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                <span className="opacity-0 group-hover:opacity-100 text-[10px] font-mono uppercase tracking-widest text-zinc-100 transition-opacity">
                  Change image
                </span>
              </div>
            </>
          ) : (
            <>
              <Upload className="w-6 h-6 mb-2 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
              <span className="text-[10px] font-mono text-zinc-500">
                {reading ? 'READING…' : 'UPLOAD REFERENCE'}
              </span>
            </>
          )}
        </div>
        {imageDataUrl && (
          <button
            type="button"
            onClick={() => setImageDataUrl(null)}
            className="text-[10px] font-mono text-zinc-500 hover:text-red-400 transition-colors uppercase tracking-widest"
          >
            Remove image
          </button>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
        <button
          type="submit"
          disabled={reading}
          className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-zinc-950 text-[11px] font-bold uppercase tracking-widest rounded transition-colors"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
};
