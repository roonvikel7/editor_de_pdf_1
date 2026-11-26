import type { PDFPageProxy } from 'pdfjs-dist';
import { getPdfJs } from './pdfCore';

export interface RichTextLine {
  text: string;
  x: number; // 0..1
  y: number; // 0..1
  width: number; // 0..1
  height: number; // 0..1
  fontSizePt: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  colorHex: string; // sin '#', ej '111827'
  angleDeg: number;
}

export interface RichTextParagraph {
  id: string;
  lines: RichTextLine[];
  text: string;
  x: number; // 0..1
  y: number; // 0..1
  width: number; // 0..1
  height: number; // 0..1
  fontSizePt: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  colorHex: string; // sin '#'
  align: 'left' | 'center' | 'right';
  angleDeg: number;
}

export interface SceneImageObject {
  id: string;
  dataUrl: string;
  pngBytes: Uint8Array;
  x: number; // 0..1
  y: number; // 0..1
  width: number; // 0..1
  height: number; // 0..1
  pixelWidth: number;
  pixelHeight: number;
}

export interface AnalyzedPdfPage {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  isLandscape: boolean;
  paragraphs: RichTextParagraph[];
  rawLines: RichTextLine[];
  images: SceneImageObject[];
  /** Capa gráfica de diseño completa sin texto ni imágenes extraídas (null si la página es blanca lisa) */
  backgroundLayer: {
    dataUrl: string;
    pngBytes: Uint8Array;
    pixelWidth: number;
    pixelHeight: number;
  } | null;
  hasComplexLayout: boolean;
}

type OperationsFilterFn = (
  opIndex: number,
  operatorList: { fnArray: number[]; argsArray: unknown[] }
) => boolean;

/**
 * Renderiza una página PDF.js con soporte nativo de `operationsFilter` y fondo transparente opcional.
 */
async function renderPageFiltered(
  page: PDFPageProxy,
  scale: number,
  options: {
    transparent?: boolean;
    operationsFilter?: OperationsFilterFn;
  } = {}
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  const ctx = canvas.getContext('2d', {
    alpha: Boolean(options.transparent),
    willReadFrequently: true,
  });
  if (!ctx) throw new Error('No se pudo crear contexto 2D para renderizar la página.');

  if (options.transparent) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const renderParams = {
    canvasContext: ctx,
    canvas,
    viewport,
    background: options.transparent ? 'rgba(0,0,0,0)' : 'rgb(255,255,255)',
    operationsFilter: options.operationsFilter,
  };

  // pdfjs-dist@6 soporta `operationsFilter` de forma nativa en InternalRenderTask
  await page.render(renderParams as Parameters<PDFPageProxy['render']>[0]).promise;
  return canvas;
}

/**
 * Equivalente web a PdfFontMapper.txt de SolidFramework:
 * Traduce nombres de fuentes embebidas PDF a fuentes estándar limpias de Office/Web.
 */
export function mapPdfFontFamily(rawFontName: string, styleFamily?: string): {
  family: string;
  bold: boolean;
  italic: boolean;
} {
  const combined = `${rawFontName || ''} ${styleFamily || ''}`;
  const lower = combined.toLowerCase();

  const bold = /bold|black|heavy|demi|semibold|extrabold|ultrabold|medi|condb|700|800|900/.test(lower);
  const italic = /italic|oblique|slant/.test(lower);

  let family = 'Arial';
  if (/calibri/.test(lower)) family = 'Calibri';
  else if (/cambria/.test(lower)) family = 'Cambria';
  else if (/georgia/.test(lower)) family = 'Georgia';
  else if (/times|garamond|palatino|serif/.test(lower) && !/sans/.test(lower)) family = 'Times New Roman';
  else if (/courier|consolas|mono|menlo/.test(lower)) family = 'Courier New';
  else if (/verdana|tahoma|trebuchet/.test(lower)) family = 'Verdana';
  else if (/bebas|anton|oswald|impact|condensed|narrow/.test(lower)) family = 'Arial Narrow';
  else if (/segoe|roboto|open\s*sans|lato|montserrat|poppins|inter|helvetica|arial|sans/.test(lower)) {
    family = 'Arial';
  }

  return { family, bold, italic };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    clamp(r).toString(16).padStart(2, '0') +
    clamp(g).toString(16).padStart(2, '0') +
    clamp(b).toString(16).padStart(2, '0')
  ).toUpperCase();
}

function colorDistSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

/**
 * Muestrea el color REAL de la tinta del texto comparando el canvas completo (con texto)
 * contra el canvas de fondo limpio (sin texto). ¡Diferencia exacta pixel a pixel!
 */
function sampleTextInkColorExact(
  fullCtx: CanvasRenderingContext2D,
  bgCtx: CanvasRenderingContext2D | null,
  canvasW: number,
  canvasH: number,
  normX: number,
  normY: number,
  normW: number,
  normH: number
): string {
  const x0 = Math.max(0, Math.floor(normX * canvasW));
  const y0 = Math.max(0, Math.floor(normY * canvasH));
  const w = Math.max(2, Math.min(canvasW - x0, Math.ceil(normW * canvasW)));
  const h = Math.max(2, Math.min(canvasH - y0, Math.ceil(normH * canvasH)));

  const fullData = fullCtx.getImageData(x0, y0, w, h).data;
  const bgData = bgCtx ? bgCtx.getImageData(x0, y0, w, h).data : null;

  const stride = Math.max(1, Math.floor((w * h) / 700));
  const candidates: Array<{ r: number; g: number; b: number; dist: number }> = [];

  if (bgData) {
    for (let p = 0; p < w * h; p += stride) {
      const idx = p * 4;
      const r = fullData[idx];
      const g = fullData[idx + 1];
      const b = fullData[idx + 2];
      const dist = colorDistSq(r, g, b, bgData[idx], bgData[idx + 1], bgData[idx + 2]);
      if (dist > 900) {
        candidates.push({ r, g, b, dist });
      }
    }
  } else {
    // Fallback para escaneos sin capa de fondo separada
    const bgR = fullData[0];
    const bgG = fullData[1];
    const bgB = fullData[2];
    for (let p = 0; p < w * h; p += stride) {
      const idx = p * 4;
      const dist = colorDistSq(fullData[idx], fullData[idx + 1], fullData[idx + 2], bgR, bgG, bgB);
      if (dist > 1400) {
        candidates.push({ r: fullData[idx], g: fullData[idx + 1], b: fullData[idx + 2], dist });
      }
    }
  }

  if (candidates.length === 0) return '111827';

  // Top 20% de píxeles más contrastantes (centro sólido del trazo del glifo, sin antialiasing)
  candidates.sort((a, b) => b.dist - a.dist);
  const topCount = Math.max(1, Math.floor(candidates.length * 0.2));
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let i = 0; i < topCount; i++) {
    sumR += candidates[i].r;
    sumG += candidates[i].g;
    sumB += candidates[i].b;
  }
  return rgbToHex(sumR / topCount, sumG / topCount, sumB / topCount);
}

/**
 * Para páginas 100% escaneadas (sin texto vectorial), borra una caja de texto OCR rellenando con
 * el color mediano de los píxeles de fondo alrededor (evita por completo rayas o estiramientos).
 */
function fillOcrRectWithMedianBorderColor(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  x0: number,
  y0: number,
  w: number,
  h: number
): void {
  const rx0 = Math.max(0, Math.floor(x0));
  const ry0 = Math.max(0, Math.floor(y0));
  const rx1 = Math.min(canvasW - 1, Math.ceil(x0 + w));
  const ry1 = Math.min(canvasH - 1, Math.ceil(y0 + h));
  const rw = rx1 - rx0;
  const rh = ry1 - ry0;
  if (rw <= 0 || rh <= 0) return;

  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  const pushSample = (px: number, py: number) => {
    const d = ctx.getImageData(
      Math.max(0, Math.min(canvasW - 1, px)),
      Math.max(0, Math.min(canvasH - 1, py)),
      1,
      1
    ).data;
    rs.push(d[0]);
    gs.push(d[1]);
    bs.push(d[2]);
  };

  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const x = Math.round(rx0 + rw * t);
    pushSample(x, ry0 - 3);
    pushSample(x, ry1 + 3);
  }
  pushSample(rx0 - 3, Math.round((ry0 + ry1) / 2));
  pushSample(rx1 + 3, Math.round((ry0 + ry1) / 2));

  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = Math.floor(rs.length / 2);

  ctx.fillStyle = `rgb(${rs[mid]},${gs[mid]},${bs[mid]})`;
  ctx.fillRect(rx0, ry0, rw, rh);
}

/**
 * Encuentra el rectángulo exacto de píxeles no transparentes (alpha > 8) en un canvas transparente.
 */
function findAlphaBoundingBox(
  canvas: HTMLCanvasElement
): { x: number; y: number; w: number; h: number } | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowOff = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[rowOff + x * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Comprueba si un canvas tiene contenido visible real (píxeles no blancos).
 */
function canvasHasVisibleDesign(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const step = Math.max(4, Math.floor((canvas.width * canvas.height) / 14000)) * 4;
  let nonWhite = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += step) {
    total++;
    if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) nonWhite++;
  }
  return total > 0 && nonWhite / total > 0.002;
}

/**
 * Respaldo OCR silencioso cuando una página PDF es un escaneo o imagen sin texto seleccionable.
 */
async function runSilentOcrForPage(
  fullCanvas: HTMLCanvasElement,
  pageHeightPt: number
): Promise<RichTextLine[]> {
  const Tesseract = await import('tesseract.js');
  const worker = await Tesseract.createWorker('spa+eng', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
  });

  const ctx = fullCanvas.getContext('2d', { willReadFrequently: true });

  try {
    const res = await worker.recognize(fullCanvas, {}, { text: true, blocks: true });
    const lines: RichTextLine[] = [];
    if (res.data.blocks) {
      for (const block of res.data.blocks) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            const text = (line.text || '').trim();
            if (!text) continue;
            const b = line.bbox;
            const x = Math.max(0, b.x0 / fullCanvas.width);
            const y = Math.max(0, b.y0 / fullCanvas.height);
            const width = Math.min(1 - x, Math.max(0.02, (b.x1 - b.x0) / fullCanvas.width));
            const height = Math.min(1 - y, Math.max(0.012, (b.y1 - b.y0) / fullCanvas.height));
            const fontSizePt = Math.max(8, Math.min(48, Math.round(height * pageHeightPt * 0.78)));
            const colorHex = ctx
              ? sampleTextInkColorExact(ctx, null, fullCanvas.width, fullCanvas.height, x, y, width, height)
              : '111827';

            lines.push({
              text,
              x,
              y,
              width,
              height,
              fontSizePt,
              fontFamily: 'Arial',
              bold: fontSizePt >= 16,
              italic: false,
              colorHex,
              angleDeg: 0,
            });
          }
        }
      }
    }
    return lines;
  } finally {
    await worker.terminate();
  }
}

/**
 * Agrupa líneas contiguas de la misma columna, orientación y estilo en párrafos coherentes
 * detectando automáticamente la alineación real (izquierda, centrado o derecha).
 */
function groupLinesIntoParagraphs(lines: RichTextLine[]): RichTextParagraph[] {
  if (lines.length === 0) return [];

  const groups: RichTextLine[][] = [];
  const used = new Array<boolean>(lines.length).fill(false);

  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const base = lines[i];
    const group: RichTextLine[] = [base];
    const isVert = Math.abs(Math.abs(base.angleDeg) - 90) < 18;

    if (!isVert) {
      let last = base;
      for (let j = i + 1; j < lines.length; j++) {
        if (used[j]) continue;
        const cand = lines[j];
        if (Math.abs(cand.angleDeg - last.angleDeg) > 10) continue;

        const verticalGap = cand.y - (last.y + last.height);
        if (verticalGap < -last.height * 0.3) continue;
        if (verticalGap > Math.max(last.height * 0.9, 0.022)) continue;

        const overlapX =
          Math.min(last.x + last.width, cand.x + cand.width) - Math.max(last.x, cand.x);
        const minW = Math.min(last.width, cand.width);
        const sameCenter =
          Math.abs(last.x + last.width / 2 - (cand.x + cand.width / 2)) < 0.032;
        const sameLeft = Math.abs(last.x - cand.x) < 0.022;
        const horizontallyRelated = overlapX > minW * 0.35 || sameCenter || sameLeft;

        const sizeRatio = cand.fontSizePt / Math.max(1, last.fontSizePt);
        const sameSize = sizeRatio >= 0.84 && sizeRatio <= 1.2;
        const sameColor = cand.colorHex === last.colorHex;

        if (horizontallyRelated && sameSize && sameColor) {
          used[j] = true;
          group.push(cand);
          last = cand;
        }
      }
    }

    groups.push(group);
  }

  return groups.map((group, idx) => {
    const minX = Math.min(...group.map((g) => g.x));
    const minY = Math.min(...group.map((g) => g.y));
    const maxX = Math.max(...group.map((g) => g.x + g.width));
    const maxY = Math.max(...group.map((g) => g.y + g.height));
    const primary = group[0];

    let align: 'left' | 'center' | 'right' = 'left';
    if (group.length >= 2) {
      const leftSpread = Math.max(...group.map((g) => g.x)) - Math.min(...group.map((g) => g.x));
      const rightSpread =
        Math.max(...group.map((g) => g.x + g.width)) -
        Math.min(...group.map((g) => g.x + g.width));
      const centers = group.map((g) => g.x + g.width / 2);
      const centerSpread = Math.max(...centers) - Math.min(...centers);

      if (centerSpread < leftSpread * 0.65 && centerSpread < 0.022) {
        align = 'center';
      } else if (rightSpread < leftSpread * 0.55 && rightSpread < 0.018) {
        align = 'right';
      }
    } else {
      const center = primary.x + primary.width / 2;
      if (Math.abs(center - 0.5) < 0.035 && primary.width < 0.72) {
        align = 'center';
      }
    }

    return {
      id: `para-${idx}`,
      lines: group,
      text: group.map((g) => g.text).join('\n'),
      x: minX,
      y: minY,
      width: Math.max(0.02, maxX - minX),
      height: Math.max(0.014, maxY - minY),
      fontSizePt: Math.round(group.reduce((s, g) => s + g.fontSizePt, 0) / group.length),
      fontFamily: primary.fontFamily,
      bold: group.filter((g) => g.bold).length >= group.length / 2,
      italic: group.filter((g) => g.italic).length >= group.length / 2,
      colorHex: primary.colorHex,
      align,
      angleDeg: primary.angleDeg,
    };
  });
}

/**
 * Analizador profesional de página PDF usando el filtrado nativo de operadores de PDF.js 6 (`operationsFilter`):
 * - CERO inpainting borroso sobre texto vectorial: PDF.js renderiza el fondo omitiendo directamente el texto.
 * - CERO desplazamientos ni recortes rotos de imágenes: cada imagen embebida se renderiza aislada sobre
 *   un lienzo transparente con su propio FormXObject y clip path reales (círculos, recortes, sombras),
 *   y luego se omite exactamente esa operación del fondo.
 */
export async function analyzePdfPage(
  page: PDFPageProxy,
  pageNumber: number,
  onStatus?: (msg: string) => void
): Promise<AnalyzedPdfPage> {
  const pdfjs = await getPdfJs();
  const OPS = pdfjs.OPS;
  const vp1 = page.getViewport({ scale: 1 });
  const widthPt = vp1.width;
  const heightPt = vp1.height;
  const isLandscape = widthPt > heightPt;
  const renderScale = 2.0;

  // Operadores que dibujan texto vectorial
  const TEXT_DRAW_OPS = new Set<number>([
    OPS.showText,
    OPS.showSpacedText,
    OPS.nextLineShowText,
    OPS.nextLineSetSpacingShowText,
  ]);

  // Operadores que pintan imágenes raster
  const IMAGE_DRAW_OPS = new Set<number>([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageXObjectRepeat,
    OPS.paintInlineImageXObjectGroup,
  ]);

  // Operadores que pintan formas vectoriales (para suprimirlos al aislar una imagen individual)
  const VECTOR_PAINT_OPS = new Set<number>([
    OPS.stroke,
    OPS.closeStroke,
    OPS.fill,
    OPS.eoFill,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
    OPS.shadingFill,
    OPS.rawFillPath,
    OPS.paintImageMaskXObject,
    OPS.paintImageMaskXObjectGroup,
    OPS.paintImageMaskXObjectRepeat,
    OPS.paintSolidColorImageMask,
  ]);

  // 1) Obtener lista de operadores y renderizar página completa (para color exacto de tinta / fallback OCR)
  const [opList, fullCanvas, textContent] = await Promise.all([
    page.getOperatorList(),
    renderPageFiltered(page, renderScale, { transparent: false }),
    page.getTextContent(),
  ]);
  const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });

  // 2) Aislar cada imagen embebida con su máscara/clip y FormXObject EXACTOS usando `operationsFilter`
  const imageOpIndices: number[] = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    if (IMAGE_DRAW_OPS.has(opList.fnArray[i])) {
      imageOpIndices.push(i);
    }
  }

  const images: SceneImageObject[] = [];
  const extractedImageOpIndices = new Set<number>();

  // Solo extraemos imágenes individuales cuando hay un número razonable (evita cientos de micro-tiles de textura)
  if (imageOpIndices.length > 0 && imageOpIndices.length <= 16) {
    for (let k = 0; k < imageOpIndices.length; k++) {
      const targetIdx = imageOpIndices[k];

      const isolatedCanvas = await renderPageFiltered(page, renderScale, {
        transparent: true,
        operationsFilter: (i, list) => {
          const fn = list.fnArray[i];
          if (TEXT_DRAW_OPS.has(fn)) return false;
          if (VECTOR_PAINT_OPS.has(fn)) return false;
          if (IMAGE_DRAW_OPS.has(fn)) return i === targetIdx;
          if (fn === OPS.constructPath) {
            const pathOp = (list.argsArray[i] as unknown[] | undefined)?.[0];
            const nextFn = list.fnArray[i + 1];
            // Solo ejecutar constructPath si define un clip path (máscara circular, recorte, etc.)
            return (
              pathOp === OPS.clip ||
              pathOp === OPS.eoClip ||
              pathOp === OPS.endPath ||
              nextFn === OPS.clip ||
              nextFn === OPS.eoClip
            );
          }
          return true;
        },
      });

      const bbox = findAlphaBoundingBox(isolatedCanvas);
      if (!bbox) continue;

      const normX = bbox.x / isolatedCanvas.width;
      const normY = bbox.y / isolatedCanvas.height;
      const normW = bbox.w / isolatedCanvas.width;
      const normH = bbox.h / isolatedCanvas.height;

      // Ignorar micro-artefactos (< 2.5%) y fondos que cubren toda la página (> 88% ambos ejes)
      if (normW < 0.025 || normH < 0.025) continue;
      if (normW > 0.88 && normH > 0.88) continue;

      // Recortar exactamente al bounding box real de píxeles no transparentes
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = bbox.w;
      cropCanvas.height = bbox.h;
      const cropCtx = cropCanvas.getContext('2d');
      if (!cropCtx) continue;
      cropCtx.drawImage(
        isolatedCanvas,
        bbox.x,
        bbox.y,
        bbox.w,
        bbox.h,
        0,
        0,
        bbox.w,
        bbox.h
      );

      const blob = await new Promise<Blob | null>((resolve) => cropCanvas.toBlob(resolve, 'image/png'));
      if (!blob) continue;

      images.push({
        id: `img-${pageNumber}-${k}`,
        dataUrl: cropCanvas.toDataURL('image/png'),
        pngBytes: new Uint8Array(await blob.arrayBuffer()),
        x: normX,
        y: normY,
        width: normW,
        height: normH,
        pixelWidth: bbox.w,
        pixelHeight: bbox.h,
      });
      extractedImageOpIndices.add(targetIdx);
    }
  }

  // 3) Renderizar la CAPA DE FONDO / DISEÑO 100% CRISTALINA SIN TEXTO NI IMÁGENES EXTRAÍDAS
  const bgCanvas = await renderPageFiltered(page, renderScale, {
    transparent: false,
    operationsFilter: (i, list) => {
      const fn = list.fnArray[i];
      if (TEXT_DRAW_OPS.has(fn)) return false;
      if (extractedImageOpIndices.has(i)) return false;
      return true;
    },
  });
  const bgCtx = bgCanvas.getContext('2d', { willReadFrequently: true });

  // 4) Extraer todos los textos vectoriales con posición, fuente, rotación y COLOR REAL exacto (full vs bg)
  const styles = textContent.styles || {};

  interface RawItem {
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSizePt: number;
    fontFamily: string;
    bold: boolean;
    italic: boolean;
    angleDeg: number;
  }

  const rawItems: RawItem[] = [];
  for (const item of textContent.items) {
    if (!('str' in item) || !item.str || !item.str.trim()) continue;
    const tx = pdfjs.Util.transform(vp1.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]) || Math.hypot(tx[0], tx[1]) || 12;
    const angleRad = Math.atan2(tx[1], tx[0]);
    let angleDeg = Math.round((angleRad * 180) / Math.PI);
    if (Math.abs(angleDeg) < 6) angleDeg = 0;

    const isVertical = Math.abs(Math.abs(angleDeg) - 90) < 18;
    const rawW = Math.max(item.width || fontHeight * 0.5, fontHeight * 0.4);
    const xPx = isVertical ? tx[4] - fontHeight * 0.55 : tx[4];
    const yPx = isVertical ? tx[5] - rawW : tx[5] - fontHeight * 0.88;
    const wPx = isVertical ? fontHeight * 1.25 : rawW;
    const hPx = isVertical ? Math.max(rawW, fontHeight) : fontHeight * 1.22;

    const styleInfo = styles[item.fontName];
    const mapped = mapPdfFontFamily(item.fontName, styleInfo?.fontFamily);

    rawItems.push({
      str: item.str,
      x: Math.max(0, Math.min(0.99, xPx / vp1.width)),
      y: Math.max(0, Math.min(0.99, yPx / vp1.height)),
      width: Math.min(1, Math.max(0.004, wPx / vp1.width)),
      height: Math.min(1, Math.max(0.01, hPx / vp1.height)),
      fontSizePt: Math.max(6, Math.min(76, Math.round(fontHeight * 10) / 10)),
      fontFamily: mapped.family,
      bold: mapped.bold,
      italic: mapped.italic,
      angleDeg,
    });
  }

  rawItems.sort((a, b) => {
    const dy = a.y - b.y;
    if (Math.abs(dy) > Math.min(a.height, b.height) * 0.52) return dy;
    return a.x - b.x;
  });

  const lineGroups: RawItem[][] = [];
  for (const item of rawItems) {
    const lastLine = lineGroups[lineGroups.length - 1];
    if (!lastLine) {
      lineGroups.push([item]);
      continue;
    }
    const prev = lastLine[lastLine.length - 1];
    const sameAngle = Math.abs(item.angleDeg - prev.angleDeg) < 10;
    const isVert = Math.abs(Math.abs(item.angleDeg) - 90) < 18;

    if (!sameAngle || isVert) {
      lineGroups.push([item]);
      continue;
    }

    const sameRow = Math.abs(item.y - prev.y) <= Math.max(item.height, prev.height) * 0.45;
    const gapPx = (item.x - (prev.x + prev.width)) * vp1.width;
    const closeX = gapPx < Math.max(item.fontSizePt * 1.8, 16) && gapPx > -item.fontSizePt * 1.2;

    if (sameRow && closeX) {
      lastLine.push(item);
    } else {
      lineGroups.push([item]);
    }
  }

  let rawLines: RichTextLine[] = lineGroups.map((group) => {
    const minX = Math.min(...group.map((g) => g.x));
    const minY = Math.min(...group.map((g) => g.y));
    const maxX = Math.max(...group.map((g) => g.x + g.width));
    const maxY = Math.max(...group.map((g) => g.y + g.height));

    let text = '';
    for (let i = 0; i < group.length; i++) {
      const cur = group[i];
      if (i > 0) {
        const prev = group[i - 1];
        const gapPx = (cur.x - (prev.x + prev.width)) * vp1.width;
        if (gapPx > cur.fontSizePt * 0.22 && !text.endsWith(' ') && !cur.str.startsWith(' ')) {
          text += ' ';
        }
      }
      text += cur.str;
    }

    const avgFontPt = Math.max(
      7,
      Math.min(72, Math.round(group.reduce((s, g) => s + g.fontSizePt, 0) / group.length))
    );
    const wNorm = Math.max(0.015, maxX - minX);
    const hNorm = Math.max(0.012, maxY - minY);

    const colorHex = fullCtx
      ? sampleTextInkColorExact(
          fullCtx,
          bgCtx,
          fullCanvas.width,
          fullCanvas.height,
          minX,
          minY,
          wNorm,
          hNorm
        )
      : '111827';

    return {
      text: text.trim(),
      x: minX,
      y: minY,
      width: wNorm,
      height: hNorm,
      fontSizePt: avgFontPt,
      fontFamily: group[0].fontFamily,
      bold: group.filter((g) => g.bold).length >= group.length / 2,
      italic: group.filter((g) => g.italic).length >= group.length / 2,
      colorHex,
      angleDeg: group[0].angleDeg,
    };
  });

  // 5) Si la página es 100% escaneada (sin texto vectorial), aplicar OCR silencioso y limpiar con color mediano
  if (rawLines.length === 0) {
    onStatus?.(`Reconociendo texto de la página ${pageNumber}...`);
    rawLines = await runSilentOcrForPage(fullCanvas, heightPt);
    if (rawLines.length > 0 && bgCtx) {
      for (const line of rawLines) {
        fillOcrRectWithMedianBorderColor(
          bgCtx,
          bgCanvas.width,
          bgCanvas.height,
          line.x * bgCanvas.width - 2,
          line.y * bgCanvas.height - 2,
          line.width * bgCanvas.width + 4,
          line.height * bgCanvas.height + 4
        );
      }
    }
  }

  // 6) Exportar capa de fondo/diseño limpio si contiene gráficos visibles
  let backgroundLayer: AnalyzedPdfPage['backgroundLayer'] = null;
  if (canvasHasVisibleDesign(bgCanvas)) {
    const bgBlob = await new Promise<Blob | null>((resolve) => bgCanvas.toBlob(resolve, 'image/png'));
    if (bgBlob) {
      backgroundLayer = {
        dataUrl: bgCanvas.toDataURL('image/png'),
        pngBytes: new Uint8Array(await bgBlob.arrayBuffer()),
        pixelWidth: bgCanvas.width,
        pixelHeight: bgCanvas.height,
      };
    }
  }

  // 7) Agrupar líneas en párrafos coherentes con alineación real
  const paragraphs = groupLinesIntoParagraphs(rawLines);

  const hasMultiColumn = paragraphs.some((p1, idx) =>
    paragraphs.slice(idx + 1).some((p2) => {
      const sameVerticalBand =
        Math.min(p1.y + p1.height, p2.y + p2.height) > Math.max(p1.y, p2.y);
      const separatedX =
        Math.max(p1.x, p2.x) > Math.min(p1.x + p1.width, p2.x + p2.width) + 0.04;
      return sameVerticalBand && separatedX;
    })
  );
  const hasRotatedText = paragraphs.some((p) => Math.abs(p.angleDeg) > 10);
  const hasComplexLayout =
    Boolean(backgroundLayer) || images.length > 0 || hasMultiColumn || hasRotatedText;

  return {
    pageNumber,
    widthPt,
    heightPt,
    isLandscape,
    paragraphs,
    rawLines,
    images,
    backgroundLayer,
    hasComplexLayout,
  };
}
