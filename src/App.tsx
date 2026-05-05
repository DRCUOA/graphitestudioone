import React, { useRef, useState, useEffect } from 'react';
import { Upload, Grid3X3, Settings2, Sliders, RotateCcw, ZoomIn, ZoomOut, Maximize2, Download, Eye, EyeOff, Camera, Box, Search, Crop } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { PencilGrade, GridConfig, AssistantSettings, LayerConfig, LayerId, SpotlightConfig, CropArea } from './types';
import { PENCIL_GRADES, applyAssistantFilters } from './lib/drawingUtils';

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [layers, setLayers] = useState<LayerConfig[]>([
    { id: 'camera', name: 'Camera Overlay', visible: false, opacity: 0.5 },
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
    thickness: 1
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

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
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
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
            backgroundColor: grid.color, 
            opacity: grid.opacity 
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
            backgroundColor: grid.color, 
            opacity: grid.opacity 
          }} 
        />
      );
    }
    return lines;
  };

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-zinc-300 font-sans selection:bg-zinc-700 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-80 border-r border-zinc-800 bg-[#0f0f0f] flex flex-col h-full overflow-y-auto custom-scrollbar">
        <div className="p-6 border-b border-zinc-800">
          <h1 className="text-xl font-bold tracking-tighter flex items-center gap-2 text-white">
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
                        <Upload className="w-5 h-5 mb-2 text-zinc-400 group-hover:text-white transition-colors" />
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
                  className={`flex-1 px-3 py-2 border rounded text-[10px] font-mono flex items-center justify-center gap-2 transition-colors ${cropMode ? 'bg-zinc-100 text-black border-zinc-100' : 'border-zinc-800 hover:border-zinc-600'}`}
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
                className={`text-[9px] font-mono py-1 rounded border ${assistant.highlightGrade === 'NONE' ? 'bg-zinc-400 text-black border-zinc-400' : 'bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-700'}`}
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
                className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <div className="px-3 text-[10px] font-mono text-zinc-500 select-none">
                {Math.round(zoom * 100)}%
              </div>
              <button 
                 onClick={() => setZoom(prev => Math.min(5, prev + 0.1))}
                className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors"
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
          </div>

          <div className="flex items-center gap-2">
             <button 
              className="px-4 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs font-mono hover:bg-zinc-800 transition-colors flex items-center gap-2"
              onClick={() => {
                if (analysisCanvasRef.current) {
                  const link = document.createElement('a');
                  link.download = 'graphite-analysis.png';
                  link.href = analysisCanvasRef.current.toDataURL();
                  link.click();
                }
              }}
            >
              <Download className="w-3.5 h-3.5" />
              EXPORT ANALYSIS
            </button>
          </div>
        </div>

        {/* Canvas Display Area */}
        <div 
          ref={containerRef}
          className="flex-1 flex items-center justify-center p-20 overflow-auto custom-scrollbar bg-[radial-gradient(#1a1a1a_1px,transparent_1px)] [background-size:20px_20px]"
        >
          {image ? (
            <motion.div 
              style={{ 
                scale: zoom,
                transformOrigin: 'center'
              }}
              onMouseMove={handleMouseMove}
              className="relative shadow-2xl transition-shadow shadow-black/50"
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
              </div>
              
              {/* Image Info Tooltip */}
              <div className="absolute -bottom-10 left-0 flex items-center gap-3 text-[10px] font-mono text-zinc-600 bg-zinc-950/80 backdrop-blur px-3 py-1.5 rounded border border-zinc-800">
                <span>W: {imageElement?.width}px</span>
                <span className="w-1 h-1 rounded-full bg-zinc-800" />
                <span>H: {imageElement?.height}px</span>
                <span className="w-1 h-1 rounded-full bg-zinc-800" />
                <span>ID: REF_{Math.floor(Math.random() * 9000) + 1000}</span>
              </div>
            </motion.div>
          ) : (
            <div className="text-center space-y-4">
               <div className="w-20 h-20 border-2 border-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-6 rotate-45 group">
                  <Upload className="w-8 h-8 text-zinc-700 group-hover:text-zinc-500 transition-colors -rotate-45" />
               </div>
               <h2 className="text-2xl font-light tracking-tight text-white italic serif">Waiting for reference...</h2>
               <p className="text-zinc-500 max-w-sm mx-auto text-sm">
                 Upload a high-resolution photograph to begin tonal analysis and grid-based proportional mapping.
               </p>
               <button 
                 onClick={() => fileInputRef.current?.click()}
                 className="mt-8 px-6 py-2 bg-zinc-100 text-black text-xs font-bold uppercase tracking-widest rounded-full hover:bg-white transition-colors"
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
