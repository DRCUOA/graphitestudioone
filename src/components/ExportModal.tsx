import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, X, RotateCcw, Eye, EyeOff } from 'lucide-react';
import {
  buildExportLayerMetas,
  composeExport,
  downloadCanvasAsPng,
  ExportComposeArgs,
  ExportLayerKey,
  ExportLayerMeta,
  ExportOpacities,
} from '../lib/export';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const initialFromMetas = (metas: ExportLayerMeta[]): ExportOpacities => {
  const o = {} as ExportOpacities;
  for (const m of metas) o[m.key] = m.defaultOpacity;
  return o;
};

const defaultFilename = (): string => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `graphite-export-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

/* -------------------------------------------------------------------------- */
/* Props                                                                      */
/* -------------------------------------------------------------------------- */

interface Props {
  open: boolean;
  /** Snapshot of every layer's availability + default opacity at modal open. */
  layerMetas: ExportLayerMeta[] | null;
  /** Args passed straight through to `composeExport` for both preview and
   *  download. The modal doesn't mutate them; it only changes opacities. */
  composeArgs: Omit<ExportComposeArgs, 'opacities'> | null;
  onClose: () => void;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Export configurator. One row per available layer with a 0..100% opacity
 * slider plus a live preview re-rendered (debounced) on every change.
 *
 * "Available" but seeded-to-zero layers (e.g. an overlay image that's
 * uploaded but currently hidden) still get a slider so the user can dial
 * them up just for the export.
 */
export const ExportModal: React.FC<Props> = ({
  open,
  layerMetas,
  composeArgs,
  onClose,
}) => {
  const [opacities, setOpacities] = useState<ExportOpacities | null>(null);
  const [filename, setFilename] = useState<string>(defaultFilename());
  const previewWrapperRef = useRef<HTMLDivElement>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const composeTimer = useRef<number | null>(null);

  // Reset state every time the modal (re-)opens.
  useEffect(() => {
    if (!open) return;
    if (layerMetas) setOpacities(initialFromMetas(layerMetas));
    setFilename(defaultFilename());
  }, [open, layerMetas]);

  // Debounced preview render. We compose into the same canvas the export
  // would produce, then convert to a data URL for the <img> preview — this
  // guarantees the preview is byte-identical to the eventual download.
  useEffect(() => {
    if (!open || !opacities || !composeArgs) return;
    if (composeTimer.current) window.clearTimeout(composeTimer.current);
    composeTimer.current = window.setTimeout(() => {
      const canvas = composeExport({ ...composeArgs, opacities });
      try {
        setPreviewSrc(canvas.toDataURL('image/png'));
      } catch {
        // toDataURL can throw on tainted canvases (e.g. cross-origin
        // overlay images). Swallow rather than crash — the export will
        // surface the same error in a more user-actionable way.
        setPreviewSrc(null);
      }
    }, 80);
    return () => {
      if (composeTimer.current) window.clearTimeout(composeTimer.current);
    };
  }, [open, opacities, composeArgs]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const enabledCount = useMemo(() => {
    if (!opacities) return 0;
    return (Object.values(opacities) as number[]).filter((v) => v > 0).length;
  }, [opacities]);

  if (!open || !layerMetas || !composeArgs || !opacities) return null;

  const updateOpacity = (key: ExportLayerKey, value: number) => {
    setOpacities((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const resetToDefaults = () => {
    setOpacities(initialFromMetas(layerMetas));
  };

  const allOff = () => {
    const next = {} as ExportOpacities;
    for (const m of layerMetas) next[m.key] = 0;
    setOpacities(next);
  };

  const allOn = () => {
    const next = {} as ExportOpacities;
    for (const m of layerMetas) next[m.key] = m.available ? 1 : 0;
    setOpacities(next);
  };

  const handleExport = () => {
    const canvas = composeExport({ ...composeArgs, opacities });
    downloadCanvasAsPng(canvas, filename || defaultFilename());
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[860px] max-w-[95vw] max-h-[90vh] bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <Download className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-50">Export Composition</h2>
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                {enabledCount} / {layerMetas.length} layers · per-layer opacity
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
            aria-label="Close export dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 grid grid-cols-[minmax(0,1fr)_360px] gap-0 overflow-hidden">
          {/* ---------- Live preview ---------- */}
          <div
            ref={previewWrapperRef}
            className="bg-zinc-950 border-r border-zinc-800 flex items-center justify-center p-6 overflow-auto custom-scrollbar"
          >
            {previewSrc ? (
              <img
                src={previewSrc}
                alt="Export preview"
                className="max-w-full max-h-full object-contain shadow-lg shadow-black/50 rounded-sm"
                style={{ background: '#0a0a0a' }}
              />
            ) : (
              <div className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
                Building preview…
              </div>
            )}
          </div>

          {/* ---------- Layer controls ---------- */}
          <div className="flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-3">
              {layerMetas.map((m) => (
                <LayerRow
                  key={m.key}
                  meta={m}
                  value={opacities[m.key]}
                  onChange={(v) => updateOpacity(m.key, v)}
                />
              ))}
            </div>

            {/* Quick actions */}
            <div className="px-5 py-3 border-t border-zinc-800 flex items-center gap-2">
              <button
                type="button"
                onClick={resetToDefaults}
                className="flex-1 px-2 py-1.5 border border-zinc-800 hover:border-zinc-600 rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 flex items-center justify-center gap-1.5 transition-colors"
                title="Match the layer settings currently shown in the workspace"
              >
                <RotateCcw className="w-3 h-3" />
                Match View
              </button>
              <button
                type="button"
                onClick={allOff}
                className="px-3 py-1.5 border border-zinc-800 hover:border-zinc-600 rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 transition-colors"
                title="Set every layer to 0%"
              >
                None
              </button>
              <button
                type="button"
                onClick={allOn}
                className="px-3 py-1.5 border border-zinc-800 hover:border-zinc-600 rounded text-[10px] font-mono uppercase tracking-widest text-zinc-300 transition-colors"
                title="Set every available layer to 100%"
              >
                All
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-3 border-t border-zinc-800 bg-zinc-950/40">
          <label className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest whitespace-nowrap">
              Filename
            </span>
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder={defaultFilename()}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-zinc-100 focus:outline-none focus:border-cyan-500"
              autoComplete="off"
            />
            <span className="text-[10px] font-mono text-zinc-600 whitespace-nowrap">.png</span>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-[11px] font-mono uppercase tracking-widest text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={enabledCount === 0}
              className="px-4 py-1.5 bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-zinc-950 text-[11px] font-bold uppercase tracking-widest rounded transition-colors flex items-center gap-2"
            >
              <Download className="w-3 h-3" />
              Export PNG
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Layer row                                                                  */
/* -------------------------------------------------------------------------- */

interface RowProps {
  meta: ExportLayerMeta;
  value: number;
  onChange: (v: number) => void;
}

const LayerRow: React.FC<RowProps> = ({ meta, value, onChange }) => {
  const disabled = !meta.available;
  const percent = Math.round(value * 100);
  return (
    <div
      className={`rounded border p-2.5 transition-colors ${
        disabled
          ? 'border-zinc-800/60 bg-zinc-950/20 opacity-50'
          : value > 0
          ? 'border-cyan-500/30 bg-cyan-500/5'
          : 'border-zinc-800 bg-zinc-950/40'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-zinc-100 truncate flex items-center gap-1.5">
            {value > 0 ? (
              <Eye className="w-3 h-3 text-cyan-400 shrink-0" />
            ) : (
              <EyeOff className="w-3 h-3 text-zinc-600 shrink-0" />
            )}
            {meta.label}
          </div>
          <p className="text-[9px] text-zinc-500 mt-0.5 leading-snug">
            {disabled ? 'Not available' : meta.description}
          </p>
        </div>
        <span className="text-[10px] font-mono text-zinc-300 tabular-nums shrink-0 w-10 text-right">
          {percent}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 mt-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 disabled:cursor-not-allowed"
      />
    </div>
  );
};
