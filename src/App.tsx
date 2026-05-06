import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Grid3X3, Settings2, Sliders, RotateCcw, ZoomIn, ZoomOut, Maximize2, Download, Eye, EyeOff, Camera, Box, Search, Crop, Layers, X, Sun, Moon, Ruler, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  PencilGrade,
  GridConfig,
  GridLineStyle,
  AssistantSettings,
  LayerConfig,
  LayerId,
  SpotlightConfig,
  CropArea,
  OverlayFit,
  Calibration,
  CalibrationMode,
  CalibrationPoint,
  CalibrationState,
  CalibrationUnit,
  MeasurementMode,
  MeasurementState,
  LineMode,
  LineState,
} from './types';
import { PENCIL_GRADES, applyAssistantFilters } from './lib/drawingUtils';
import {
  computePixelsPerUnit,
  createCalibration,
  createCalibrationFromPaperPreset,
  emptyCalibrationState,
  formatMeasurement,
  formatScaleRatio,
  getActiveCalibration,
  loadCalibrationState,
  PAPER_SIZES,
  PaperSizeKey,
  pxToUnits,
  saveCalibrationState,
} from './lib/calibration';
import { CalibrationOverlay } from './components/CalibrationOverlay';
import { CalibrationModal } from './components/CalibrationModal';
import { CalibrationPanel } from './components/CalibrationPanel';
import { RulerOverlay } from './components/RulerOverlay';
import { MeasurementOverlay } from './components/MeasurementOverlay';
import { MeasurementModal } from './components/MeasurementModal';
import { MeasurementPanel } from './components/MeasurementPanel';
import {
  createMeasurement,
  emptyMeasurementState,
  loadMeasurementState,
  saveMeasurementState,
} from './lib/measurement';
import { LineOverlay } from './components/LineOverlay';
import { LinePanel } from './components/LinePanel';
import {
  createLine,
  emptyLineState,
  loadLineState,
  saveLineState,
  visibleLines,
} from './lib/lines';
import { ExportModal } from './components/ExportModal';
import { buildExportLayerMetas } from './lib/export';

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [layers, setLayers] = useState<LayerConfig[]>([
    { id: 'camera', name: 'Camera Overlay', visible: false, opacity: 0.5 },
    { id: 'overlay', name: 'Overlay Image', visible: false, opacity: 0.5 },
    { id: 'grid', name: 'Grid Overlay', visible: false, opacity: 0.3 },
    { id: 'analysis', name: 'Analysis Layer', visible: true, opacity: 1 },
    { id: 'reference', name: 'Base Reference', visible: true, opacity: 1 }
  ]);
  
  const [grid, setGrid] = useState<GridConfig>({
    enabled: false,
    rows: 4,
    cols: 4,
    color: '#ffffff',
    opacity: 0.3,
    thickness: 1,
    lineStyle: 'solid'
  });
  const [assistant, setAssistant] = useState<AssistantSettings>({
    grayscale: true,
    posterize: false,
    posterizeLevels: 5,
    highlightGrade: 'NONE',
    contrast: 0,
    brightness: 0,
    edges: false,
    invert: false,
    notan: false,
    notanThreshold: 128
  });

  const [spotlight, setSpotlight] = useState<SpotlightConfig>({
    enabled: false,
    size: 200,
    zoom: 2,
    x: 0,
    y: 0
  });

  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [originalImageElement, setOriginalImageElement] = useState<HTMLImageElement | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [cropArea, setCropArea] = useState<CropArea>({ x: 10, y: 10, width: 80, height: 80 });

  const referenceCanvasRef = useRef<HTMLCanvasElement>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement>(null);
  const spotlightCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  const [overlayImage, setOverlayImage] = useState<string | null>(null);
  const [overlayImageElement, setOverlayImageElement] = useState<HTMLImageElement | null>(null);
  const [overlayFit, setOverlayFit] = useState<OverlayFit>('contain');

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = window.localStorage.getItem('graphite-theme');
    return stored === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else {
      root.removeAttribute('data-theme');
    }
    try {
      window.localStorage.setItem('graphite-theme', theme);
    } catch {
      // localStorage may be unavailable (private mode etc.) — ignore
    }
  }, [theme]);

  /* ---------------------------------------------------------------------- */
  /* Scale calibration                                                      */
  /* ---------------------------------------------------------------------- */
  // Project-level calibration state. Lazily hydrated from localStorage so a
  // page reload keeps the user's calibrated scale.
  const [calibration, setCalibration] = useState<CalibrationState>(() =>
    loadCalibrationState(),
  );
  // Lightweight undo/redo history. We snapshot the whole calibration state
  // on every committed change which is plenty cheap given the data size.
  const [calPast, setCalPast] = useState<CalibrationState[]>([]);
  const [calFuture, setCalFuture] = useState<CalibrationState[]>([]);

  const [calMode, setCalMode] = useState<CalibrationMode>('idle');
  const [draftA, setDraftA] = useState<CalibrationPoint | null>(null);
  const [draftB, setDraftB] = useState<CalibrationPoint | null>(null);
  const [calHover, setCalHover] = useState<CalibrationPoint | null>(null);

  // Persist whenever calibration state changes.
  useEffect(() => {
    saveCalibrationState(calibration);
  }, [calibration]);

  /**
   * Wrap any "committable" calibration mutation. Pushes the previous state
   * onto the undo stack and clears the redo stack, then applies the update.
   */
  const commitCalibration = useCallback(
    (updater: (prev: CalibrationState) => CalibrationState) => {
      setCalibration((prev) => {
        const next = updater(prev);
        // Skip noop changes — important so dragging without movement doesn't
        // pollute the undo stack.
        if (next === prev) return prev;
        setCalPast((past) => [...past, prev]);
        setCalFuture([]);
        return next;
      });
    },
    [],
  );

  const handleUndoCalibration = useCallback(() => {
    setCalPast((past) => {
      if (past.length === 0) return past;
      const previous = past[past.length - 1];
      setCalFuture((future) => [calibration, ...future]);
      setCalibration(previous);
      return past.slice(0, -1);
    });
  }, [calibration]);

  const handleRedoCalibration = useCallback(() => {
    setCalFuture((future) => {
      if (future.length === 0) return future;
      const [next, ...rest] = future;
      setCalPast((past) => [...past, calibration]);
      setCalibration(next);
      return rest;
    });
  }, [calibration]);

  // Global Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z keyboard shortcuts. Scoped only to
  // calibration changes for now — drawing-state undo is out of scope here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      // Don't intercept when the user is typing in an input.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === 'z' || e.key === 'Z') {
        if (e.shiftKey) {
          if (calFuture.length > 0) {
            e.preventDefault();
            handleRedoCalibration();
          }
        } else if (calPast.length > 0) {
          e.preventDefault();
          handleUndoCalibration();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [calPast.length, calFuture.length, handleUndoCalibration, handleRedoCalibration]);

  // Esc cancels an in-flight calibration placement.
  useEffect(() => {
    if (calMode === 'idle') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCalMode('idle');
        setDraftA(null);
        setDraftB(null);
        setCalHover(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [calMode]);

  const startCalibration = () => {
    if (!imageElement || calibration.locked) return;
    setDraftA(null);
    setDraftB(null);
    setCalHover(null);
    setCalMode('placingA');
    // Cancel competing modes/tools that would steal pointer events.
    setCropMode(false);
    setSpotlight((s) => ({ ...s, enabled: false }));
  };

  const cancelCalibration = () => {
    setCalMode('idle');
    setDraftA(null);
    setDraftB(null);
    setCalHover(null);
  };

  const handleCalibrationCanvasClick = (point: CalibrationPoint) => {
    if (calMode === 'placingA') {
      setDraftA(point);
      setCalMode('placingB');
      setCalHover(point);
    } else if (calMode === 'placingB') {
      setDraftB(point);
      setCalHover(null);
      setCalMode('awaitingDistance');
    }
  };

  const confirmCalibration = (input: {
    realDistance: number;
    unit: CalibrationUnit;
    name: string;
  }) => {
    if (!draftA || !draftB) return;
    const newCal = createCalibration({
      pointA: draftA,
      pointB: draftB,
      realDistance: input.realDistance,
      unit: input.unit,
      name: input.name || `Calibration ${calibration.calibrations.length + 1}`,
    });
    commitCalibration((prev) => ({
      ...prev,
      calibrations: [...prev.calibrations, newCal],
      activeId: newCal.id,
    }));
    setCalMode('idle');
    setDraftA(null);
    setDraftB(null);
    setCalHover(null);
  };

  const handleSelectCalibration = (id: string) => {
    if (id === calibration.activeId) return;
    commitCalibration((prev) => ({ ...prev, activeId: id }));
  };

  const handleDeleteCalibration = (id: string) => {
    commitCalibration((prev) => {
      const remaining = prev.calibrations.filter((c) => c.id !== id);
      return {
        ...prev,
        calibrations: remaining,
        activeId:
          prev.activeId === id
            ? remaining[remaining.length - 1]?.id ?? null
            : prev.activeId,
      };
    });
  };

  const handleCreateFromPaperPreset = (
    paperKey: PaperSizeKey,
    unit: CalibrationUnit,
  ) => {
    if (!imageElement || calibration.locked) return;
    const paper = PAPER_SIZES[paperKey];
    const newCal = createCalibrationFromPaperPreset({
      paper,
      imageWidth: imageElement.width,
      imageHeight: imageElement.height,
      unit,
    });
    commitCalibration((prev) => ({
      ...prev,
      calibrations: [...prev.calibrations, newCal],
      activeId: newCal.id,
    }));
    // Cancel any in-flight manual placement so we don't leave the user in
    // a half-finished mode after taking the preset shortcut.
    cancelCalibration();
  };

  const handleToggleLock = () => {
    commitCalibration((prev) => ({ ...prev, locked: !prev.locked }));
  };

  const handleToggleVisible = () => {
    commitCalibration((prev) => ({ ...prev, visible: !prev.visible }));
  };

  // Live drag of an existing calibration's endpoint. We update the in-memory
  // state directly without committing every frame; the commit happens on
  // pointer-up so the undo stack only records the net move.
  const dragStartSnapshotRef = useRef<CalibrationState | null>(null);

  const handleActivePointDrag = (which: 'A' | 'B', point: CalibrationPoint) => {
    setCalibration((prev) => {
      if (!prev.activeId) return prev;
      // Snapshot the very first frame of the drag for undo.
      if (!dragStartSnapshotRef.current) {
        dragStartSnapshotRef.current = prev;
      }
      const calibrations = prev.calibrations.map((c) => {
        if (c.id !== prev.activeId) return c;
        const next: Calibration = {
          ...c,
          pointA: which === 'A' ? point : c.pointA,
          pointB: which === 'B' ? point : c.pointB,
        };
        // Recalc derived ratio so all downstream tools stay accurate live.
        next.pixelsPerUnit = computePixelsPerUnit(
          next.pointA,
          next.pointB,
          next.realDistance,
        );
        return next;
      });
      return { ...prev, calibrations };
    });
  };

  const handleActivePointDragEnd = () => {
    const snapshot = dragStartSnapshotRef.current;
    dragStartSnapshotRef.current = null;
    if (!snapshot) return;
    // Push snapshot onto undo stack (current state stays as-is).
    setCalPast((past) => [...past, snapshot]);
    setCalFuture([]);
  };

  const activeCalibration = useMemo(
    () => getActiveCalibration(calibration),
    [calibration],
  );

  /* ---------------------------------------------------------------------- */
  /* Custom measurements (named markers, e.g. "Left pupil → right nipple")  */
  /* ---------------------------------------------------------------------- */
  const [measurement, setMeasurement] = useState<MeasurementState>(() =>
    loadMeasurementState(),
  );
  const [measMode, setMeasMode] = useState<MeasurementMode>('idle');
  const [measDraftA, setMeasDraftA] = useState<CalibrationPoint | null>(null);
  const [measDraftB, setMeasDraftB] = useState<CalibrationPoint | null>(null);
  const [measHover, setMeasHover] = useState<CalibrationPoint | null>(null);
  // Same lightweight undo/redo strategy as calibration — snapshot the
  // entire MeasurementState on each committed change.
  const [measPast, setMeasPast] = useState<MeasurementState[]>([]);
  const [measFuture, setMeasFuture] = useState<MeasurementState[]>([]);
  const measDragSnapshotRef = useRef<MeasurementState | null>(null);

  useEffect(() => {
    saveMeasurementState(measurement);
  }, [measurement]);

  const commitMeasurement = useCallback(
    (updater: (prev: MeasurementState) => MeasurementState) => {
      setMeasurement((prev) => {
        const next = updater(prev);
        if (next === prev) return prev;
        setMeasPast((past) => [...past, prev]);
        setMeasFuture([]);
        return next;
      });
    },
    [],
  );

  const handleUndoMeasurement = useCallback(() => {
    setMeasPast((past) => {
      if (past.length === 0) return past;
      const previous = past[past.length - 1];
      setMeasFuture((future) => [measurement, ...future]);
      setMeasurement(previous);
      return past.slice(0, -1);
    });
  }, [measurement]);

  const handleRedoMeasurement = useCallback(() => {
    setMeasFuture((future) => {
      if (future.length === 0) return future;
      const [next, ...rest] = future;
      setMeasPast((past) => [...past, measurement]);
      setMeasurement(next);
      return rest;
    });
  }, [measurement]);

  // Esc cancels measurement placement.
  useEffect(() => {
    if (measMode === 'idle') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMeasMode('idle');
        setMeasDraftA(null);
        setMeasDraftB(null);
        setMeasHover(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [measMode]);

  const startMeasurement = () => {
    if (!imageElement || !activeCalibration) return;
    setMeasDraftA(null);
    setMeasDraftB(null);
    setMeasHover(null);
    setMeasMode('placingA');
    // Cancel competing tools so pointer events go to the measurement layer.
    setCropMode(false);
    setSpotlight((s) => ({ ...s, enabled: false }));
    setCalMode('idle');
  };

  const cancelMeasurement = () => {
    setMeasMode('idle');
    setMeasDraftA(null);
    setMeasDraftB(null);
    setMeasHover(null);
  };

  const handleMeasurementCanvasClick = (point: CalibrationPoint) => {
    if (measMode === 'placingA') {
      setMeasDraftA(point);
      setMeasMode('placingB');
      setMeasHover(point);
    } else if (measMode === 'placingB') {
      setMeasDraftB(point);
      setMeasHover(null);
      setMeasMode('awaitingName');
    }
  };

  const confirmMeasurement = (name: string) => {
    if (!measDraftA || !measDraftB) return;
    const m = createMeasurement({
      name,
      pointA: measDraftA,
      pointB: measDraftB,
    });
    commitMeasurement((prev) => ({
      ...prev,
      measurements: [...prev.measurements, m],
    }));
    setMeasMode('idle');
    setMeasDraftA(null);
    setMeasDraftB(null);
    setMeasHover(null);
  };

  const handleDeleteMeasurement = (id: string) => {
    commitMeasurement((prev) => ({
      ...prev,
      measurements: prev.measurements.filter((m) => m.id !== id),
    }));
  };

  const handleToggleMeasurementVisible = (id: string) => {
    commitMeasurement((prev) => ({
      ...prev,
      measurements: prev.measurements.map((m) =>
        m.id === id ? { ...m, visible: !m.visible } : m,
      ),
    }));
  };

  const handleToggleAllMeasurementsVisible = () => {
    commitMeasurement((prev) => ({ ...prev, showAll: !prev.showAll }));
  };

  // Live drag of a measurement endpoint. Same pattern as calibration drag:
  // mutate in-place and commit a single undo step on pointer-up.
  const handleMeasurementPointDrag = (
    id: string,
    which: 'A' | 'B',
    point: CalibrationPoint,
  ) => {
    setMeasurement((prev) => {
      if (!measDragSnapshotRef.current) {
        measDragSnapshotRef.current = prev;
      }
      const measurements = prev.measurements.map((m) => {
        if (m.id !== id) return m;
        return {
          ...m,
          pointA: which === 'A' ? point : m.pointA,
          pointB: which === 'B' ? point : m.pointB,
        };
      });
      return { ...prev, measurements };
    });
  };

  const handleMeasurementPointDragEnd = () => {
    const snapshot = measDragSnapshotRef.current;
    measDragSnapshotRef.current = null;
    if (!snapshot) return;
    setMeasPast((past) => [...past, snapshot]);
    setMeasFuture([]);
  };

  // Combine calibration + measurement undo/redo into the existing keyboard
  // listener. The earlier listener only knows about calibration; we add a
  // second one here so the behaviour is layered: the most recently changed
  // domain is the one that gets undone first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if ((e.key === 'z' || e.key === 'Z') && !e.shiftKey && measPast.length > 0 && calPast.length === 0) {
        e.preventDefault();
        handleUndoMeasurement();
      } else if ((e.key === 'z' || e.key === 'Z') && e.shiftKey && measFuture.length > 0 && calFuture.length === 0) {
        e.preventDefault();
        handleRedoMeasurement();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    measPast.length,
    measFuture.length,
    calPast.length,
    calFuture.length,
    handleUndoMeasurement,
    handleRedoMeasurement,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Line Shapes — quick two-click freehand lines (no measurements)         */
  /* ---------------------------------------------------------------------- */
  const [lineState, setLineState] = useState<LineState>(() => loadLineState());
  const [lineMode, setLineMode] = useState<LineMode>('idle');
  const [lineDraftA, setLineDraftA] = useState<CalibrationPoint | null>(null);
  const [lineHover, setLineHover] = useState<CalibrationPoint | null>(null);

  useEffect(() => {
    saveLineState(lineState);
  }, [lineState]);

  // Esc cancels in-flight line drawing.
  useEffect(() => {
    if (lineMode === 'idle') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLineMode('idle');
        setLineDraftA(null);
        setLineHover(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lineMode]);

  const startLineDrawing = () => {
    if (!imageElement) return;
    setLineDraftA(null);
    setLineHover(null);
    setLineMode('placingA');
    // Stand down competing tools so pointer events reach the line layer.
    setCropMode(false);
    setSpotlight((s) => ({ ...s, enabled: false }));
    setCalMode('idle');
    setMeasMode('idle');
  };

  const stopLineDrawing = () => {
    setLineMode('idle');
    setLineDraftA(null);
    setLineHover(null);
  };

  const handleLineCanvasClick = (point: CalibrationPoint) => {
    if (lineMode === 'placingA') {
      setLineDraftA(point);
      setLineMode('placingB');
      setLineHover(point);
    } else if (lineMode === 'placingB' && lineDraftA) {
      // Commit the line and immediately re-enter `placingA` so the user
      // can keep drawing without re-clicking the button. This is the
      // continuous-draw flow.
      const newLine = createLine(lineDraftA, point);
      setLineState((prev) => ({
        ...prev,
        lines: [...prev.lines, newLine],
        // Auto-bump the show-last-N if the user is currently at the cap so
        // the freshly-drawn line is actually visible. Without this, adding
        // line #6 with N=5 would silently hide line #1 — fine — but it'd
        // be confusing if N was set to <total, see comment above.
      }));
      setLineDraftA(null);
      setLineHover(null);
      setLineMode('placingA');
    }
  };

  const handleToggleLineVisible = () => {
    setLineState((prev) => ({ ...prev, visible: !prev.visible }));
  };

  const handleChangeLineShowN = (n: number) => {
    setLineState((prev) => ({ ...prev, showLastN: n }));
  };

  const handleUndoLastLine = () => {
    setLineState((prev) =>
      prev.lines.length === 0
        ? prev
        : { ...prev, lines: prev.lines.slice(0, -1) },
    );
  };

  const handleClearAllLines = () => {
    setLineState((prev) =>
      prev.lines.length === 0 ? prev : { ...prev, lines: [] },
    );
  };

  const linesToRender = useMemo(() => visibleLines(lineState), [lineState]);

  /* ---------------------------------------------------------------------- */
  /* Export modal                                                           */
  /* ---------------------------------------------------------------------- */
  const [exportOpen, setExportOpen] = useState(false);

  // Build the layer-meta + compose-args snapshots only when the modal opens
  // so we capture a consistent view of the workspace at that instant.
  const exportLayerMetas = useMemo(() => {
    if (!exportOpen || !imageElement) return null;
    return buildExportLayerMetas({
      hasReference: !!imageElement,
      referenceLayerVisible: layers.find((l) => l.id === 'reference')?.visible ?? false,
      referenceLayerOpacity: layers.find((l) => l.id === 'reference')?.opacity ?? 1,
      analysisLayerVisible: layers.find((l) => l.id === 'analysis')?.visible ?? false,
      analysisLayerOpacity: layers.find((l) => l.id === 'analysis')?.opacity ?? 1,
      hasOverlayImage: !!overlayImageElement,
      overlayLayerVisible: layers.find((l) => l.id === 'overlay')?.visible ?? false,
      overlayLayerOpacity: layers.find((l) => l.id === 'overlay')?.opacity ?? 1,
      grid,
      rulersVisible: calibration.locked && calibration.visible && !!activeCalibration,
      hasCalibration: !!activeCalibration,
      calibrationVisible: calibration.visible,
      measurementCount: measurement.measurements.length,
      measurementsVisible: measurement.showAll,
      lineCount: lineState.lines.length,
      linesVisible: lineState.visible,
    });
  }, [
    exportOpen,
    imageElement,
    layers,
    overlayImageElement,
    grid,
    calibration,
    activeCalibration,
    measurement,
    lineState,
  ]);

  const exportComposeArgs = useMemo(() => {
    if (!exportOpen || !imageElement) return null;
    return {
      imageElement,
      referenceCanvas: referenceCanvasRef.current,
      analysisCanvas: analysisCanvasRef.current,
      overlayImageElement,
      overlayFit,
      grid,
      calibration,
      activeCalibration,
      measurement,
      lineState,
    };
  }, [
    exportOpen,
    imageElement,
    overlayImageElement,
    overlayFit,
    grid,
    calibration,
    activeCalibration,
    measurement,
    lineState,
  ]);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const dataUrl = event.target?.result as string;
          setImage(dataUrl);
          setOriginalImage(dataUrl);
          setImageElement(img);
          setOriginalImageElement(img);
          setZoom(1);
          // Calibration + measurement points are anchored to image pixels
          // of the previous photo, so they no longer make sense once a new
          // reference is loaded. Reset to a clean slate (and clear undo
          // history too).
          setCalibration(emptyCalibrationState());
          setCalPast([]);
          setCalFuture([]);
          cancelCalibration();
          setMeasurement(emptyMeasurementState());
          setMeasPast([]);
          setMeasFuture([]);
          setMeasMode('idle');
          setMeasDraftA(null);
          setMeasDraftB(null);
          setMeasHover(null);
          setLineState(emptyLineState());
          setLineMode('idle');
          setLineDraftA(null);
          setLineHover(null);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleOverlayUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const dataUrl = event.target?.result as string;
          setOverlayImage(dataUrl);
          setOverlayImageElement(img);
          // Auto-enable the layer when a new overlay is uploaded
          setLayers(prev => prev.map(l => l.id === 'overlay' ? { ...l, visible: true } : l));
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
    // Reset the input so re-uploading the same file still triggers onChange
    if (e.target) e.target.value = '';
  };

  const handleRemoveOverlay = () => {
    setOverlayImage(null);
    setOverlayImageElement(null);
    setLayers(prev => prev.map(l => l.id === 'overlay' ? { ...l, visible: false } : l));
  };

  const cycleOverlayFit = () => {
    setOverlayFit(prev => (prev === 'contain' ? 'cover' : prev === 'cover' ? 'fill' : 'contain'));
  };

  const handleApplyCrop = () => {
    if (!originalImageElement) return;
    const canvas = document.createElement('canvas');
    const scaleX = originalImageElement.width / 100;
    const scaleY = originalImageElement.height / 100;
    
    const cropW = (cropArea.width / 100) * originalImageElement.width;
    const cropH = (cropArea.height / 100) * originalImageElement.height;
    const cropX = (cropArea.x / 100) * originalImageElement.width;
    const cropY = (cropArea.y / 100) * originalImageElement.height;

    canvas.width = cropW;
    canvas.height = cropH;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(
        originalImageElement,
        cropX, cropY, cropW, cropH,
        0, 0, cropW, cropH
      );
      const croppedDataUrl = canvas.toDataURL();
      const img = new Image();
      img.onload = () => {
        setImage(croppedDataUrl);
        setImageElement(img);
        setCropMode(false);
      };
      img.src = croppedDataUrl;
    }
  };

  const handleResetCrop = () => {
    if (originalImage && originalImageElement) {
      setImage(originalImage);
      setImageElement(originalImageElement);
      setCropMode(false);
    }
  };

  useEffect(() => {
    if (imageElement) {
      // Update Reference Canvas
      if (referenceCanvasRef.current) {
        const canvas = referenceCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = imageElement.width;
          canvas.height = imageElement.height;
          // Apply only brightness/contrast to reference
          ctx.drawImage(imageElement, 0, 0);
          applyAssistantFilters(ctx, canvas.width, canvas.height, {
            ...assistant,
            grayscale: false,
            posterize: false,
            highlightGrade: 'NONE',
            edges: false,
            invert: false
          });
        }
      }

      // Update Analysis Canvas
      if (analysisCanvasRef.current) {
        const canvas = analysisCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = imageElement.width;
          canvas.height = imageElement.height;
          ctx.drawImage(imageElement, 0, 0);
          applyAssistantFilters(ctx, canvas.width, canvas.height, assistant);
        }
      }
    }
  }, [imageElement, assistant]);

  // Sync grid layer with grid settings
  useEffect(() => {
    setLayers(prev => prev.map(l => l.id === 'grid' ? { ...l, visible: grid.enabled, opacity: grid.opacity } : l));
  }, [grid.enabled, grid.opacity]);

  useEffect(() => {
    const cameraLayer = layers.find(l => l.id === 'camera');
    if (cameraLayer?.visible && !cameraStream) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(stream => {
          setCameraStream(stream);
          if (videoRef.current) videoRef.current.srcObject = stream;
        })
        .catch(err => console.error("Camera access denied:", err));
    } else if (!cameraLayer?.visible && cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  }, [layers, cameraStream]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!spotlight.enabled || !containerRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setSpotlight(prev => ({ ...prev, x, y }));
  };

  useEffect(() => {
    if (spotlight.enabled && spotlightCanvasRef.current && imageElement) {
      const canvas = spotlightCanvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.width = spotlight.size;
        canvas.height = spotlight.size;
        
        // Calculate source coordinates based on zoom and mouse pos
        // spotlight.x/y are in container space, relative to the scaled image
        // For simplicity, let's just draw the zoomed in section
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        
        // Make it circular
        ctx.beginPath();
        ctx.arc(spotlight.size / 2, spotlight.size / 2, spotlight.size / 2, 0, Math.PI * 2);
        ctx.clip();

        if (imageElement) {
          // Map mouse coord inside canvas back to image coordinates
          // This is tricky because the image is scaled by zoom state plus motion.div scale
          // Let's approximate for now
          const sourceX = (spotlight.x / zoom) - (spotlight.size / (2 * spotlight.zoom));
          const sourceY = (spotlight.y / zoom) - (spotlight.size / (2 * spotlight.zoom));
          
          ctx.drawImage(
            imageElement,
            sourceX, sourceY, spotlight.size / spotlight.zoom, spotlight.size / spotlight.zoom,
            0, 0, spotlight.size, spotlight.size
          );
        }
        ctx.restore();
        
        // Border
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(spotlight.size / 2, spotlight.size / 2, spotlight.size / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }, [spotlight, imageElement, zoom]);
  const toggleLayerVisibility = (id: LayerId) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
    if (id === 'grid') setGrid(prev => ({ ...prev, enabled: !prev.enabled }));
    // Camera is handled by useEffect on layers
  };

  const updateLayerOpacity = (id: LayerId, opacity: number) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, opacity } : l));
    if (id === 'grid') setGrid(prev => ({ ...prev, opacity }));
  };

  const renderGrid = () => {
    if (!grid.enabled || !imageElement) return null;

    // Dash geometry scales with line thickness so thicker lines get
    // proportionally longer dashes — keeps the dash pattern visually
    // balanced regardless of stroke weight.
    const dashLen = Math.max(4, grid.thickness * 6);
    const gapLen = Math.max(3, grid.thickness * 4);
    const isDashed = grid.lineStyle === 'dashed';

    /** Background CSS for a vertical line of the chosen line style. */
    const verticalLineBg = isDashed
      ? {
          backgroundImage: `repeating-linear-gradient(to bottom, ${grid.color} 0 ${dashLen}px, transparent ${dashLen}px ${dashLen + gapLen}px)`,
        }
      : { backgroundColor: grid.color };

    /** Background CSS for a horizontal line of the chosen line style. */
    const horizontalLineBg = isDashed
      ? {
          backgroundImage: `repeating-linear-gradient(to right, ${grid.color} 0 ${dashLen}px, transparent ${dashLen}px ${dashLen + gapLen}px)`,
        }
      : { backgroundColor: grid.color };

    const lines = [];
    // Vertical lines
    for (let i = 1; i < grid.cols; i++) {
      const x = (i / grid.cols) * 100;
      lines.push(
        <div
          key={`v-${i}`}
          className="absolute h-full"
          style={{
            left: `${x}%`,
            width: `${grid.thickness}px`,
            opacity: grid.opacity,
            ...verticalLineBg,
          }}
        />
      );
    }
    // Horizontal lines
    for (let i = 1; i < grid.rows; i++) {
      const y = (i / grid.rows) * 100;
      lines.push(
        <div
          key={`h-${i}`}
          className="absolute w-full"
          style={{
            top: `${y}%`,
            height: `${grid.thickness}px`,
            opacity: grid.opacity,
            ...horizontalLineBg,
          }}
        />
      );
    }
    return lines;
  };

  return (
    <div className="relative flex h-screen bg-zinc-950 text-zinc-300 font-sans selection:bg-zinc-700 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-80 border-r border-zinc-800 bg-zinc-900 flex flex-col h-full overflow-y-auto custom-scrollbar">
        <div className="p-6 border-b border-zinc-800">
          <h1 className="text-xl font-bold tracking-tighter flex items-center gap-2 text-zinc-50">
            <div className="w-3 h-3 bg-zinc-400 rotate-45" />
            GRAPHITE STUDIO
          </h1>
          <p className="text-[10px] text-zinc-500 font-mono mt-1 uppercase tracking-widest">Pencil Drawing Assistant v1.0</p>
        </div>

        <div className="p-6 space-y-8">
          {/* Image Upload Area */}
          <section>
            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-3 block">Primary Source</label>
            <div 
              onClick={() => !cropMode && fileInputRef.current?.click()}
              className={`group relative border-2 border-dashed border-zinc-800 hover:border-zinc-600 transition-colors rounded-lg overflow-hidden aspect-video flex flex-col items-center justify-center cursor-pointer bg-zinc-900/50 ${cropMode ? 'cursor-default border-zinc-700' : ''}`}
              title="Upload a high-resolution photo to use as your drawing reference."
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleUpload} 
                className="hidden" 
                accept="image/*" 
              />
              {image ? (
                <>
                  <img src={image} className="w-full h-full object-cover opacity-40 group-hover:opacity-20 transition-opacity" />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    {!cropMode && (
                      <>
                        <Upload className="w-5 h-5 mb-2 text-zinc-400 group-hover:text-zinc-50 transition-colors" />
                        <span className="text-[10px] font-mono">CHANGE PHOTO</span>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <Upload className="w-6 h-6 mb-2 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                  <span className="text-[10px] font-mono text-zinc-500">UPLOAD REFERENCE</span>
                </>
              )}
            </div>
            {image && (
              <div className="mt-4 flex gap-2">
                <button 
                  onClick={() => setCropMode(!cropMode)}
                  className={`flex-1 px-3 py-2 border rounded text-[10px] font-mono flex items-center justify-center gap-2 transition-colors ${cropMode ? 'bg-zinc-100 text-zinc-950 border-zinc-100' : 'border-zinc-800 hover:border-zinc-600'}`}
                >
                  <Crop className="w-3 h-3" />
                  {cropMode ? 'CANCEL CROP' : 'CROP REFERENCE'}
                </button>
                {image !== originalImage && (
                  <button 
                    onClick={handleResetCrop}
                    className="px-3 py-2 border border-zinc-800 hover:border-zinc-600 rounded text-[10px] font-mono flex items-center justify-center transition-colors"
                  >
                    RESET
                  </button>
                )}
              </div>
            )}
            
            {cropMode && (
              <div className="mt-4 p-4 bg-zinc-900/50 rounded-lg border border-zinc-800 space-y-4">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-mono">
                      <span>WIDTH</span>
                      <span>{cropArea.width}%</span>
                    </div>
                    <input 
                      type="range" min="10" max="100" 
                      value={cropArea.width}
                      onChange={(e) => setCropArea(prev => ({ ...prev, width: parseInt(e.target.value) }))}
                      className="w-full h-1 bg-zinc-800 rounded appearance-none accent-zinc-400"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-mono">
                      <span>HEIGHT</span>
                      <span>{cropArea.height}%</span>
                    </div>
                    <input 
                      type="range" min="10" max="100" 
                      value={cropArea.height}
                      onChange={(e) => setCropArea(prev => ({ ...prev, height: parseInt(e.target.value) }))}
                      className="w-full h-1 bg-zinc-800 rounded appearance-none accent-zinc-400"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-mono">
                      <span>X OFFSET</span>
                      <span>{cropArea.x}%</span>
                    </div>
                    <input 
                      type="range" min="0" max={100 - cropArea.width} 
                      value={cropArea.x}
                      onChange={(e) => setCropArea(prev => ({ ...prev, x: parseInt(e.target.value) }))}
                      className="w-full h-1 bg-zinc-800 rounded appearance-none accent-zinc-400"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-mono">
                      <span>Y OFFSET</span>
                      <span>{cropArea.y}%</span>
                    </div>
                    <input 
                      type="range" min="0" max={100 - cropArea.height} 
                      value={cropArea.y}
                      onChange={(e) => setCropArea(prev => ({ ...prev, y: parseInt(e.target.value) }))}
                      className="w-full h-1 bg-zinc-800 rounded appearance-none accent-zinc-400"
                    />
                  </div>
                </div>
                <button 
                  onClick={handleApplyCrop}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-widest rounded transition-colors"
                >
                  APPLY CROP
                </button>
              </div>
            )}
          </section>

          {/* Overlay Image Upload */}
          <section>
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3">
              <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Overlay Image</label>
              <Layers className="w-3 h-3 text-zinc-600" />
            </div>
            <div
              onClick={() => overlayInputRef.current?.click()}
              className="group relative border-2 border-dashed border-zinc-800 hover:border-zinc-600 transition-colors rounded-lg overflow-hidden aspect-video flex flex-col items-center justify-center cursor-pointer bg-zinc-900/50"
              title="Upload a photo of your drawing-in-progress to ghost over the reference."
            >
              <input
                type="file"
                ref={overlayInputRef}
                onChange={handleOverlayUpload}
                className="hidden"
                accept="image/*"
              />
              {overlayImage ? (
                <>
                  <img src={overlayImage} className="w-full h-full object-cover opacity-40 group-hover:opacity-20 transition-opacity" />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <Upload className="w-5 h-5 mb-2 text-zinc-400 group-hover:text-zinc-50 transition-colors" />
                    <span className="text-[10px] font-mono">CHANGE OVERLAY</span>
                  </div>
                </>
              ) : (
                <>
                  <Layers className="w-6 h-6 mb-2 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                  <span className="text-[10px] font-mono text-zinc-500">UPLOAD OVERLAY</span>
                  <span className="text-[9px] font-mono text-zinc-700 mt-1 px-4 text-center">Photograph your paper drawing to compare</span>
                </>
              )}
            </div>
            {overlayImage && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={cycleOverlayFit}
                  className="flex-1 px-3 py-2 border border-zinc-800 hover:border-zinc-600 rounded text-[10px] font-mono flex items-center justify-center gap-2 transition-colors uppercase tracking-widest"
                  title="Cycle how the overlay is sized to match the reference"
                >
                  Fit: {overlayFit}
                </button>
                <button
                  onClick={handleRemoveOverlay}
                  className="px-3 py-2 border border-zinc-800 hover:border-red-700 hover:text-red-400 rounded text-[10px] font-mono flex items-center justify-center transition-colors"
                  title="Remove overlay image"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </section>

          {/* Layer Management */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Stack Layers</label>
              <Maximize2 className="w-3 h-3 text-zinc-600" />
            </div>

            <div className="space-y-3">
              {layers.map(layer => (
                <div key={layer.id} className="group flex flex-col gap-2 p-2 rounded hover:bg-zinc-900/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                       <button 
                         onClick={() => toggleLayerVisibility(layer.id)}
                         className="text-zinc-600 hover:text-zinc-400 transition-colors"
                         title={layer.visible ? "Hide this layer" : "Show this layer"}
                       >
                         {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                       </button>
                       <span className={`text-xs ${layer.visible ? 'text-zinc-300' : 'text-zinc-600'}`}>{layer.name}</span>
                    </div>
                    {layer.visible && <span className="text-[10px] font-mono text-zinc-600">{Math.round(layer.opacity * 100)}%</span>}
                  </div>
                  {layer.visible && (
                    <input 
                      type="range" min="0" max="1" step="0.05"
                      value={layer.opacity}
                      onChange={(e) => updateLayerOpacity(layer.id, parseFloat(e.target.value))}
                      className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-400 opacity-50 group-hover:opacity-100 transition-opacity"
                      title="Adjust layer transparency to see underlying reference or grid"
                    />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Assistant Filters */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Analysis Tools</label>
              <Settings2 className="w-3 h-3 text-zinc-600" />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs">Grayscale</span>
                <button 
                  onClick={() => setAssistant(prev => ({ ...prev, grayscale: !prev.grayscale }))}
                  className={`w-8 h-4 rounded-full relative transition-colors ${assistant.grayscale ? 'bg-zinc-400' : 'bg-zinc-800'}`}
                  title="Remove color to focus purely on tonal values and shading."
                >
                  <div className={`absolute top-1 left-1 w-2 h-2 rounded-full bg-[#0a0a0a] transition-transform ${assistant.grayscale ? 'translate-x-4' : ''}`} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs">The Notan</span>
                <button 
                  onClick={() => setAssistant(prev => ({ ...prev, notan: !prev.notan }))}
                  className={`w-8 h-4 rounded-full relative transition-colors ${assistant.notan ? 'bg-zinc-400' : 'bg-zinc-800'}`}
                  title="Simplify the image into pure black and white to study its core composition and 'big shapes'."
                >
                  <div className={`absolute top-1 left-1 w-2 h-2 rounded-full bg-[#0a0a0a] transition-transform ${assistant.notan ? 'translate-x-4' : ''}`} />
                </button>
              </div>

              {assistant.notan && (
                <div className="space-y-2 pt-1 pl-4 border-l border-zinc-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono opacity-60">Threshold</span>
                    <span className="text-[10px] font-mono">{assistant.notanThreshold}</span>
                  </div>
                  <input 
                    type="range" min="0" max="255" step="1"
                    value={assistant.notanThreshold}
                    onChange={(e) => setAssistant(prev => ({ ...prev, notanThreshold: parseInt(e.target.value) }))}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-400"
                    title="Control the balance between black and white areas in the Notan study."
                  />
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-xs">Edge Detection</span>
                <button 
                  onClick={() => setAssistant(prev => ({ ...prev, edges: !prev.edges }))}
                  className={`w-8 h-4 rounded-full relative transition-colors ${assistant.edges ? 'bg-zinc-400' : 'bg-zinc-800'}`}
                  title="Highlight sharp tonal transitions to identify important outlines and boundaries."
                >
                  <div className={`absolute top-1 left-1 w-2 h-2 rounded-full bg-[#0a0a0a] transition-transform ${assistant.edges ? 'translate-x-4' : ''}`} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs">Invert Values</span>
                <button 
                  onClick={() => setAssistant(prev => ({ ...prev, invert: !prev.invert }))}
                  className={`w-8 h-4 rounded-full relative transition-colors ${assistant.invert ? 'bg-zinc-400' : 'bg-zinc-800'}`}
                  title="Flip black and white values to help see shapes from a different perspective."
                >
                  <div className={`absolute top-1 left-1 w-2 h-2 rounded-full bg-[#0a0a0a] transition-transform ${assistant.invert ? 'translate-x-4' : ''}`} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs">Posterize</span>
                <button 
                  onClick={() => setAssistant(prev => ({ ...prev, posterize: !prev.posterize }))}
                  className={`w-8 h-4 rounded-full relative transition-colors ${assistant.posterize ? 'bg-zinc-400' : 'bg-zinc-800'}`}
                  title="Group similar tones into discrete steps, making complex gradients easier to map."
                >
                  <div className={`absolute top-1 left-1 w-2 h-2 rounded-full bg-[#0a0a0a] transition-transform ${assistant.posterize ? 'translate-x-4' : ''}`} />
                </button>
              </div>

              {assistant.posterize && (
                <div className="space-y-2 pt-1 pl-4 border-l border-zinc-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono opacity-60">Value Steps</span>
                    <span className="text-[10px] font-mono">{assistant.posterizeLevels}</span>
                  </div>
                  <input 
                    type="range" min="2" max="10" step="1"
                    value={assistant.posterizeLevels}
                    onChange={(e) => setAssistant(prev => ({ ...prev, posterizeLevels: parseInt(e.target.value) }))}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-400"
                    title="Number of tonal steps to group the image into."
                  />
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono opacity-60">Brightness</span>
                  <span className="text-[10px] font-mono">{assistant.brightness}</span>
                </div>
                <input 
                  type="range" min="-100" max="100" step="1"
                  value={assistant.brightness}
                  onChange={(e) => setAssistant(prev => ({ ...prev, brightness: parseInt(e.target.value) }))}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-400"
                  title="Shift exposure to reveal details hidden in highlights or shadows."
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono opacity-60">Contrast</span>
                  <span className="text-[10px] font-mono">{assistant.contrast}</span>
                </div>
                <input 
                  type="range" min="-100" max="100" step="1"
                  value={assistant.contrast}
                  onChange={(e) => setAssistant(prev => ({ ...prev, contrast: parseInt(e.target.value) }))}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-400"
                  title="Expand the range between light and dark to sharpen feature visibility."
                />
              </div>
            </div>
          </section>

          {/* Scale Calibration */}
          <CalibrationPanel
            state={calibration}
            mode={calMode}
            imageLoaded={!!imageElement}
            canUndo={calPast.length > 0}
            canRedo={calFuture.length > 0}
            onStart={startCalibration}
            onCancel={cancelCalibration}
            onSelect={handleSelectCalibration}
            onDelete={handleDeleteCalibration}
            onToggleLock={handleToggleLock}
            onToggleVisible={handleToggleVisible}
            onUndo={handleUndoCalibration}
            onRedo={handleRedoCalibration}
            onCreateFromPaperPreset={handleCreateFromPaperPreset}
          />

          {/* Custom Measurements */}
          <MeasurementPanel
            state={measurement}
            mode={measMode}
            calibration={activeCalibration}
            imageLoaded={!!imageElement}
            calibrationExists={!!activeCalibration}
            onStart={startMeasurement}
            onCancel={cancelMeasurement}
            onDelete={handleDeleteMeasurement}
            onToggleMarkerVisible={handleToggleMeasurementVisible}
            onToggleShowAll={handleToggleAllMeasurementsVisible}
          />

          {/* Free-form Line Shapes */}
          <LinePanel
            state={lineState}
            mode={lineMode}
            imageLoaded={!!imageElement}
            onStart={startLineDrawing}
            onStop={stopLineDrawing}
            onToggleVisible={handleToggleLineVisible}
            onChangeShowLastN={handleChangeLineShowN}
            onUndoLast={handleUndoLastLine}
            onClearAll={handleClearAllLines}
          />

          {/* Grid Controls */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Proportional Grid</label>
              <Grid3X3 className="w-3 h-3 text-zinc-600" />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs">Enabled</span>
                <button 
                  onClick={() => setGrid(prev => ({ ...prev, enabled: !prev.enabled }))}
                  className={`w-8 h-4 rounded-full relative transition-colors ${grid.enabled ? 'bg-zinc-400' : 'bg-zinc-800'}`}
                  title="Overlay a proportional grid to help with accurate placement and perspective."
                >
                  <div className={`absolute top-1 left-1 w-2 h-2 rounded-full bg-[#0a0a0a] transition-transform ${grid.enabled ? 'translate-x-4' : ''}`} />
                </button>
              </div>

              {grid.enabled && (
                <div className="space-y-4 pl-4 border-l border-zinc-800">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono opacity-60">Rows</span>
                      <input 
                        type="number" min="1" max="50"
                        value={grid.rows}
                        onChange={(e) => setGrid(prev => ({ ...prev, rows: parseInt(e.target.value) || 1 }))}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-zinc-600"
                        title="Number of horizontal grid divisions."
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono opacity-60">Cols</span>
                      <input 
                        type="number" min="1" max="50"
                        value={grid.cols}
                        onChange={(e) => setGrid(prev => ({ ...prev, cols: parseInt(e.target.value) || 1 }))}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-zinc-600"
                        title="Number of vertical grid divisions."
                      />
                    </div>
                  </div>
                  {/* Show real-world cell dimensions when a scale is active.
                      All measurement tools (incl. this grid) respect the
                      calibrated scaleFactor — see lib/calibration.ts. */}
                  {activeCalibration && imageElement && (
                    <div className="text-[10px] font-mono text-emerald-400/80 bg-emerald-500/5 border border-emerald-500/20 rounded px-2 py-1 leading-snug">
                      Cell ≈ {formatMeasurement(
                        pxToUnits(imageElement.width / grid.cols, activeCalibration).value,
                        activeCalibration.unit,
                      )} × {formatMeasurement(
                        pxToUnits(imageElement.height / grid.rows, activeCalibration).value,
                        activeCalibration.unit,
                      )}
                    </div>
                  )}
                  {/* Line style — solid or dashed */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono opacity-60">Line Style</span>
                    <div className="grid grid-cols-2 gap-1">
                      {(['solid', 'dashed'] as GridLineStyle[]).map((style) => (
                        <button
                          key={style}
                          type="button"
                          onClick={() => setGrid(prev => ({ ...prev, lineStyle: style }))}
                          className={`relative flex items-center justify-center gap-2 py-1.5 rounded border text-[10px] font-mono uppercase tracking-widest transition-colors ${
                            grid.lineStyle === style
                              ? 'bg-zinc-200 text-zinc-950 border-zinc-200'
                              : 'bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-700'
                          }`}
                          title={`Render grid lines as ${style} strokes.`}
                        >
                          {/* Tiny visual preview of the stroke */}
                          <span
                            aria-hidden
                            className="inline-block w-6 h-[2px] align-middle"
                            style={
                              style === 'dashed'
                                ? {
                                    backgroundImage: `repeating-linear-gradient(to right, currentColor 0 4px, transparent 4px 7px)`,
                                  }
                                : { backgroundColor: 'currentColor' }
                            }
                          />
                          {style}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Color picker */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono opacity-60">Color</span>
                      <span className="text-[10px] font-mono uppercase">{grid.color}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Native colour picker — wrapped in a stylable label
                          so we can theme its preview swatch. */}
                      <label
                        className="relative w-7 h-7 rounded border border-zinc-800 hover:border-zinc-600 transition-colors cursor-pointer overflow-hidden flex-shrink-0"
                        title="Pick any colour for grid lines"
                        style={{ backgroundColor: grid.color }}
                      >
                        <input
                          type="color"
                          value={grid.color}
                          onChange={(e) => setGrid(prev => ({ ...prev, color: e.target.value }))}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                      </label>
                      {/* Quick swatches for common high-contrast picks */}
                      <div className="flex items-center gap-1 flex-1">
                        {['#ffffff', '#000000', '#ef4444', '#22d3ee', '#a3e635', '#f59e0b'].map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setGrid(prev => ({ ...prev, color: c }))}
                            className={`w-4 h-4 rounded-sm border transition-all ${
                              grid.color.toLowerCase() === c.toLowerCase()
                                ? 'border-zinc-200 scale-110'
                                : 'border-zinc-700 hover:border-zinc-500'
                            }`}
                            style={{ backgroundColor: c }}
                            title={`Set grid colour to ${c}`}
                            aria-label={`Set grid colour to ${c}`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono opacity-60">Opacity</span>
                      <span className="text-[10px] font-mono">{Math.round(grid.opacity * 100)}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="1" step="0.1"
                      value={grid.opacity}
                      onChange={(e) => setGrid(prev => ({ ...prev, opacity: parseFloat(e.target.value) }))}
                      className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-400"
                      title="Adjust grid transparency for optimal visibility while drawing."
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono opacity-60">Thickness</span>
                      <span className="text-[10px] font-mono">{grid.thickness}px</span>
                    </div>
                    <input 
                      type="range" min="1" max="10" step="1"
                      value={grid.thickness}
                      onChange={(e) => setGrid(prev => ({ ...prev, thickness: parseInt(e.target.value) }))}
                      className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-400"
                      title="Adjust weight of grid lines."
                    />
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Spotlight Detail */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Detail Spotlight</label>
              <Search className="w-3 h-3 text-zinc-600" />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs">Focus Mode</span>
                <button 
                  onClick={() => setSpotlight(prev => ({ ...prev, enabled: !prev.enabled }))}
                  className={`w-8 h-4 rounded-full relative transition-colors ${spotlight.enabled ? 'bg-zinc-400' : 'bg-zinc-800'}`}
                  title="Activate a magnifying spotlight to examine fine details without losing context."
                >
                  <div className={`absolute top-1 left-1 w-2 h-2 rounded-full bg-[#0a0a0a] transition-transform ${spotlight.enabled ? 'translate-x-4' : ''}`} />
                </button>
              </div>

              {spotlight.enabled && (
                <div className="space-y-4 pl-4 border-l border-zinc-800">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono opacity-60">Box Size</span>
                      <span className="text-[10px] font-mono">{spotlight.size}px</span>
                    </div>
                    <input 
                      type="range" min="100" max="400" step="10"
                      value={spotlight.size}
                      onChange={(e) => setSpotlight(prev => ({ ...prev, size: parseInt(e.target.value) }))}
                      className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-400"
                      title="Adjust the diameter of the spotlight circle."
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono opacity-60">Magnify</span>
                      <span className="text-[10px] font-mono">{spotlight.zoom}x</span>
                    </div>
                    <input 
                      type="range" min="1.1" max="10" step="0.1"
                      value={spotlight.zoom}
                      onChange={(e) => setSpotlight(prev => ({ ...prev, zoom: parseFloat(e.target.value) }))}
                      className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-400"
                      title="Adjust how much the spotlight zooms into image details."
                    />
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Pencil Grade Highlights */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Tonal Mapping</label>
              <Sliders className="w-3 h-3 text-zinc-600" />
            </div>

            <div className="grid grid-cols-4 gap-1">
              <button
                onClick={() => setAssistant(prev => ({ ...prev, highlightGrade: 'NONE' }))}
                className={`text-[9px] font-mono py-1 rounded border ${assistant.highlightGrade === 'NONE' ? 'bg-zinc-400 text-zinc-950 border-zinc-400' : 'bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}
                title="Turn off pencil grade highlighting."
              >
                OFF
              </button>
              {PENCIL_GRADES.map(grade => (
                <button
                  key={grade}
                  onClick={() => setAssistant(prev => ({ ...prev, highlightGrade: grade }))}
                  className={`text-[9px] font-mono py-1 rounded border transition-all ${assistant.highlightGrade === grade ? 'bg-cyan-500 text-black border-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.3)]' : 'bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}
                  title={`Highlight components of the image that should be rendered with ${grade} pencil hardness.`}
                >
                  {grade}
                </button>
              ))}
            </div>
            <p className="text-[9px] text-zinc-600 leading-tight">
              Highlight components of the image that should be rendered with specific pencil hardness.
            </p>
          </section>
        </div>

        <div className="mt-auto p-4 border-t border-zinc-800 bg-[#080808]">
          <div className="flex items-center justify-between mb-2">
             <span className="text-[10px] font-mono text-zinc-600">WORKSPACE STATUS</span>
             <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
          </div>
          <div className="font-mono text-[9px] text-zinc-500 space-y-1">
            <div className="flex justify-between">
              <span>IMG_LOADED:</span>
              <span>{image ? 'TRUE' : 'FALSE'}</span>
            </div>
            <div className="flex justify-between">
              <span>ZOOM_LVL:</span>
              <span>{Math.round(zoom * 100)}%</span>
            </div>
            <div className="flex justify-between">
              <span>SCALE:</span>
              <span className={activeCalibration ? 'text-emerald-400' : ''}>
                {activeCalibration
                  ? `${activeCalibration.pixelsPerUnit.toFixed(1)} px/${activeCalibration.unit}`
                  : 'NONE'}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative bg-zinc-950/50">
        {/* Top bar over canvas */}
        <div className="absolute top-0 left-0 right-0 h-14 border-b border-zinc-800/50 backdrop-blur-sm z-10 flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-md p-0.5">
              <button 
                onClick={() => setZoom(prev => Math.max(0.1, prev - 0.1))}
                className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-50 transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <div className="px-3 text-[10px] font-mono text-zinc-500 select-none">
                {Math.round(zoom * 100)}%
              </div>
              <button 
                 onClick={() => setZoom(prev => Math.min(5, prev + 0.1))}
                className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-50 transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
            
            <button 
              onClick={() => setZoom(1)}
              className="p-2 hover:bg-zinc-900 rounded-md border border-transparent hover:border-zinc-800 text-zinc-500 hover:text-zinc-300 transition-all"
              title="Reset Zoom"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Calibration status pill — always-on indicator of the active
                scale. Clicking starts a (re-)calibration. */}
            <button
              onClick={startCalibration}
              disabled={!imageElement || calibration.locked || calMode !== 'idle'}
              title={
                activeCalibration
                  ? `Active scale: ${formatScaleRatio(activeCalibration)} — click to add another calibration`
                  : 'Click to define the real-world scale of this reference'
              }
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-[10px] font-mono uppercase tracking-widest transition-colors disabled:cursor-not-allowed ${
                activeCalibration
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <Ruler className="w-3 h-3" />
              {activeCalibration
                ? formatScaleRatio(activeCalibration)
                : 'Not Calibrated'}
              {calibration.locked && <Lock className="w-3 h-3 opacity-70" />}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))}
              className="p-2 hover:bg-zinc-900 rounded-md border border-transparent hover:border-zinc-800 text-zinc-500 hover:text-zinc-300 transition-all"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

             <button
              className="px-4 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs font-mono hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              onClick={() => setExportOpen(true)}
              disabled={!imageElement}
              title={
                imageElement
                  ? 'Open the export configurator to pick which layers to include'
                  : 'Upload a reference image first'
              }
            >
              <Download className="w-3.5 h-3.5" />
              EXPORT
            </button>
          </div>
        </div>

        {/* Canvas Display Area */}
        <div 
          ref={containerRef}
          className="flex-1 flex items-center justify-center p-20 overflow-auto custom-scrollbar dot-grid-bg"
        >
          {image ? (
            <motion.div 
              style={{ 
                scale: zoom,
                transformOrigin: 'center'
              }}
              onMouseMove={handleMouseMove}
              className="relative shadow-2xl transition-shadow shadow-black/50 canvas-shadow"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: zoom }}
            >
              {/* Stacked Layer Canvases */}
              <div className="relative">
                {/* Reference Image for Cropping Overlay */}
                {cropMode && originalImage && (
                  <div className="absolute inset-0 z-[100] pointer-events-none">
                     <div 
                       className="absolute border-2 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)] bg-transparent flex items-center justify-center"
                       style={{
                         left: `${cropArea.x}%`,
                         top: `${cropArea.y}%`,
                         width: `${cropArea.width}%`,
                         height: `${cropArea.height}%`
                       }}
                     >
                       <div className="text-[10px] font-mono bg-emerald-500 text-white px-2 py-0.5 rounded-sm absolute top-0 left-0 -translate-y-full">CROP AREA</div>
                     </div>
                     <div className="absolute inset-0 bg-black/60" style={{ clipPath: `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${cropArea.x}% ${cropArea.y}%, ${cropArea.x}% ${cropArea.y + cropArea.height}%, ${cropArea.x + cropArea.width}% ${cropArea.y + cropArea.height}%, ${cropArea.x + cropArea.width}% ${cropArea.y}%, ${cropArea.x}% ${cropArea.y}%)` }} />
                  </div>
                )}
                {/* Reference Layer */}
                <canvas 
                  ref={referenceCanvasRef} 
                  className="max-w-[70vw] max-h-[70vh] block"
                  style={{ 
                    visibility: layers.find(l => l.id === 'reference')?.visible ? 'visible' : 'hidden',
                    opacity: layers.find(l => l.id === 'reference')?.opacity ?? 1
                  }}
                />

                {/* Camera Overlay Layer */}
                <video 
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute top-0 left-0 w-full h-full object-cover pointer-events-none"
                  style={{ 
                    visibility: layers.find(l => l.id === 'camera')?.visible ? 'visible' : 'hidden',
                    opacity: layers.find(l => l.id === 'camera')?.opacity ?? 1,
                    display: layers.find(l => l.id === 'camera')?.visible ? 'block' : 'none'
                  }}
                />
                
                {/* Analysis Layer */}
                <canvas 
                  ref={analysisCanvasRef} 
                  className="absolute top-0 left-0 max-w-[70vw] max-h-[70vh] block"
                  style={{ 
                    visibility: layers.find(l => l.id === 'analysis')?.visible ? 'visible' : 'hidden',
                    opacity: layers.find(l => l.id === 'analysis')?.opacity ?? 1
                  }}
                />

                {/* Overlay Image Layer */}
                {overlayImage && (
                  <img
                    src={overlayImage}
                    alt="Overlay"
                    className={`absolute top-0 left-0 w-full h-full pointer-events-none ${
                      overlayFit === 'contain' ? 'object-contain' : overlayFit === 'cover' ? 'object-cover' : 'object-fill'
                    }`}
                    style={{
                      visibility: layers.find(l => l.id === 'overlay')?.visible ? 'visible' : 'hidden',
                      opacity: layers.find(l => l.id === 'overlay')?.opacity ?? 1,
                      display: layers.find(l => l.id === 'overlay')?.visible ? 'block' : 'none'
                    }}
                  />
                )}

                {/* Grid Overlay */}
                <div 
                  className="absolute inset-0 pointer-events-none overflow-hidden"
                  style={{ opacity: layers.find(l => l.id === 'grid')?.opacity ?? 1 }}
                >
                  {layers.find(l => l.id === 'grid')?.visible && renderGrid()}
                </div>

                {/* Spotlight Cursor Overlay */}
                {spotlight.enabled && (
                  <canvas 
                    ref={spotlightCanvasRef}
                    className="absolute pointer-events-none z-50 rounded-full"
                    style={{
                      left: spotlight.x - spotlight.size / 2,
                      top: spotlight.y - spotlight.size / 2,
                      width: spotlight.size,
                      height: spotlight.size
                    }}
                  />
                )}

                {/* Cm/mm rulers along the X (top) and Y (left) edges.
                    Only shown once the user has locked the scale — that's
                    the explicit "I'm in measurement mode now" gesture. */}
                {imageElement && (
                  <RulerOverlay
                    imageWidth={imageElement.width}
                    imageHeight={imageElement.height}
                    calibration={activeCalibration}
                    visible={calibration.locked && calibration.visible}
                  />
                )}

                {/* Calibration Overlay (SVG: line, draggable A/B markers,
                    live distance label). Sits above all canvases so it can
                    intercept clicks while in placement mode. */}
                {imageElement && (
                  <CalibrationOverlay
                    imageWidth={imageElement.width}
                    imageHeight={imageElement.height}
                    mode={calMode}
                    activeCalibration={activeCalibration}
                    showActive={calibration.visible}
                    locked={calibration.locked}
                    draftA={draftA}
                    draftB={draftB}
                    hoverPoint={calHover}
                    onCanvasClick={handleCalibrationCanvasClick}
                    onHover={setCalHover}
                    onActivePointDrag={handleActivePointDrag}
                    onActivePointDragEnd={handleActivePointDragEnd}
                  />
                )}

                {/* Custom measurement markers (named distances). Layered
                    just above the calibration overlay so its labels are
                    legible against any underlying calibration line. */}
                {imageElement && (
                  <MeasurementOverlay
                    imageWidth={imageElement.width}
                    imageHeight={imageElement.height}
                    measurements={measurement.measurements}
                    showAll={measurement.showAll}
                    calibration={activeCalibration}
                    mode={measMode}
                    locked={false}
                    draftA={measDraftA}
                    draftB={measDraftB}
                    hoverPoint={measHover}
                    onCanvasClick={handleMeasurementCanvasClick}
                    onHover={setMeasHover}
                    onMeasurementPointDrag={handleMeasurementPointDrag}
                    onMeasurementPointDragEnd={handleMeasurementPointDragEnd}
                  />
                )}

                {/* Free-form line shapes (no labels, no measurements). */}
                {imageElement && (
                  <LineOverlay
                    imageWidth={imageElement.width}
                    imageHeight={imageElement.height}
                    lines={linesToRender}
                    mode={lineMode}
                    draftA={lineDraftA}
                    hoverPoint={lineHover}
                    onCanvasClick={handleLineCanvasClick}
                    onHover={setLineHover}
                  />
                )}

                {/* "Scale Active" badge — small floating chip in the corner
                    of the image viewport so the user always knows the
                    project is calibrated. */}
                {activeCalibration && calibration.visible && (
                  <div className="absolute top-2 left-2 z-[70] flex items-center gap-1.5 px-2 py-1 rounded-full bg-zinc-950/80 backdrop-blur border border-emerald-500/40 text-[9px] font-mono uppercase tracking-widest text-emerald-300 pointer-events-none">
                    <Ruler className="w-2.5 h-2.5" />
                    Scale Active
                    {calibration.locked && <Lock className="w-2.5 h-2.5 opacity-70" />}
                  </div>
                )}
              </div>
              
              {/* Image Info Tooltip */}
              <div className="absolute -bottom-10 left-0 flex items-center gap-3 text-[10px] font-mono text-zinc-600 bg-zinc-950/80 backdrop-blur px-3 py-1.5 rounded border border-zinc-800">
                <span>W: {imageElement?.width}px</span>
                <span className="w-1 h-1 rounded-full bg-zinc-800" />
                <span>H: {imageElement?.height}px</span>
                {/* When calibrated, also surface the physical dimensions of
                    the reference at the chosen scale. */}
                {activeCalibration && imageElement && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-zinc-800" />
                    <span className="text-emerald-400/80">
                      {formatMeasurement(
                        pxToUnits(imageElement.width, activeCalibration).value,
                        activeCalibration.unit,
                      )}
                      {' × '}
                      {formatMeasurement(
                        pxToUnits(imageElement.height, activeCalibration).value,
                        activeCalibration.unit,
                      )}
                    </span>
                  </>
                )}
                <span className="w-1 h-1 rounded-full bg-zinc-800" />
                <span>ID: REF_{Math.floor(Math.random() * 9000) + 1000}</span>
              </div>
            </motion.div>
          ) : (
            <div className="text-center space-y-4">
               <div className="w-20 h-20 border-2 border-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-6 rotate-45 group">
                  <Upload className="w-8 h-8 text-zinc-700 group-hover:text-zinc-500 transition-colors -rotate-45" />
               </div>
               <h2 className="text-2xl font-light tracking-tight text-zinc-50 italic serif">Waiting for reference...</h2>
               <p className="text-zinc-500 max-w-sm mx-auto text-sm">
                 Upload a high-resolution photograph to begin tonal analysis and grid-based proportional mapping.
               </p>
               <button 
                 onClick={() => fileInputRef.current?.click()}
                 className="mt-8 px-6 py-2 bg-zinc-100 text-zinc-950 text-xs font-bold uppercase tracking-widest rounded-full hover:bg-zinc-50 transition-colors"
               >
                 Select Image
               </button>
            </div>
          )}
        </div>

        {/* Floating Help / Status */}
        <div className="absolute bottom-6 right-6">
           <button className="flex items-center gap-2 px-3 py-1.5 bg-[#0f0f0f]/80 backdrop-blur border border-zinc-800 rounded-full text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
              SYSTEM ACTIVE
           </button>
        </div>
      </main>

      {/* Calibration "real distance" modal — mounted at the root so it
          escapes overflow clipping from any panel. */}
      <CalibrationModal
        open={calMode === 'awaitingDistance'}
        pointA={draftA}
        pointB={draftB}
        defaultUnit={activeCalibration?.unit ?? 'cm'}
        onConfirm={confirmCalibration}
        onCancel={cancelCalibration}
      />

      {/* Measurement "name this marker" modal */}
      <MeasurementModal
        open={measMode === 'awaitingName'}
        pointA={measDraftA}
        pointB={measDraftB}
        calibration={activeCalibration}
        onConfirm={confirmMeasurement}
        onCancel={cancelMeasurement}
      />

      {/* Export configurator — per-layer opacity sliders + live preview */}
      <ExportModal
        open={exportOpen}
        layerMetas={exportLayerMetas}
        composeArgs={exportComposeArgs}
        onClose={() => setExportOpen(false)}
      />

      {/* Decorative watermark logo overlaid on the top-left of the viewport.
          Placed last in the DOM so it stacks above the sidebar/main UI.
          pointer-events: none so it never intercepts clicks; the blend mode
          + mask makes it feel like part of the background. */}
      <img
        src="/eye-logo.png"
        alt=""
        aria-hidden="true"
        className="app-watermark"
      />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
          height: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #0a0a0a;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #333;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #444;
        }
        
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        
        .serif { font-family: 'Georgia', serif; }
      `}</style>
    </div>
  );
}
