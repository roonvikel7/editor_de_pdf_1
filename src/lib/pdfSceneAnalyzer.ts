import type { PDFPageProxy } from 'pdfjs-dist';
import { getPdfJs, renderPageToCanvas } from './pdfCore';

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
 * Muestrea el color REAL de la tinta del texto dentro de su caja comparándolo contra el color del borde exterior.
 * Funciona para texto negro, de colores o texto blanco sobre fondos oscuros/degradados.
 */
function sampleTextInkColor(
  ctx: CanvasRenderingContext2D,
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

  // 1) Color de fondo estimado desde un marco exterior de 2px
  const pad = 3;
  const bx0 = Math.max(0, x0 - pad);
  const by0 = Math.max(0, y0 - pad);
  const bx1 = Math.min(canvasW - 1, x0 + w + pad);
  const by1 = Math.min(canvasH - 1, y0 + h + pad);

  const bgSamples: Array<[number, number, number]> = [];
  const samplePx = (px: number, py: number) => {
    const d = ctx.getImageData(px, py, 1, 1).data;
    bgSamples.push([d[0], d[1], d[2]]);
  };
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    samplePx(Math.floor(bx0 + (bx1 - bx0) * t), by0);
    samplePx(Math.floor(bx0 + (bx1 - bx0) * t), by1);
  }
  samplePx(bx0, Math.floor((by0 + by1) / 2));
  samplePx(bx1, Math.floor((by0 + by1) / 2));

  const bgR = bgSamples.reduce((s, c) => s + c[0], 0) / Math.max(1, bgSamples.length);
  const bgG = bgSamples.reduce((s, c) => s + c[1], 0) / Math.max(1, bgSamples.length);
  const bgB = bgSamples.reduce((s, c) => s + c[2], 0) / Math.max(1, bgSamples.length);

  // 2) Buscar los píxeles dentro de la caja con mayor contraste respecto al fondo (es la tinta real)
  const data = ctx.getImageData(x0, y0, w, h).data;
  const stride = Math.max(1, Math.floor((w * h) / 600));
  const candidates: Array<{ r: number; g: number; b: number; dist: number }> = [];

  for (let p = 0; p < w * h; p += stride) {
    const idx = p * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const dist = colorDistSq(r, g, b, bgR, bgG, bgB);
    if (dist > 1400) {
      candidates.push({ r, g, b, dist });
    }
  }

  if (candidates.length === 0) {
    // Si el fondo es oscuro devolvemos blanco; si es claro devolvemos casi negro
    const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
    return bgLum < 128 ? 'FFFFFF' : '111827';
  }

  // Tomar el top 25% de píxeles más contrastantes (evita antialiasing grisáceo en los bordes del glifo)
  candidates.sort((a, b) => b.dist - a.dist);
  const topCount = Math.max(1, Math.floor(candidates.length * 0.25));
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
 * Borra una región rectangular de texto de un canvas reconstruyendo suavemente el fondo real
 * (interpolación bilineal desde los 4 bordes exteriores, preservando colores sólidos y degradados).
 */
function inpaintRectFromBorders(
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

  const topY = Math.max(0, ry0 - 2);
  const botY = Math.min(canvasH - 1, ry1 + 2);
  const leftX = Math.max(0, rx0 - 2);
  const rightX = Math.min(canvasW - 1, rx1 + 2);

  const topRow = ctx.getImageData(rx0, topY, rw, 1).data;
  const botRow = ctx.getImageData(rx0, botY, rw, 1).data;
  const leftCol = ctx.getImageData(leftX, ry0, 1, rh).data;
  const rightCol = ctx.getImageData(rightX, ry0, 1, rh).data;

  const patch = ctx.createImageData(rw, rh);
  const out = patch.data;

  for (let y = 0; y < rh; y++) {
    const ty = rh > 1 ? y / (rh - 1) : 0.5;
    const lIdx = y * 4;
    const rIdx = y * 4;
    const wy = 1 - Math.abs(ty - 0.5) * 2; // peso vertical en el centro

    for (let x = 0; x < rw; x++) {
      const tx = rw > 1 ? x / (rw - 1) : 0.5;
      const tIdx = x * 4;
      const wx = 1 - Math.abs(tx - 0.5) * 2;

      // Interpolación vertical (arriba -> abajo)
      const vR = topRow[tIdx] * (1 - ty) + botRow[tIdx] * ty;
      const vG = topRow[tIdx + 1] * (1 - ty) + botRow[tIdx + 1] * ty;
      const vB = topRow[tIdx + 2] * (1 - ty) + botRow[tIdx + 2] * ty;

      // Interpolación horizontal (izq -> der)
      const hR = leftCol[lIdx] * (1 - tx) + rightCol[rIdx] * tx;
      const hG = leftCol[lIdx + 1] * (1 - tx) + rightCol[rIdx + 1] * tx;
      const hB = leftCol[lIdx + 2] * (1 - tx) + rightCol[rIdx + 2] * tx;

      // Para líneas de texto horizontales (rw > rh), arriba/abajo están mucho más cerca del centro
      const vWeight = rw >= rh ? 0.78 + 0.12 * wx : 0.25 + 0.1 * wy;
      const hWeight = 1 - vWeight;

      const o = (y * rw + x) * 4;
      out[o] = Math.round(vR * vWeight + hR * hWeight);
      out[o + 1] = Math.round(vG * vWeight + hG * hWeight);
      out[o + 2] = Math.round(vB * vWeight + hB * hWeight);
      out[o + 3] = 255;
    }
  }

  ctx.putImageData(patch, rx0, ry0);
}

function multiplyMatrices(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Encuentra las cajas delimitadoras de imágenes embebidas (paintImageXObject / inline)
 * para recortarlas CON SU MÁSCARA REAL (círculos, esquinas redondeadas, clips) desde el canvas sin texto.
 */
async function detectEmbeddedImageBoxes(
  page: PDFPageProxy
): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  const pdfjs = await getPdfJs();
  const OPS = pdfjs.OPS;
  const viewport = page.getViewport({ scale: 1 });
  const opList = await page.getOperatorList();

  const rawBoxes: Array<{ x: number; y: number; width: number; height: number }> = [];
  const stack: number[][] = [];
  let ctm: number[] = [...viewport.transform];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    if (fn === OPS.save) {
      stack.push([...ctm]);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() || [...viewport.transform];
    } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
      ctm = multiplyMatrices(ctm, args as number[]);
    } else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintImageXObjectRepeat ||
      fn === OPS.paintInlineImageXObject
    ) {
      const corners = [
        [ctm[4], ctm[5]],
        [ctm[0] + ctm[4], ctm[1] + ctm[5]],
        [ctm[2] + ctm[4], ctm[3] + ctm[5]],
        [ctm[0] + ctm[2] + ctm[4], ctm[1] + ctm[3] + ctm[5]],
      ];
      const minX = Math.min(...corners.map((c) => c[0]));
      const maxX = Math.max(...corners.map((c) => c[0]));
      const minY = Math.min(...corners.map((c) => c[1]));
      const maxY = Math.max(...corners.map((c) => c[1]));

      const normX = Math.max(0, Math.min(0.99, minX / viewport.width));
      const normY = Math.max(0, Math.min(0.99, minY / viewport.height));
      const normW = Math.min(1 - normX, Math.max(0.01, (maxX - minX) / viewport.width));
      const normH = Math.min(1 - normY, Math.max(0.01, (maxY - minY) / viewport.height));

      // Ignorar micro-artefactos (< 3% de tamaño) y fondos de página entera (> 90% de ambos ejes)
      if (normW < 0.03 || normH < 0.03) continue;
      if (normW > 0.9 && normH > 0.9) continue;

      rawBoxes.push({ x: normX, y: normY, width: normW, height: normH });
    }
  }

  // Deduplicar cajas prácticamente idénticas (frecuente cuando PDF.js pinta imagen + soft mask)
  const deduped: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const box of rawBoxes) {
    const duplicate = deduped.some(
      (d) =>
        Math.abs(d.x - box.x) < 0.02 &&
        Math.abs(d.y - box.y) < 0.02 &&
        Math.abs(d.width - box.width) < 0.03 &&
        Math.abs(d.height - box.height) < 0.03
    );
    if (!duplicate) deduped.push(box);
  }
  return deduped;
}

/**
 * Comprueba si los 4 bordes exteriores de una caja tienen un color uniforme (ej. blanco)
 * y, si es así, recorta la imagen haciendo transparente ese fondo exterior para preservar círculos/máscaras.
 */
async function cropMaskedImageFromCanvas(
  designCanvas: HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number },
  id: string
): Promise<{ obj: SceneImageObject; isCleanUniformBg: boolean } | null> {
  const ctx = designCanvas.getContext('2d');
  if (!ctx) return null;

  const cw = designCanvas.width;
  const ch = designCanvas.height;
  const px = Math.max(0, Math.floor(box.x * cw));
  const py = Math.max(0, Math.floor(box.y * ch));
  const pw = Math.max(12, Math.min(cw - px, Math.ceil(box.width * cw)));
  const ph = Math.max(12, Math.min(ch - py, Math.ceil(box.height * ch)));

  // Muestrear las 4 esquinas exteriores para ver si el fondo es uniforme
  const corners = [
    ctx.getImageData(Math.max(0, px - 2), Math.max(0, py - 2), 1, 1).data,
    ctx.getImageData(Math.min(cw - 1, px + pw + 1), Math.max(0, py - 2), 1, 1).data,
    ctx.getImageData(Math.max(0, px - 2), Math.min(ch - 1, py + ph + 1), 1, 1).data,
    ctx.getImageData(Math.min(cw - 1, px + pw + 1), Math.min(ch - 1, py + ph + 1), 1, 1).data,
  ];
  const avgR = corners.reduce((s, c) => s + c[0], 0) / 4;
  const avgG = corners.reduce((s, c) => s + c[1], 0) / 4;
  const avgB = corners.reduce((s, c) => s + c[2], 0) / 4;
  const maxCornerSpread = Math.max(
    ...corners.map((c) => colorDistSq(c[0], c[1], c[2], avgR, avgG, avgB))
  );
  const isCleanUniformBg = maxCornerSpread < 600;

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = pw;
  cropCanvas.height = ph;
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) return null;
  cropCtx.drawImage(designCanvas, px, py, pw, ph, 0, 0, pw, ph);

  // Si el fondo circundante es uniforme (ej. blanco detrás de una foto circular),
  // aplicar flood-fill transparente desde los bordes del recorte para conservar la forma exacta (círculo/óvalo/estrella)
  if (isCleanUniformBg) {
    const imgData = cropCtx.getImageData(0, 0, pw, ph);
    const d = imgData.data;
    const visited = new Uint8Array(pw * ph);
    const queue = new Int32Array(pw * ph);
    let head = 0;
    let tail = 0;

    const tryEnqueue = (x: number, y: number) => {
      const idx = y * pw + x;
      if (visited[idx]) return;
      const o = idx * 4;
      if (colorDistSq(d[o], d[o + 1], d[o + 2], avgR, avgG, avgB) <= 950) {
        visited[idx] = 1;
        queue[tail++] = idx;
      }
    };

    for (let x = 0; x < pw; x++) {
      tryEnqueue(x, 0);
      tryEnqueue(x, ph - 1);
    }
    for (let y = 0; y < ph; y++) {
      tryEnqueue(0, y);
      tryEnqueue(pw - 1, y);
    }

    while (head < tail) {
      const idx = queue[head++];
      d[idx * 4 + 3] = 0; // transparente
      const x = idx % pw;
      const y = (idx - x) / pw;
      if (x > 0) tryEnqueue(x - 1, y);
      if (x < pw - 1) tryEnqueue(x + 1, y);
      if (y > 0) tryEnqueue(x, y - 1);
      if (y < ph - 1) tryEnqueue(x, y + 1);
    }

    cropCtx.putImageData(imgData, 0, 0);
  }

  const blob = await new Promise<Blob | null>((resolve) => cropCanvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  const pngBytes = new Uint8Array(await blob.arrayBuffer());
  const dataUrl = cropCanvas.toDataURL('image/png');

  return {
    obj: {
      id,
      dataUrl,
      pngBytes,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      pixelWidth: pw,
      pixelHeight: ph,
    },
    isCleanUniformBg,
  };
}

/**
 * Comprueba si un canvas de diseño contiene gráficos visibles reales (no solo blanco liso).
 */
function canvasHasVisibleDesign(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const step = Math.max(4, Math.floor((canvas.width * canvas.height) / 12000)) * 4;
  let nonWhite = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += step) {
    total++;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r < 244 || g < 244 || b < 244) nonWhite++;
  }
  return total > 0 && nonWhite / total > 0.004;
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

  const ctx = fullCanvas.getContext('2d');

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
              ? sampleTextInkColor(ctx, fullCanvas.width, fullCanvas.height, x, y, width, height)
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

    // Los textos verticales quedan en su propio bloque individual para preservar rotación exacta
    if (!isVert) {
      let last = base;
      for (let j = i + 1; j < lines.length; j++) {
        if (used[j]) continue;
        const cand = lines[j];
        if (Math.abs(cand.angleDeg - last.angleDeg) > 10) continue;

        const verticalGap = cand.y - (last.y + last.height);
        if (verticalGap < -last.height * 0.3) continue;
        if (verticalGap > Math.max(last.height * 0.95, 0.022)) continue;

        // Verificar solapamiento horizontal (misma columna, sin mezclar columnas vecinas)
        const overlapX =
          Math.min(last.x + last.width, cand.x + cand.width) - Math.max(last.x, cand.x);
        const minW = Math.min(last.width, cand.width);
        const sameCenter =
          Math.abs(last.x + last.width / 2 - (cand.x + cand.width / 2)) < 0.035;
        const sameLeft = Math.abs(last.x - cand.x) < 0.025;
        const horizontallyRelated = overlapX > minW * 0.35 || sameCenter || sameLeft;

        // Estilo similar (tamaño parecido y mismo color aproximado)
        const sizeRatio = cand.fontSizePt / Math.max(1, last.fontSizePt);
        const sameSize = sizeRatio >= 0.82 && sizeRatio <= 1.22;
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

    // Detectar alineación real del bloque
    let align: 'left' | 'center' | 'right' = 'left';
    if (group.length >= 2) {
      const leftSpread = Math.max(...group.map((g) => g.x)) - Math.min(...group.map((g) => g.x));
      const rightSpread =
        Math.max(...group.map((g) => g.x + g.width)) -
        Math.min(...group.map((g) => g.x + g.width));
      const centers = group.map((g) => g.x + g.width / 2);
      const centerSpread = Math.max(...centers) - Math.min(...centers);

      if (centerSpread < leftSpread * 0.7 && centerSpread < 0.025) {
        align = 'center';
      } else if (rightSpread < leftSpread * 0.6 && rightSpread < 0.02) {
        align = 'right';
      }
    } else {
      // Si es una sola línea centrada respecto a la página
      const center = primary.x + primary.width / 2;
      if (Math.abs(center - 0.5) < 0.04 && primary.width < 0.75) {
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
      fontSizePt: Math.round(
        group.reduce((s, g) => s + g.fontSizePt, 0) / group.length
      ),
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
 * Analizador completo de página PDF (equivalente web a PdfFlt.flt + ImageTool.dll + SolidCore):
 * Separa cada página en:
 * 1) Capa de diseño gráfico limpio sin texto (fondos, formas, degradados, bordes, iconos)
 * 2) Imágenes independientes recortadas con su máscara/clip real
 * 3) Párrafos y líneas de texto enriquecidos (color real, fuente mapeada, negrita, alineación, rotación)
 */
export async function analyzePdfPage(
  page: PDFPageProxy,
  pageNumber: number,
  onStatus?: (msg: string) => void
): Promise<AnalyzedPdfPage> {
  const pdfjs = await getPdfJs();
  const vp1 = page.getViewport({ scale: 1 });
  const widthPt = vp1.width;
  const heightPt = vp1.height;
  const isLandscape = widthPt > heightPt;

  // 1) Renderizar la página completa a alta resolución (2.0x)
  const renderScale = 2.0;
  const fullCanvas = document.createElement('canvas');
  await renderPageToCanvas(page, fullCanvas, renderScale);
  const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });

  // 2) Extraer todos los elementos de texto vectorial con posición, fuente, rotación y COLOR REAL
  const textContent = await page.getTextContent();
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

  // Agrupar fragmentos contiguos en líneas
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
      ? sampleTextInkColor(fullCtx, fullCanvas.width, fullCanvas.height, minX, minY, wNorm, hNorm)
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

  // Si la página no tiene texto seleccionable (escaneo / curvas), aplicar OCR silencioso automático
  if (rawLines.length === 0) {
    onStatus?.(`Reconociendo texto de la página ${pageNumber}...`);
    rawLines = await runSilentOcrForPage(fullCanvas, heightPt);
  }

  // 3) Construir el lienzo de DISEÑO LIMPIO SIN TEXTO (designCanvas)
  const designCanvas = document.createElement('canvas');
  designCanvas.width = fullCanvas.width;
  designCanvas.height = fullCanvas.height;
  const designCtx = designCanvas.getContext('2d', { willReadFrequently: true });
  if (designCtx) {
    designCtx.drawImage(fullCanvas, 0, 0);

    // Borrar limpiamente cada línea/ítem de texto con inpainting direccional del fondo real
    const boxesToErase = rawItems.length > 0 ? rawItems : rawLines;
    for (const item of boxesToErase) {
      const padX = Math.max(3, Math.ceil(item.fontSizePt * 0.16 * renderScale));
      const padY = Math.max(3, Math.ceil(item.fontSizePt * 0.18 * renderScale));
      inpaintRectFromBorders(
        designCtx,
        designCanvas.width,
        designCanvas.height,
        item.x * designCanvas.width - padX,
        item.y * designCanvas.height - padY,
        item.width * designCanvas.width + padX * 2,
        item.height * designCanvas.height + padY * 2
      );
    }
  }

  // 4) Extraer imágenes independientes CON SU MÁSCARA REAL (círculos, recortes) desde designCanvas
  const imgBoxes = await detectEmbeddedImageBoxes(page).catch(() => []);
  const images: SceneImageObject[] = [];

  for (let i = 0; i < imgBoxes.length; i++) {
    const box = imgBoxes[i];
    const cropped = await cropMaskedImageFromCanvas(designCanvas, box, `img-${pageNumber}-${i}`);
    if (!cropped) continue;
    images.push(cropped.obj);

    // Si la imagen estaba sobre fondo uniforme, limpiarla de la capa de fondo para que sea 100% movible sin sombra duplicada
    if (cropped.isCleanUniformBg && designCtx) {
      inpaintRectFromBorders(
        designCtx,
        designCanvas.width,
        designCanvas.height,
        box.x * designCanvas.width - 2,
        box.y * designCanvas.height - 2,
        box.width * designCanvas.width + 4,
        box.height * designCanvas.height + 4
      );
    }
  }

  // 5) Exportar capa de diseño de fondo si contiene elementos gráficos visibles (fondos, formas, líneas, degradados)
  let backgroundLayer: AnalyzedPdfPage['backgroundLayer'] = null;
  if (canvasHasVisibleDesign(designCanvas)) {
    const bgBlob = await new Promise<Blob | null>((resolve) =>
      designCanvas.toBlob(resolve, 'image/png')
    );
    if (bgBlob) {
      backgroundLayer = {
        dataUrl: designCanvas.toDataURL('image/png'),
        pngBytes: new Uint8Array(await bgBlob.arrayBuffer()),
        pixelWidth: designCanvas.width,
        pixelHeight: designCanvas.height,
      };
    }
  }

  // 6) Agrupar líneas en párrafos coherentes con alineación real
  const paragraphs = groupLinesIntoParagraphs(rawLines);

  // Determinar si la página tiene diseño gráfico/multi-columna (para elegir layout absoluto vs flujo en Word)
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
