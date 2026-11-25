import type { ProgressInfo } from '../types/pdf';
import { destroyPdfDocument, loadPdfDocument, renderPageToCanvas } from './pdfCore';

export type CompressionLevel = 'low' | 'balanced' | 'extreme';

/**
 * Comprime un PDF 100% en cliente.
 * - 'low': optimización estructural sin pérdida visual (object streams + limpieza).
 * - 'balanced' / 'extreme': recompresión adaptativa de páginas a JPEG optimizado.
 */
export async function compressPdf(
  buffer: ArrayBuffer,
  level: CompressionLevel,
  onProgress?: (p: ProgressInfo) => void
): Promise<{
  bytes: Uint8Array;
  originalSize: number;
  compressedSize: number;
  savedPercent: number;
  keptOriginal: boolean;
}> {
  const originalSize = buffer.byteLength;
  const { PDFDocument } = await import('pdf-lib');

  if (level === 'low') {
    onProgress?.({ percent: 45, message: 'Optimizando estructura interna y streams...' });
    const src = await PDFDocument.load(buffer.slice(0), { ignoreEncryption: true });
    src.setTitle('');
    src.setAuthor('');
    src.setSubject('');
    src.setKeywords([]);
    src.setProducer('PDFStudio Optimizer');
    const out = await src.save({ useObjectStreams: true, addDefaultPage: false });
    const keptOriginal = out.byteLength >= originalSize;
    const finalBytes = keptOriginal ? new Uint8Array(buffer.slice(0)) : out;
    const saved = Math.max(0, Math.round(((originalSize - finalBytes.byteLength) / originalSize) * 100));
    onProgress?.({ percent: 100, message: 'Optimización completada' });
    return {
      bytes: finalBytes,
      originalSize,
      compressedSize: finalBytes.byteLength,
      savedPercent: saved,
      keptOriginal,
    };
  }

  const scale = level === 'balanced' ? 1.45 : 1.05;
  const jpegQuality = level === 'balanced' ? 0.68 : 0.44;

  const pdf = await loadPdfDocument(buffer);
  const outDoc = await PDFDocument.create();
  outDoc.setProducer('PDFStudio Compressor');

  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      onProgress?.({
        percent: Math.round(((p - 0.3) / pdf.numPages) * 90),
        message: `Comprimiendo página ${p} de ${pdf.numPages}...`,
      });

      const page = await pdf.getPage(p);
      const baseVp = page.getViewport({ scale: 1 });
      const canvas = document.createElement('canvas');
      await renderPageToCanvas(page, canvas, scale);

      const jpgBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Error generando JPEG'))),
          'image/jpeg',
          jpegQuality
        )
      );
      const jpgBytes = new Uint8Array(await jpgBlob.arrayBuffer());
      const embedded = await outDoc.embedJpg(jpgBytes);
      const newPage = outDoc.addPage([baseVp.width, baseVp.height]);
      newPage.drawImage(embedded, {
        x: 0,
        y: 0,
        width: baseVp.width,
        height: baseVp.height,
      });
    }

    onProgress?.({ percent: 95, message: 'Finalizando archivo comprimido...' });
    const out = await outDoc.save({ useObjectStreams: true });
    const keptOriginal = out.byteLength >= originalSize;
    const finalBytes = keptOriginal ? new Uint8Array(buffer.slice(0)) : out;
    const saved = Math.max(0, Math.round(((originalSize - finalBytes.byteLength) / originalSize) * 100));
    onProgress?.({ percent: 100, message: 'Compresión finalizada' });

    return {
      bytes: finalBytes,
      originalSize,
      compressedSize: finalBytes.byteLength,
      savedPercent: saved,
      keptOriginal,
    };
  } finally {
    await destroyPdfDocument(pdf);
  }
}

/**
 * Combina múltiples PDFs en el orden indicado.
 */
export async function mergePdfs(
  items: Array<{ name: string; buffer: ArrayBuffer; pageRange?: string }>,
  onProgress?: (p: ProgressInfo) => void
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const outDoc = await PDFDocument.create();
  outDoc.setCreator('PDFStudio Local');

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.({
      percent: Math.round(((i + 0.5) / items.length) * 90),
      message: `Combinando "${item.name}" (${i + 1}/${items.length})...`,
    });
    const src = await PDFDocument.load(item.buffer.slice(0), { ignoreEncryption: true });
    const total = src.getPageCount();
    const indices = item.pageRange?.trim()
      ? parsePageRange(item.pageRange, total).map((n) => n - 1)
      : src.getPageIndices();

    if (indices.length > 0) {
      const copied = await outDoc.copyPages(src, indices);
      copied.forEach((p) => outDoc.addPage(p));
    }
  }

  onProgress?.({ percent: 100, message: 'PDF combinado listo' });
  return outDoc.save({ useObjectStreams: true });
}

/**
 * Parsea cadenas como "1-3, 5, 7-9" en números de página 1-based ordenados sin duplicados inválidos.
 */
export function parsePageRange(input: string, maxPages: number): number[] {
  const result: number[] = [];
  const parts = input
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Math.max(1, Math.min(maxPages, parseInt(rangeMatch[1], 10)));
      const end = Math.max(1, Math.min(maxPages, parseInt(rangeMatch[2], 10)));
      if (start <= end) {
        for (let n = start; n <= end; n++) result.push(n);
      } else {
        for (let n = start; n >= end; n--) result.push(n);
      }
    } else if (/^\d+$/.test(part)) {
      const num = parseInt(part, 10);
      if (num >= 1 && num <= maxPages) result.push(num);
    }
  }
  return result;
}

/**
 * Divide un PDF por rangos (o cada página individual) y devuelve 1 PDF o un ZIP.
 */
export async function splitPdf(
  buffer: ArrayBuffer,
  baseName: string,
  mode: 'extract' | 'every-page' | 'chunks',
  options: { rangeInput?: string; chunkSize?: number },
  onProgress?: (p: ProgressInfo) => void
): Promise<{ blob: Blob; filename: string; fileCount: number }> {
  const cleanName = baseName.replace(/\.pdf$/i, '');
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(buffer.slice(0), { ignoreEncryption: true });
  const total = src.getPageCount();

  if (mode === 'extract') {
    const pages = parsePageRange(options.rangeInput || `1-${total}`, total);
    if (pages.length === 0) throw new Error('El rango de páginas no coincide con páginas válidas.');
    onProgress?.({ percent: 50, message: `Extrayendo ${pages.length} páginas...` });
    const out = await PDFDocument.create();
    const copied = await out.copyPages(
      src,
      pages.map((n) => n - 1)
    );
    copied.forEach((p) => out.addPage(p));
    const bytes = await out.save({ useObjectStreams: true });
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    onProgress?.({ percent: 100, message: 'Extracción completada' });
    return {
      blob: new Blob([copy], { type: 'application/pdf' }),
      filename: `${cleanName}_extraido.pdf`,
      fileCount: 1,
    };
  }

  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const step = mode === 'every-page' ? 1 : Math.max(1, options.chunkSize || 2);
  let partNum = 0;

  for (let start = 0; start < total; start += step) {
    partNum++;
    const end = Math.min(total, start + step);
    onProgress?.({
      percent: Math.round((end / total) * 90),
      message: `Generando parte ${partNum} (págs. ${start + 1}-${end})...`,
    });
    const out = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, k) => start + k);
    const copied = await out.copyPages(src, indices);
    copied.forEach((p) => out.addPage(p));
    const bytes = await out.save({ useObjectStreams: true });
    const suffix = step === 1 ? `pag_${String(start + 1).padStart(3, '0')}` : `parte_${partNum}_p${start + 1}-${end}`;
    zip.file(`${cleanName}_${suffix}.pdf`, bytes);
  }

  onProgress?.({ percent: 96, message: 'Empaquetando ZIP local...' });
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  onProgress?.({ percent: 100, message: 'División completada' });
  return {
    blob: zipBlob,
    filename: `${cleanName}_dividido.zip`,
    fileCount: partNum,
  };
}
