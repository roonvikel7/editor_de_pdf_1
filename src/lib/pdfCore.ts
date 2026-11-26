import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { ExtractedImageElement, ExtractedTextBlock } from '../types/pdf';

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
    angleDeg: number;
  }

  const rawItems: RawItem[] = [];
  for (const item of textContent.items) {
    if (!('str' in item)) continue;
    const str = item.str;
    if (!str || !str.trim()) continue;

    // Transformar coordenadas del espacio PDF al espacio del viewport (top-left)
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]) || Math.hypot(tx[0], tx[1]) || 12;
    const angleRad = Math.atan2(tx[1], tx[0]);
    let angleDeg = Math.round((angleRad * 180) / Math.PI);
    // Normalizar pequeños ángulos cercanos a 0
    if (Math.abs(angleDeg) < 6) angleDeg = 0;

    const isVertical = Math.abs(Math.abs(angleDeg) - 90) < 18;
    const rawW = Math.max(item.width * (viewport.scale || 1), fontHeight * 0.5);

    const x = isVertical ? tx[4] - fontHeight * 0.5 : tx[4];
    const yTop = isVertical ? tx[5] - rawW : tx[5] - fontHeight * 0.85;
    const width = isVertical ? fontHeight * 1.25 : rawW;
    const height = isVertical ? Math.max(rawW, fontHeight) : fontHeight * 1.18;

    rawItems.push({
      str,
      x,
      y: yTop,
      width,
      height,
      fontSize: Math.max(6, Math.round(fontHeight * 10) / 10),
      fontName: item.fontName || 'Helvetica',
      angleDeg,
    });
  }

  if (rawItems.length === 0) return [];

  // Ordenar de arriba a abajo y de izquierda a derecha
  rawItems.sort((a, b) => {
    const dy = a.y - b.y;
    if (Math.abs(dy) > Math.min(a.height, b.height) * 0.55) return dy;
    return a.x - b.x;
  });

  // Agrupar elementos contiguos de la misma línea y misma orientación (sin mezclar columnas lejanas)
  const lines: RawItem[][] = [];
  for (const item of rawItems) {
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
      lines.push([item]);
      continue;
    }
    const prev = lastLine[lastLine.length - 1];
    const sameAngle = Math.abs(item.angleDeg - prev.angleDeg) < 10;
    const isVert = Math.abs(Math.abs(item.angleDeg) - 90) < 18;

    if (!sameAngle || isVert) {
      lines.push([item]);
      continue;
    }

    const sameRow = Math.abs(item.y - prev.y) <= Math.max(item.height, prev.height) * 0.48;
    const gap = item.x - (prev.x + prev.width);
    const closeHorizontally = gap < Math.max(item.fontSize * 2.2, 20) && gap > -item.fontSize * 1.2;

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

    const avgFontSize = group.reduce((s, g) => s + g.fontSize, 0) / group.length;
    const fontName = group[0].fontName;

    return {
      id: `tb-${idx}-${Math.round(minX)}-${Math.round(minY)}`,
      text: text.trim(),
      x: Math.max(0, Math.min(0.98, minX / viewport.width)),
      y: Math.max(0, Math.min(0.98, minY / viewport.height)),
      width: Math.min(1, Math.max(0.02, (maxX - minX) / viewport.width)),
      height: Math.min(1, Math.max(0.014, (maxY - minY) / viewport.height)),
      fontSizePt: Math.max(7, Math.min(72, Math.round(avgFontSize))),
      fontName,
      bold: /bold|black|heavy|demi|medi/i.test(fontName),
      italic: /italic|oblique/i.test(fontName),
      angleDeg: group[0].angleDeg,
    };
  });
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

function resolvePdfObject(page: PDFPageProxy, name: string): Promise<unknown> {
  return new Promise((resolve) => {
    const done = (val: unknown) => resolve(val);
    try {
      if (name.startsWith('g_')) {
        if (page.commonObjs.has(name)) {
          done(page.commonObjs.get(name));
          return;
        }
        page.commonObjs.get(name, done);
      } else {
        if (page.objs.has(name)) {
          done(page.objs.get(name));
          return;
        }
        page.objs.get(name, done);
      }
      setTimeout(() => done(null), 1200);
    } catch {
      done(null);
    }
  });
}

async function pdfImageObjToPng(
  imgObj: unknown
): Promise<{ dataUrl: string; pngBytes: Uint8Array; pixelWidth: number; pixelHeight: number } | null> {
  if (!imgObj || typeof imgObj !== 'object') return null;
  const obj = imgObj as {
    width?: number;
    height?: number;
    bitmap?: ImageBitmap;
    data?: Uint8ClampedArray | Uint8Array;
    kind?: number;
  };

  const w = obj.bitmap?.width || obj.width || 0;
  const h = obj.bitmap?.height || obj.height || 0;
  if (w < 16 || h < 16) return null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  if (obj.bitmap) {
    ctx.drawImage(obj.bitmap, 0, 0, w, h);
  } else if (obj.data) {
    const imgData = ctx.createImageData(w, h);
    const dst = imgData.data;
    const src = obj.data;
    const totalPixels = w * h;

    if (src.length === totalPixels * 4) {
      dst.set(src);
    } else if (src.length === totalPixels * 3) {
      for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
        dst[j] = src[i];
        dst[j + 1] = src[i + 1];
        dst[j + 2] = src[i + 2];
        dst[j + 3] = 255;
      }
    } else if (src.length === totalPixels) {
      for (let i = 0, j = 0; i < src.length; i++, j += 4) {
        dst[j] = src[i];
        dst[j + 1] = src[i];
        dst[j + 2] = src[i];
        dst[j + 3] = 255;
      }
    } else {
      return null;
    }
    ctx.putImageData(imgData, 0, 0);
  } else {
    return null;
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  const pngBytes = new Uint8Array(await blob.arrayBuffer());
  const dataUrl = canvas.toDataURL('image/png');
  return { dataUrl, pngBytes, pixelWidth: w, pixelHeight: h };
}

/**
 * Extrae las imágenes embebidas individuales de una página PDF junto con su posición y tamaño exactos.
 * Permite que PowerPoint (.pptx) y Word (.docx) mantengan cada foto/gráfico como un objeto movible y editable.
 */
export async function extractPageImages(page: PDFPageProxy): Promise<ExtractedImageElement[]> {
  const pdfjs = await getPdfJs();
  const OPS = pdfjs.OPS;
  const viewport = page.getViewport({ scale: 1 });

  // Pre-render ligero (0.15x) para asegurar que el worker de PDF.js decodifique y popule todos los objetos de imagen en page.objs
  try {
    const tinyVp = page.getViewport({ scale: 0.15 });
    const tinyCanvas = document.createElement('canvas');
    tinyCanvas.width = Math.max(1, Math.floor(tinyVp.width));
    tinyCanvas.height = Math.max(1, Math.floor(tinyVp.height));
    const tinyCtx = tinyCanvas.getContext('2d');
    if (tinyCtx) {
      await page.render({ canvasContext: tinyCtx, canvas: tinyCanvas, viewport: tinyVp }).promise;
    }
  } catch {
    // Continuar de todos modos con getOperatorList
  }

  const opList = await page.getOperatorList();

  // Forzar carga de recursos renderizando a un canvas pequeño en memoria solo si los objetos aún no están decodificados
  const images: ExtractedImageElement[] = [];
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
      let imgObj: unknown = null;
      if (fn === OPS.paintInlineImageXObject) {
        imgObj = args?.[0];
      } else if (typeof args?.[0] === 'string') {
        imgObj = await resolvePdfObject(page, args[0]);
      }

      const converted = await pdfImageObjToPng(imgObj);
      if (!converted) continue;

      // En PDF las imágenes se dibujan en el cuadrado unitario (0,0)-(1,1) transformado por el CTM actual
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

      // Ignorar imágenes minúsculas (< 2% de página) o fondos de página completa escaneada (> 94% de ambos lados)
      if (normW < 0.02 || normH < 0.02) continue;
      if (normW > 0.94 && normH > 0.94) continue;

      images.push({
        id: `img-${i}-${Math.round(minX)}-${Math.round(minY)}`,
        dataUrl: converted.dataUrl,
        pngBytes: converted.pngBytes,
        x: normX,
        y: normY,
        width: normW,
        height: normH,
        pixelWidth: converted.pixelWidth,
        pixelHeight: converted.pixelHeight,
      });
    }
  }

  return images;
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
