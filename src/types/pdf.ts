export type AppTool =
  | 'home'
  | 'editor'
  | 'convert'
  | 'ocr'
  | 'organize'
  | 'compress'
  | 'batch'
  | 'create';

export type SidebarFilter = 'recent' | 'starred' | 'tools';

export interface LocalPdfDoc {
  id: string;
  name: string;
  size: number;
  pageCount: number;
  thumbnail?: string; // DataURL WebP ligero de la página 1
  starred: boolean;
  createdAt: number;
  updatedAt: number;
  data: ArrayBuffer;
}

export type LocalPdfMeta = Omit<LocalPdfDoc, 'data'>;

export interface SavedSignature {
  id: string;
  name: string;
  dataUrl: string;
  createdAt: number;
}

export interface OpenTab {
  docId: string;
  name: string;
  dirty?: boolean;
}

// Coordenadas normalizadas (0..1) respecto al ancho y alto visible de la página (después de rotación)
export type AnnotationType =
  | 'text'
  | 'edit-text' // Cubre texto existente del PDF y coloca texto editado encima
  | 'image'
  | 'signature'
  | 'highlight'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'draw'
  | 'redact'
  | 'note';

export type FontFamilyKey = 'Helvetica' | 'Times' | 'Courier';

export interface DrawPoint {
  x: number; // 0..1
  y: number; // 0..1
}

export interface PageAnnotation {
  id: string;
  pageId: string; // ID lógico de la página (sobrevive a reordenamiento)
  type: AnnotationType;
  x: number; // 0..1
  y: number; // 0..1
  width: number; // 0..1
  height: number; // 0..1
  // Propiedades de texto
  text?: string;
  originalText?: string;
  fontSize?: number; // En puntos PDF reales (pt)
  fontFamily?: FontFamilyKey;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  backgroundColor?: string;
  opacity?: number;
  // Formas y trazos
  strokeColor?: string;
  strokeWidth?: number; // En puntos PDF
  fillColor?: string;
  points?: DrawPoint[]; // Para draw, line, arrow
  // Imágenes y firmas
  imageDataUrl?: string;
}

export interface EditorPageState {
  pageId: string;
  sourcePageIndex: number | null; // 0-based en el PDF fuente; null = página en blanco nueva
  rotation: number; // 0, 90, 180, 270 (rotación adicional sobre la original)
  blankWidthPt?: number;
  blankHeightPt?: number;
}

export interface ExtractedTextBlock {
  id: string;
  text: string;
  // Coordenadas normalizadas (0..1) en viewport sin zoom (top-left origin)
  x: number;
  y: number;
  width: number;
  height: number;
  fontSizePt: number;
  fontName: string;
  bold?: boolean;
  italic?: boolean;
  angleDeg?: number; // 0 = horizontal, -90 / 90 = texto vertical
}

export interface ExtractedImageElement {
  id: string;
  dataUrl: string;
  pngBytes: Uint8Array;
  // Coordenadas normalizadas (0..1) en viewport sin zoom (top-left origin)
  x: number;
  y: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
}

export interface WatermarkConfig {
  enabled: boolean;
  text: string;
  opacity: number;
  fontSize: number;
  color: string;
  rotation: number;
}

export interface PageNumberConfig {
  enabled: boolean;
  position: 'bottom-center' | 'bottom-right' | 'top-right';
  format: 'number' | 'of-total';
  startFrom: number;
}

export interface ProgressInfo {
  percent: number;
  message: string;
}
