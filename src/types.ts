export type PencilGrade = '9B' | '8B' | '7B' | '6B' | '5B' | '4B' | '3B' | '2B' | 'B' | 'HB' | 'F' | 'H' | '2H' | '3H' | '4H' | '5H' | '6H' | '7H' | '8H' | '9H';

export interface GridConfig {
  enabled: boolean;
  rows: number;
  cols: number;
  color: string;
  opacity: number;
  thickness: number;
}

export interface AssistantSettings {
  grayscale: boolean;
  posterize: boolean;
  posterizeLevels: number;
  highlightGrade: PencilGrade | 'NONE';
  contrast: number;
  brightness: number;
  edges: boolean;
  invert: boolean;
  notan: boolean;
  notanThreshold: number;
}

export type LayerId = 'reference' | 'analysis' | 'grid' | 'camera';

export interface LayerConfig {
  id: LayerId;
  name: string;
  visible: boolean;
  opacity: number;
}

export interface SpotlightConfig {
  enabled: boolean;
  size: number;
  zoom: number;
  x: number;
  y: number;
}

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}
