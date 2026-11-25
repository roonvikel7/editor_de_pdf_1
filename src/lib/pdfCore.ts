import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { ExtractedTextBlock } from '../types/pdf';

type PdfJsModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJsModule> | null = null;

/**
 * Carga diferida de PDF.js (equivalente al motor de renderizado de libPdfCore.dll).
 * El worker, CMaps y fuentes estándar se cargan desde jsDelivr CDN (0 bytes en Vercel)
 * y el Service Worker los cachea permanentemente en el navegador para uso offline.
 */
export async function getPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      const version = pdfjs.version || '6.5.438';
      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export async function loadPdfDocument(data: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfJs();
  const version = pdfjs.version || '6.5.438';
  const copy = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data.slice(0));

  const loadingTask = pdfjs.getDocument({
    data: copy,
    cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/standard_fonts/`,
    useSystemFonts: true,
  });

  return loadingTask.promise;
}

export async function destroyPdfDocument(pdf: PDFDocumentProxy | null | undefined): Promise<void> {
  if (!pdf) return;
  try {
    await pdf.cleanup();
  } catch {
    // ignore
  }
  const maybeDestroy = (pdf as unknown as { destroy?: () => Promise<void> | void }).destroy;
  if (typeof maybeDestroy === 'function') {
    try {
      await maybeDestroy.call(pdf);
    } catch {
      // ignore
    }
  }
}

export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
  extraRotation = 0
): Promise<{ width: number; height: number; viewportWidth: number; viewportHeight: number }> {
  const totalRotation = (page.rotate + extraRotation) % 360;
  const viewport = page.getViewport({ scale, rotation: totalRotation });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
  canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('No se pudo inicializar el contexto 2D del lienzo.');

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  const renderTask = page.render({
    canvasContext: ctx,
    canvas,
    viewport,
  });

  await renderTask.promise;
  ctx.restore();

  return {
    width: canvas.width,
    height: canvas.height,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  };
}

export async function generatePdfThumbnail(data: ArrayBuffer): Promise<{
  pageCount: number;
  thumbnail: string;
}> {
  const pdf = await loadPdfDocument(data);
  try {
    const pageCount = pdf.numPages;
    const page = await pdf.getPage(1);
    const baseVp = page.getViewport({ scale: 1 });
    const targetWidth = 220;
    const scale = targetWidth / baseVp.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    }

    const thumbnail = canvas.toDataURL('image/webp', 0.72);
    return { pageCount, thumbnail };
  } finally {
    await destroyPdfDocument(pdf);
  }
}

/**
 * Extrae bloques de texto agrupados por líneas lógicas con coordenadas normalizadas (0..1).
 * Se usa tanto para el modo "Editar texto existente" (estilo PDFelement) como para los conversores.
 */
export async function extractPageTextBlocks(
  page: PDFPageProxy,
  extraRotation = 0
): Promise<ExtractedTextBlock[]> {
  const totalRotation = (page.rotate + extraRotation) % 360;
  const viewport = page.getViewport({ scale: 1, rotation: totalRotation });
  const textContent = await page.getTextContent();
  const pdfjs = await getPdfJs();

  interface RawItem {
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    fontName: string;
  }

  const rawItems: RawItem[] = [];
  for (const item of textContent.items) {
    if (!('str' in item)) continue;
    const str = item.str;
    if (!str || !str.trim()) continue;

    // Transformar coordenadas del espacio PDF al espacio del viewport (top-left)
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]) || Math.hypot(tx[0], tx[1]) || 12;
    const x = tx[4];
    const yTop = tx[5] - fontHeight * 0.85;
    const width = Math.max(item.width * (viewport.scale || 1), fontHeight * 0.5);

    rawItems.push({
      str,
      x,
      y: yTop,
      width,
      height: fontHeight * 1.15,
      fontSize: Math.max(6, Math.round(fontHeight * 10) / 10),
      fontName: item.fontName || 'Helvetica',
    });
  }

  if (rawItems.length === 0) return [];

  // Ordenar de arriba a abajo y de izquierda a derecha
  rawItems.sort((a, b) => {
    const dy = a.y - b.y;
    if (Math.abs(dy) > Math.min(a.height, b.height) * 0.55) return dy;
    return a.x - b.x;
  });

  // Agrupar elementos contiguos de la misma línea en bloques cómodos de editar
  const lines: RawItem[][] = [];
  for (const item of rawItems) {
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
      lines.push([item]);
      continue;
    }
    const prev = lastLine[lastLine.length - 1];
    const sameRow = Math.abs(item.y - prev.y) <= Math.max(item.height, prev.height) * 0.5;
    const gap = item.x - (prev.x + prev.width);
    const closeHorizontally = gap < Math.max(item.fontSize * 3.5, 28) && gap > -item.fontSize * 1.5;

    if (sameRow && closeHorizontally) {
      lastLine.push(item);
    } else {
      lines.push([item]);
    }
  }

  return lines.map((group, idx) => {
    const minX = Math.min(...group.map((g) => g.x));
    const minY = Math.min(...group.map((g) => g.y));
    const maxX = Math.max(...group.map((g) => g.x + g.width));
    const maxY = Math.max(...group.map((g) => g.y + g.height));

    // Reconstruir texto preservando espacios naturales entre fragmentos
    let text = '';
    for (let i = 0; i < group.length; i++) {
      const cur = group[i];
      if (i > 0) {
        const prev = group[i - 1];
        const gap = cur.x - (prev.x + prev.width);
        if (gap > cur.fontSize * 0.22 && !text.endsWith(' ') && !cur.str.startsWith(' ')) {
          text += ' ';
        }
      }
      text += cur.str;
    }

    const avgFontSize =
      group.reduce((s, g) => s + g.fontSize, 0) / group.length;

    return {
      id: `tb-${idx}-${Math.round(minX)}-${Math.round(minY)}`,
      text: text.trim(),
      x: Math.max(0, minX / viewport.width),
      y: Math.max(0, minY / viewport.height),
      width: Math.min(1, Math.max(0.02, (maxX - minX) / viewport.width)),
      height: Math.min(1, Math.max(0.014, (maxY - minY) / viewport.height)),
      fontSizePt: Math.max(7, Math.min(72, Math.round(avgFontSize))),
      fontName: group[0].fontName,
    };
  });
}

/**
 * Crea un PDF en blanco con el tamaño elegido (en puntos PDF: 1 pulgada = 72pt).
 */
export async function createBlankPdf(options: {
  pageCount: number;
  widthPt: number;
  heightPt: number;
  title?: string;
}): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  if (options.title) doc.setTitle(options.title);
  doc.setCreator('PDFStudio Local');
  doc.setProducer('PDFStudio Client-Side');

  for (let i = 0; i < Math.max(1, options.pageCount); i++) {
    doc.addPage([options.widthPt, options.heightPt]);
  }
  return doc.save();
}

/**
 * Lee el color promedio de fondo alrededor de una caja en un canvas (para cubrir texto existente limpiamente).
 */
export function sampleCanvasBackgroundHex(
  canvas: HTMLCanvasElement,
  normX: number,
  normY: number,
  normW: number,
  normH: number
): string {
  const ctx = canvas.getContext('2d');
  if (!ctx) return '#FFFFFF';

  const px = Math.max(0, Math.min(canvas.width - 1, Math.floor(normX * canvas.width)));
  const py = Math.max(0, Math.min(canvas.height - 1, Math.floor(normY * canvas.height)));
  const pw = Math.max(1, Math.min(canvas.width - px, Math.floor(normW * canvas.width)));
  const ph = Math.max(1, Math.min(canvas.height - py, Math.floor(normH * canvas.height)));

  // Muestreamos las 4 esquinas exteriores cercanas a la caja
  const samplePoints = [
    [Math.max(0, px - 2), Math.max(0, py - 2)],
    [Math.min(canvas.width - 1, px + pw + 2), Math.max(0, py - 2)],
    [Math.max(0, px - 2), Math.min(canvas.height - 1, py + ph + 2)],
    [Math.min(canvas.width - 1, px + pw + 2), Math.min(canvas.height - 1, py + ph + 2)],
  ];

  let r = 0, g = 0, b = 0, count = 0;
  for (const [sx, sy] of samplePoints) {
    try {
      const data = ctx.getImageData(sx, sy, 1, 1).data;
      // Preferir píxeles más claros (fondo y no tinta)
      if (data[0] + data[1] + data[2] > 180) {
        r += data[0];
        g += data[1];
        b += data[2];
        count++;
      }
    } catch {
      // ignore
    }
  }
  if (count === 0) return '#FFFFFF';
  const toHex = (n: number) => Math.round(n / count).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
