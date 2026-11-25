import type { ProgressInfo } from '../types/pdf';
import { destroyPdfDocument, loadPdfDocument, renderPageToCanvas } from './pdfCore';

export interface OcrLanguageOption {
  code: string;
  label: string;
  approxSize: string;
}

export const OCR_LANGUAGES: OcrLanguageOption[] = [
  { code: 'spa', label: 'Español', approxSize: '~4 MB' },
  { code: 'eng', label: 'Inglés', approxSize: '~4 MB' },
  { code: 'spa+eng', label: 'Español + Inglés', approxSize: '~8 MB' },
  { code: 'por', label: 'Portugués', approxSize: '~4 MB' },
  { code: 'fra', label: 'Francés', approxSize: '~4 MB' },
  { code: 'deu', label: 'Alemán', approxSize: '~4 MB' },
  { code: 'ita', label: 'Italiano', approxSize: '~4 MB' },
];

export interface OcrPageResult {
  pageNumber: number;
  text: string;
  confidence: number;
}

function sanitizeWinAnsi(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF€]/g, '');
}

/**
 * Motor OCR 100% en navegador con Tesseract.js WASM.
 * Descarga el worker, core WASM y modelo de idioma directamente desde jsDelivr / tessdata CDN
 * (0 bytes transferidos desde Vercel) y el Service Worker los cachea para uso offline.
 * Genera tanto texto extraído como un nuevo PDF con capa de texto buscable invisible.
 */
export async function runPdfOcr(
  buffer: ArrayBuffer,
  options: {
    lang: string;
    pageNumbers?: number[]; // 1-based; omit = todas
    createSearchablePdf: boolean;
  },
  onProgress?: (p: ProgressInfo) => void
): Promise<{
  fullText: string;
  pages: OcrPageResult[];
  searchablePdfBytes?: Uint8Array;
}> {
  onProgress?.({ percent: 4, message: 'Cargando motor OCR (WASM desde CDN)...' });

  const [Tesseract, pdf] = await Promise.all([
    import('tesseract.js'),
    loadPdfDocument(buffer),
  ]);

  const targetPages =
    options.pageNumbers && options.pageNumbers.length > 0
      ? options.pageNumbers.filter((n) => n >= 1 && n <= pdf.numPages)
      : Array.from({ length: pdf.numPages }, (_, i) => i + 1);

  const worker = await Tesseract.createWorker(options.lang, 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
    logger: (m) => {
      if (m.status === 'loading language traineddata') {
        onProgress?.({
          percent: Math.min(18, 6 + Math.round((m.progress || 0) * 12)),
          message: `Descargando modelo de idioma (${options.lang}) en caché local...`,
        });
      }
    },
  });

  const pageResults: OcrPageResult[] = [];
  const wordsByPage = new Map<
    number,
    Array<{ text: string; x0: number; y0: number; x1: number; y1: number; imgW: number; imgH: number }>
  >();

  try {
    for (let i = 0; i < targetPages.length; i++) {
      const pNum = targetPages[i];
      const basePct = 18 + Math.round((i / targetPages.length) * 70);
      onProgress?.({
        percent: basePct,
        message: `Reconociendo texto de la página ${pNum} (${i + 1}/${targetPages.length})...`,
      });

      const page = await pdf.getPage(pNum);
      const canvas = document.createElement('canvas');
      await renderPageToCanvas(page, canvas, 2.0);

      const res = await worker.recognize(canvas, {}, { text: true, blocks: true });
      const text = (res.data.text || '').trim();
      const confidence = Math.round(res.data.confidence || 0);

      pageResults.push({ pageNumber: pNum, text, confidence });

      if (options.createSearchablePdf && res.data.blocks) {
        const words: Array<{
          text: string;
          x0: number;
          y0: number;
          x1: number;
          y1: number;
          imgW: number;
          imgH: number;
        }> = [];
        for (const block of res.data.blocks) {
          for (const para of block.paragraphs) {
            for (const line of para.lines) {
              for (const w of line.words) {
                if (w.text && w.text.trim()) {
                  words.push({
                    text: w.text.trim(),
                    x0: w.bbox.x0,
                    y0: w.bbox.y0,
                    x1: w.bbox.x1,
                    y1: w.bbox.y1,
                    imgW: canvas.width,
                    imgH: canvas.height,
                  });
                }
              }
            }
          }
        }
        wordsByPage.set(pNum, words);
      }
    }

    let searchablePdfBytes: Uint8Array | undefined;

    if (options.createSearchablePdf) {
      onProgress?.({ percent: 91, message: 'Incrustando capa de texto buscable en el PDF...' });
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
      const outDoc = await PDFDocument.load(buffer.slice(0), { ignoreEncryption: true });
      const font = await outDoc.embedFont(StandardFonts.Helvetica);

      for (const [pNum, words] of wordsByPage.entries()) {
        const pdfPage = outDoc.getPage(pNum - 1);
        if (!pdfPage) continue;
        const pw = pdfPage.getWidth();
        const ph = pdfPage.getHeight();

        for (const w of words) {
          const safe = sanitizeWinAnsi(w.text);
          if (!safe) continue;
          const x = (w.x0 / w.imgW) * pw;
          const boxH = ((w.y1 - w.y0) / w.imgH) * ph;
          const y = ph - (w.y1 / w.imgH) * ph;
          const fontSize = Math.max(5, Math.min(48, boxH * 0.92));

          // Texto transparente buscable/seleccionable (opacity: 0.001 para máxima compatibilidad de visores)
          pdfPage.drawText(safe, {
            x,
            y: Math.max(0, y),
            size: fontSize,
            font,
            color: rgb(0, 0, 0),
            opacity: 0.001,
          });
        }
      }

      searchablePdfBytes = await outDoc.save({ useObjectStreams: true });
    }

    onProgress?.({ percent: 100, message: 'OCR completado' });
    const fullText = pageResults
      .map((r) => `--- Página ${r.pageNumber} (${r.confidence}% confianza) ---\n${r.text}`)
      .join('\n\n');

    return { fullText, pages: pageResults, searchablePdfBytes };
  } finally {
    await worker.terminate();
    await destroyPdfDocument(pdf);
  }
}
