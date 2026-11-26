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
  colorHex: string; // sin '#'
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

export type SceneGraphicElement =
  | {
      kind: 'shape';
      id: string;
      zOrder: number;
      shapeType: 'rect' | 'roundRect' | 'ellipse' | 'line';
      x: number; // 0..1
      y: number; // 0..1
      width: number; // 0..1
      height: number; // 0..1
      fillHex?: string; // sin '#'
      fillAlpha?: number; // 0..1
      strokeHex?: string; // sin '#'
      strokeWidthPt?: number;
      rectRadiusRatio?: number;
      lineFlipH?: boolean;
      lineFlipV?: boolean;
    }
  | {
      kind: 'graphic';
      id: string;
      zOrder: number;
      dataUrl: string;
      pngBytes: Uint8Array;
      x: number; // 0..1
      y: number; // 0..1
      width: number; // 0..1
      height: number; // 0..1
      pixelWidth: number;
      pixelHeight: number;
    };

export interface AnalyzedPdfPage {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  isLandscape: boolean;
  /** Color sólido de fondo de la página/diapositiva (sin '#') */
  pageBackgroundHex: string;
  /** Todos los elementos visuales separados (formas nativas editables, grupos vectoriales e imágenes) en z-order real */
  elements: SceneGraphicElement[];
  /** Textos agrupados en párrafos editables */
  paragraphs: RichTextParagraph[];
  rawLines: RichTextLine[];
  /** Solo si la página entera es 1 foto escaneada sin vectores ni texto nativo */
  scannedFallbackBg: {
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
  if (!ctx) throw new Error('No se pudo crear contexto 2D.');

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

  await page.render(renderParams as Parameters<PDFPageProxy['render']>[0]).promise;
  return canvas;
}

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

function applyMatrixToPoint(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

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
 * Encuentra el bounding box exacto de píxeles visibles (alpha > 8) y además analiza si el contenido
 * es un color sólido uniforme (con su color real y opacidad real directamente del render de PDF.js).
 */
function analyzeIsolatedCanvas(canvas: HTMLCanvasElement): {
  bbox: { x: number; y: number; w: number; h: number };
  isUniformSolid: boolean;
  dominantHex: string;
  avgAlpha: number;
  hasInteriorFill: boolean;
} | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let visibleCount = 0;

  for (let y = 0; y < height; y++) {
    const rowOff = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[rowOff + x * 4 + 3] > 8) {
        visibleCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY || visibleCount < 4) return null;

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;

  // Muestrear píxeles opacos dentro del bbox para medir color real, uniformidad y transparencia
  const stride = Math.max(1, Math.floor((bw * bh) / 1800));
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumA = 0;
  let sampleCount = 0;
  const samples: Array<[number, number, number, number]> = [];

  for (let p = 0; p < bw * bh; p += stride) {
    const lx = p % bw;
    const ly = (p - lx) / bw;
    const o = ((minY + ly) * width + (minX + lx)) * 4;
    const a = data[o + 3];
    if (a > 30) {
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      sumR += r;
      sumG += g;
      sumB += b;
      sumA += a;
      sampleCount++;
      samples.push([r, g, b, a]);
    }
  }

  if (sampleCount === 0) return null;

  const avgR = sumR / sampleCount;
  const avgG = sumG / sampleCount;
  const avgB = sumB / sampleCount;
  const avgAlpha = sumA / (sampleCount * 255);

  // Comprobar si al menos el 92% de los píxeles visibles tienen el mismo color sólido (sin degradados ni múltiples colores)
  let matching = 0;
  for (const [r, g, b, a] of samples) {
    if (colorDistSq(r, g, b, avgR, avgG, avgB) < 650 && Math.abs(a / 255 - avgAlpha) < 0.25) {
      matching++;
    }
  }
  const isUniformSolid = matching / sampleCount >= 0.92;

  // Comprobar si el centro del bbox está pintado (distingue forma rellena de solo contorno/borde)
  const cx = Math.floor(minX + bw / 2);
  const cy = Math.floor(minY + bh / 2);
  const centerAlpha = data[(cy * width + cx) * 4 + 3];
  const hasInteriorFill = centerAlpha > 20;

  return {
    bbox: { x: minX, y: minY, w: bw, h: bh },
    isUniformSolid,
    dominantHex: rgbToHex(avgR, avgG, avgB),
    avgAlpha: Math.min(1, Math.max(0.05, avgAlpha)),
    hasInteriorFill,
  };
}

/**
 * Clasifica un path `DrawOPS` de PDF.js en forma geométrica nativa editable (`rect`, `roundRect`, `ellipse`, `line`)
 * o `'custom'` si es una forma vectorial personalizada.
 */
function classifyDrawOpsPath(
  drawData: ArrayLike<number> | undefined,
  ctm: number[],
  hasFill: boolean,
  hasStroke: boolean
): {
  kind: 'rect' | 'roundRect' | 'ellipse' | 'line' | 'custom';
  lineFlipH?: boolean;
  lineFlipV?: boolean;
  rectRadiusRatio?: number;
} {
  if (!drawData || drawData.length < 3) return { kind: 'custom' };

  let moves = 0;
  let lines = 0;
  let curves = 0;
  let quads = 0;
  const linePts: Array<[number, number]> = [];
  const curveEndPts: Array<[number, number]> = [];
  let curX = 0;
  let curY = 0;

  for (let i = 0; i < drawData.length; ) {
    const cmd = drawData[i++];
    if (cmd === 0) {
      moves++;
      curX = drawData[i++];
      curY = drawData[i++];
      linePts.push(applyMatrixToPoint(ctm, curX, curY));
    } else if (cmd === 1) {
      lines++;
      curX = drawData[i++];
      curY = drawData[i++];
      linePts.push(applyMatrixToPoint(ctm, curX, curY));
    } else if (cmd === 2) {
      curves++;
      i += 4;
      curX = drawData[i++];
      curY = drawData[i++];
      curveEndPts.push(applyMatrixToPoint(ctm, curX, curY));
    } else if (cmd === 3) {
      quads++;
      i += 2;
      curX = drawData[i++];
      curY = drawData[i++];
      curveEndPts.push(applyMatrixToPoint(ctm, curX, curY));
    } else if (cmd === 4) {
      // closePath
    } else {
      return { kind: 'custom' };
    }
  }

  if (moves !== 1 || quads > 0) return { kind: 'custom' };

  // 1) Línea recta simple
  if (lines === 1 && curves === 0 && hasStroke && !hasFill && linePts.length === 2) {
    const [p0, p1] = linePts;
    return {
      kind: 'line',
      lineFlipH: p1[0] < p0[0],
      lineFlipV: p1[1] < p0[1],
    };
  }

  // 2) Rectángulo puro ortogonal
  if (curves === 0 && (lines === 3 || lines === 4)) {
    const pts = linePts.slice(0, 4);
    if (pts.length >= 4) {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const tolX = Math.max(1.5, (maxX - minX) * 0.015);
      const tolY = Math.max(1.5, (maxY - minY) * 0.015);
      const allOnCorners = pts.every(
        ([px, py]) =>
          (Math.abs(px - minX) <= tolX || Math.abs(px - maxX) <= tolX) &&
          (Math.abs(py - minY) <= tolY || Math.abs(py - maxY) <= tolY)
      );
      if (allOnCorners) return { kind: 'rect' };
    }
  }

  // 3) Rectángulo con esquinas redondeadas (4 arcos de esquina + 4 lados rectos)
  if (curves === 4 && lines >= 3 && lines <= 5) {
    const allPts = [...linePts, ...curveEndPts];
    const xs = allPts.map((p) => p[0]);
    const ys = allPts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w > 20 && h > 20) {
      const segLengths: number[] = [];
      for (let k = 1; k < linePts.length; k++) {
        const dx = Math.abs(linePts[k][0] - linePts[k - 1][0]);
        const dy = Math.abs(linePts[k][1] - linePts[k - 1][1]);
        if (dx < 2 || dy < 2) segLengths.push(Math.max(dx, dy));
      }
      if (segLengths.length >= 2) {
        const minSide = Math.min(w, h);
        const maxSeg = Math.max(...segLengths);
        const estRadius = Math.max(0.02, Math.min(0.22, ((Math.max(w, h) - maxSeg) / 2) / minSide));
        return { kind: 'roundRect', rectRadiusRatio: estRadius };
      }
    }
  }

  // 4) Elipse / Círculo
  if (curves === 4 && lines === 0) {
    return { kind: 'ellipse' };
  }

  return { kind: 'custom' };
}

interface VectorOpRecord {
  opIdx: number;
  x: number;
  y: number;
  width: number;
  height: number;
  shapeKind: 'rect' | 'roundRect' | 'ellipse' | 'line' | 'custom';
  strokeWidthPt: number;
  hasFill: boolean;
  hasStroke: boolean;
  lineFlipH?: boolean;
  lineFlipV?: boolean;
  rectRadiusRatio?: number;
}

function clusterCustomVectorOps(ops: VectorOpRecord[]): VectorOpRecord[][] {
  if (ops.length === 0) return [];
  const n = ops.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < n; i++) {
    const a = ops[i];
    const areaA = a.width * a.height;
    // Nunca fusionar una tarjeta/fondo grande (> 30% de página) con adornos/objetos encima de ella
    if (areaA > 0.3) continue;
    for (let j = i + 1; j < n; j++) {
      const b = ops[j];
      const areaB = b.width * b.height;
      if (areaB > 0.3) continue;
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);

      if (ox > 0 && oy > 0) {
        const inter = ox * oy;
        const minArea = Math.min(areaA, areaB);
        if (minArea > 0 && inter / minArea > 0.25) {
          union(i, j);
        }
      } else {
        const bothTiny = a.width < 0.04 && a.height < 0.04 && b.width < 0.04 && b.height < 0.04;
        if (bothTiny && ox > -0.008 && oy > -0.008) {
          union(i, j);
        }
      }
    }
  }

  const map = new Map<number, VectorOpRecord[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = map.get(root);
    if (list) list.push(ops[i]);
    else map.set(root, [ops[i]]);
  }
  return Array.from(map.values()).sort((a, b) => a[0].opIdx - b[0].opIdx);
}

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
 * Descompositor profesional de objetos PDF verificado pixel-a-pixel contra el render real de PDF.js:
 * - Ignora los rectángulos internos de `SMask` / transparencia (nunca genera cajas negras fantasma).
 * - Verifica CADA forma nativa (`rect`, `roundRect`, `ellipse`, `line`) directamente contra su render aislado
 *   de PDF.js para obtener su COLOR REAL (ICC/CMYK/RGB/Gray), su OPACIDAD REAL y su BBOX REAL.
 * - Si un elemento tiene degradados, sombras o recortes curvos, lo extrae limpio con transparencia exacta.
 * - Cada forma, adorno/pétalo, imagen y cuadro de texto queda separado e independiente (sin imagen gigante de fondo).
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

  const TEXT_DRAW_OPS = new Set<number>([
    OPS.showText,
    OPS.showSpacedText,
    OPS.nextLineShowText,
    OPS.nextLineSetSpacingShowText,
  ]);

  const IMAGE_DRAW_OPS = new Set<number>([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageXObjectRepeat,
    OPS.paintInlineImageXObjectGroup,
  ]);

  const FILL_OPS = new Set<number>([
    OPS.fill,
    OPS.eoFill,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
  ]);

  const STROKE_OPS = new Set<number>([
    OPS.stroke,
    OPS.closeStroke,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
  ]);

  const ALL_VECTOR_PAINT_OPS = new Set<number>([
    ...FILL_OPS,
    ...STROKE_OPS,
    OPS.shadingFill,
    OPS.rawFillPath,
    OPS.paintImageMaskXObject,
    OPS.paintImageMaskXObjectGroup,
    OPS.paintImageMaskXObjectRepeat,
    OPS.paintSolidColorImageMask,
  ]);

  // 1) Obtener operatorList, textContent y renders de referencia
  const [opList, textContent, fullCanvas, noTextCanvas] = await Promise.all([
    page.getOperatorList(),
    page.getTextContent(),
    renderPageFiltered(page, renderScale, { transparent: false }),
    renderPageFiltered(page, renderScale, {
      transparent: false,
      operationsFilter: (i, list) => !TEXT_DRAW_OPS.has(list.fnArray[i]),
    }),
  ]);
  const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });
  const noTextCtx = noTextCanvas.getContext('2d', { willReadFrequently: true });

  // 2) Marcar operaciones internas de SMask (sombras/máscaras de opacidad) para NO extraerlas como formas opacas
  const opCount = opList.fnArray.length;
  const isSMaskOp = new Uint8Array(opCount);
  const groupStack: boolean[] = [];
  let smaskDepth = 0;

  for (let i = 0; i < opCount; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[] | undefined;
    if (fn === OPS.beginGroup) {
      const grp = args?.[0] as { smask?: unknown; isGray?: boolean } | undefined;
      const startsSMask = Boolean(grp && (grp.smask || grp.isGray));
      groupStack.push(startsSMask);
      if (startsSMask) smaskDepth++;
    }
    if (smaskDepth > 0) isSMaskOp[i] = 1;
    if (fn === OPS.endGroup) {
      const wasSMask = groupStack.pop();
      if (wasSMask) smaskDepth = Math.max(0, smaskDepth - 1);
    }
  }

  // 3) Recorrer opList para catalogar geometrías e imágenes fuera de definiciones internas de SMask
  interface GState {
    ctm: number[];
    lineWidth: number;
  }

  const stack: GState[] = [];
  let state: GState = { ctm: [...vp1.transform], lineWidth: 1 };
  const vectorOps: VectorOpRecord[] = [];
  const imageOpIndices: number[] = [];

  for (let i = 0; i < opCount; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[] | undefined;

    if (fn === OPS.save) {
      stack.push({ ctm: [...state.ctm], lineWidth: state.lineWidth });
    } else if (fn === OPS.restore) {
      state = stack.pop() || { ctm: [...vp1.transform], lineWidth: 1 };
    } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
      state.ctm = multiplyMatrices(state.ctm, args as number[]);
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push({ ctm: [...state.ctm], lineWidth: state.lineWidth });
      const mat = args?.[0];
      if (Array.isArray(mat) && mat.length >= 6) {
        state.ctm = multiplyMatrices(state.ctm, mat as number[]);
      }
    } else if (fn === OPS.paintFormXObjectEnd) {
      state = stack.pop() || state;
    } else if (fn === OPS.beginGroup) {
      stack.push({ ctm: [...state.ctm], lineWidth: state.lineWidth });
      const grp = args?.[0] as { matrix?: number[] } | undefined;
      if (Array.isArray(grp?.matrix) && grp.matrix.length >= 6) {
        state.ctm = multiplyMatrices(state.ctm, grp.matrix);
      }
    } else if (fn === OPS.endGroup) {
      state = stack.pop() || state;
    } else if (fn === OPS.setLineWidth && typeof args?.[0] === 'number') {
      state.lineWidth = args[0];
    }

    // No extraer definiciones internas de SMask como objetos sueltos
    if (isSMaskOp[i]) continue;

    if (IMAGE_DRAW_OPS.has(fn)) {
      imageOpIndices.push(i);
    } else if (fn === OPS.shadingFill) {
      vectorOps.push({
        opIdx: i,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        shapeKind: 'custom',
        strokeWidthPt: 0,
        hasFill: true,
        hasStroke: false,
      });
    } else if (fn === OPS.constructPath && Array.isArray(args)) {
      const pathOp = args[0] as number;
      const hasFill = FILL_OPS.has(pathOp);
      const hasStroke = STROKE_OPS.has(pathOp);
      if (!hasFill && !hasStroke) continue;

      const dataArr = (args[1] as Array<ArrayLike<number>> | undefined)?.[0];
      const minMax = args[2] as number[] | undefined;
      if (!minMax || minMax.length < 4) continue;

      const c1 = applyMatrixToPoint(state.ctm, minMax[0], minMax[1]);
      const c2 = applyMatrixToPoint(state.ctm, minMax[2], minMax[1]);
      const c3 = applyMatrixToPoint(state.ctm, minMax[0], minMax[3]);
      const c4 = applyMatrixToPoint(state.ctm, minMax[2], minMax[3]);
      const minX = Math.min(c1[0], c2[0], c3[0], c4[0]);
      const maxX = Math.max(c1[0], c2[0], c3[0], c4[0]);
      const minY = Math.min(c1[1], c2[1], c3[1], c4[1]);
      const maxY = Math.max(c1[1], c2[1], c3[1], c4[1]);

      const rawNormX = minX / vp1.width;
      const rawNormY = minY / vp1.height;
      const rawNormW = (maxX - minX) / vp1.width;
      const rawNormH = (maxY - minY) / vp1.height;

      const normX = Math.max(0, Math.min(0.999, rawNormX));
      const normY = Math.max(0, Math.min(0.999, rawNormY));
      const normW = Math.min(1 - normX, Math.max(0.001, (Math.min(vp1.width, maxX) - Math.max(0, minX)) / vp1.width));
      const normH = Math.min(1 - normY, Math.max(0.001, (Math.min(vp1.height, maxY) - Math.max(0, minY)) / vp1.height));

      if (normW < 0.001 && normH < 0.001) continue;

      const classified = classifyDrawOpsPath(dataArr, state.ctm, hasFill, hasStroke);
      const ctmScale = Math.hypot(state.ctm[0], state.ctm[1]) || 1;
      const strokeWidthPt = Math.max(0.5, Math.round(state.lineWidth * ctmScale * 10) / 10);

      const overflowsPage =
        rawNormX < -0.02 || rawNormY < -0.02 || rawNormX + rawNormW > 1.02 || rawNormY + rawNormH > 1.02;

      vectorOps.push({
        opIdx: i,
        x: normX,
        y: normY,
        width: normW,
        height: normH,
        shapeKind: overflowsPage ? 'custom' : classified.kind,
        strokeWidthPt,
        hasFill,
        hasStroke,
        lineFlipH: classified.lineFlipH,
        lineFlipV: classified.lineFlipV,
        rectRadiusRatio: classified.rectRadiusRatio,
      });
    }
  }

  // Función auxiliar: renderizar un conjunto exacto de opIndices aislado en canvas transparente (preservando SMasks y clips)
  const renderOpsIsolated = (allowedOpSet: Set<number>, scale = renderScale) =>
    renderPageFiltered(page, scale, {
      transparent: true,
      operationsFilter: (i, list) => {
        // Dejar pasar definiciones internas de SMask para que sombras/resplandores funcionen intactos
        if (isSMaskOp[i]) return true;
        const fn = list.fnArray[i];
        if (TEXT_DRAW_OPS.has(fn)) return false;
        if (IMAGE_DRAW_OPS.has(fn)) return allowedOpSet.has(i);
        if (ALL_VECTOR_PAINT_OPS.has(fn)) return allowedOpSet.has(i);
        if (fn === OPS.constructPath) {
          if (allowedOpSet.has(i)) return true;
          const pathOp = (list.argsArray[i] as unknown[] | undefined)?.[0];
          const nextFn = list.fnArray[i + 1];
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

  const canvasBboxToGraphic = async (
    isolated: HTMLCanvasElement,
    bbox: { x: number; y: number; w: number; h: number },
    zOrder: number,
    id: string
  ): Promise<SceneGraphicElement | null> => {
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = bbox.w;
    cropCanvas.height = bbox.h;
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) return null;
    cropCtx.drawImage(isolated, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h);
    const blob = await new Promise<Blob | null>((resolve) => cropCanvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;

    return {
      kind: 'graphic',
      id,
      zOrder,
      dataUrl: cropCanvas.toDataURL('image/png'),
      pngBytes: new Uint8Array(await blob.arrayBuffer()),
      x: bbox.x / isolated.width,
      y: bbox.y / isolated.height,
      width: bbox.w / isolated.width,
      height: bbox.h / isolated.height,
      pixelWidth: bbox.w,
      pixelHeight: bbox.h,
    };
  };

  // 4) Procesar formas geométricas candidatas VERIFICANDO SIEMPRE su color/visibilidad reales desde PDF.js!
  const elements: SceneGraphicElement[] = [];
  let pageBackgroundHex = 'FFFFFF';
  let foundPageBg = false;
  const customVectorOps: VectorOpRecord[] = [];

  for (const v of vectorOps) {
    if (v.shapeKind === 'custom') {
      customVectorOps.push(v);
      continue;
    }

    const isTinyNoise = v.shapeKind !== 'line' && v.width < 0.008 && v.height < 0.008;
    if (isTinyNoise) continue;

    // Renderizar SOLO esta forma en PDF.js para conocer su visibilidad, bbox, color y opacidad 100% REALES
    const isolated = await renderOpsIsolated(new Set([v.opIdx]), 1.5);
    const info = analyzeIsolatedCanvas(isolated);
    if (!info) continue; // Forma invisible (ca=0 o recortada por clip) → descartada!

    const normX = info.bbox.x / isolated.width;
    const normY = info.bbox.y / isolated.height;
    const normW = info.bbox.w / isolated.width;
    const normH = info.bbox.h / isolated.height;

    // Si es un rectángulo de fondo de página completa (>= 93% ancho y alto) de color sólido opaco → fondo nativo!
    if (
      !foundPageBg &&
      v.shapeKind === 'rect' &&
      info.isUniformSolid &&
      info.hasInteriorFill &&
      info.avgAlpha > 0.9 &&
      normW >= 0.93 &&
      normH >= 0.93
    ) {
      pageBackgroundHex = info.dominantHex;
      foundPageBg = true;
      continue;
    }

    // Si es una forma geométrica pura y color sólido real → forma nativa editable de PowerPoint con el COLOR REAL!
    if (info.isUniformSolid) {
      const isOnlyStroke = v.shapeKind === 'line' || (!info.hasInteriorFill && v.hasStroke);
      elements.push({
        kind: 'shape',
        id: `shp-${pageNumber}-${v.opIdx}`,
        zOrder: v.opIdx,
        shapeType: v.shapeKind,
        x: normX,
        y: normY,
        width: normW,
        height: normH,
        fillHex: isOnlyStroke ? undefined : info.dominantHex,
        fillAlpha: isOnlyStroke ? undefined : info.avgAlpha,
        strokeHex: isOnlyStroke ? info.dominantHex : undefined,
        strokeWidthPt: isOnlyStroke ? Math.max(0.75, v.strokeWidthPt) : 0,
        rectRadiusRatio: v.rectRadiusRatio,
        lineFlipH: v.lineFlipH,
        lineFlipV: v.lineFlipV,
      });
    } else {
      // Tiene borde + relleno de distinto color, degradado o sombra → exportar como objeto transparente fiel!
      const hiRes = await renderOpsIsolated(new Set([v.opIdx]), renderScale);
      const hiInfo = analyzeIsolatedCanvas(hiRes);
      if (hiInfo) {
        const g = await canvasBboxToGraphic(hiRes, hiInfo.bbox, v.opIdx, `shp-g-${pageNumber}-${v.opIdx}`);
        if (g) elements.push(g);
      }
    }
  }

  // 5) Procesar grupos vectoriales personalizados (`custom` — pétalos, adornos, logos vectoriales)
  const clusters = clusterCustomVectorOps(customVectorOps);
  const maxClusters = 28;
  const finalClusters =
    clusters.length <= maxClusters
      ? clusters
      : [...clusters.slice(0, maxClusters - 1), clusters.slice(maxClusters - 1).flat()];

  for (let c = 0; c < finalClusters.length; c++) {
    const group = finalClusters[c];
    const allowed = new Set(group.map((g) => g.opIdx));
    const isolated = await renderOpsIsolated(allowed, renderScale);
    const info = analyzeIsolatedCanvas(isolated);
    if (!info) continue;

    const normW = info.bbox.w / isolated.width;
    const normH = info.bbox.h / isolated.height;
    if (normW < 0.01 && normH < 0.01) continue;

    // Si es un fondo sólido completo pintado por un path complejo
    if (!foundPageBg && info.isUniformSolid && info.hasInteriorFill && info.avgAlpha > 0.9 && normW >= 0.94 && normH >= 0.94) {
      pageBackgroundHex = info.dominantHex;
      foundPageBg = true;
      continue;
    }

    const graphic = await canvasBboxToGraphic(isolated, info.bbox, group[0].opIdx, `vec-${pageNumber}-${c}`);
    if (graphic) elements.push(graphic);
  }

  // 6) Procesar imágenes raster individuales (escudo, San Francisco, fotos de ejercicios, fotos circulares)
  let fullPageRasterImageOpIdx: number | null = null;
  const maxImages = 20;
  for (let k = 0; k < Math.min(imageOpIndices.length, maxImages); k++) {
    const targetIdx = imageOpIndices[k];
    const isolated = await renderOpsIsolated(new Set([targetIdx]), renderScale);
    const info = analyzeIsolatedCanvas(isolated);
    if (!info) continue;

    const normW = info.bbox.w / isolated.width;
    const normH = info.bbox.h / isolated.height;
    if (normW < 0.015 && normH < 0.015) continue;

    if (normW > 0.92 && normH > 0.92) {
      fullPageRasterImageOpIdx = targetIdx;
      continue;
    }

    const graphic = await canvasBboxToGraphic(isolated, info.bbox, targetIdx, `img-${pageNumber}-${k}`);
    if (graphic) elements.push(graphic);
  }

  // Ordenar todos los elementos visuales exactamente por su orden de dibujo original (zOrder)
  elements.sort((a, b) => a.zOrder - b.zOrder);

  // Si aún no detectamos color de fondo, muestrear esquinas del canvas sin texto
  if (!foundPageBg && noTextCtx) {
    const c1 = noTextCtx.getImageData(2, 2, 1, 1).data;
    const c2 = noTextCtx.getImageData(noTextCanvas.width - 3, 2, 1, 1).data;
    if (colorDistSq(c1[0], c1[1], c1[2], c2[0], c2[1], c2[2]) < 200) {
      pageBackgroundHex = rgbToHex(c1[0], c1[1], c1[2]);
    }
  }

  // 7) Extraer todos los textos vectoriales con fuente mapeada, tamaño, rotación y COLOR REAL exacto
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
          noTextCtx,
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

  // 8) Caso especial: página 100% escaneada (solo foto de página completa sin texto vectorial)
  let scannedFallbackBg: AnalyzedPdfPage['scannedFallbackBg'] = null;
  if (rawLines.length === 0) {
    onStatus?.(`Reconociendo texto de la página ${pageNumber}...`);
    rawLines = await runSilentOcrForPage(fullCanvas, heightPt);
    if (fullPageRasterImageOpIdx !== null && noTextCtx) {
      for (const line of rawLines) {
        fillOcrRectWithMedianBorderColor(
          noTextCtx,
          noTextCanvas.width,
          noTextCanvas.height,
          line.x * noTextCanvas.width - 2,
          line.y * noTextCanvas.height - 2,
          line.width * noTextCanvas.width + 4,
          line.height * noTextCanvas.height + 4
        );
      }
      const bgBlob = await new Promise<Blob | null>((resolve) =>
        noTextCanvas.toBlob(resolve, 'image/png')
      );
      if (bgBlob) {
        scannedFallbackBg = {
          dataUrl: noTextCanvas.toDataURL('image/png'),
          pngBytes: new Uint8Array(await bgBlob.arrayBuffer()),
          pixelWidth: noTextCanvas.width,
          pixelHeight: noTextCanvas.height,
        };
      }
    }
  } else if (fullPageRasterImageOpIdx !== null && elements.length === 0) {
    const bgBlob = await new Promise<Blob | null>((resolve) =>
      noTextCanvas.toBlob(resolve, 'image/png')
    );
    if (bgBlob) {
      scannedFallbackBg = {
        dataUrl: noTextCanvas.toDataURL('image/png'),
        pngBytes: new Uint8Array(await bgBlob.arrayBuffer()),
        pixelWidth: noTextCanvas.width,
        pixelHeight: noTextCanvas.height,
      };
    }
  }

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
    elements.length > 0 ||
    pageBackgroundHex !== 'FFFFFF' ||
    Boolean(scannedFallbackBg) ||
    hasMultiColumn ||
    hasRotatedText;

  return {
    pageNumber,
    widthPt,
    heightPt,
    isLandscape,
    pageBackgroundHex,
    elements,
    paragraphs,
    rawLines,
    scannedFallbackBg,
    hasComplexLayout,
  };
}
