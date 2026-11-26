import type { PDFPageProxy } from 'pdfjs-dist';
import type { ExtractedTextBlock, ProgressInfo } from '../types/pdf';
import {
  destroyPdfDocument,
  extractPageImages,
  extractPageTextBlocks,
  loadPdfDocument,
  renderPageToCanvas,
} from './pdfCore';

export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';

/**
 * Respaldo OCR automático para páginas escaneadas o sin texto vectorial.
 * Devuelve bloques de texto editables con coordenadas normalizadas (0..1) para Word, PowerPoint y Excel.
 */
async function extractTextBlocksWithOcrFallback(
  page: PDFPageProxy,
  lang: string,
  onStatus?: (msg: string) => void
): Promise<ExtractedTextBlock[]> {
  onStatus?.('Página sin texto seleccionable · aplicando OCR automático...');
  const Tesseract = await import('tesseract.js');
  const canvas = document.createElement('canvas');
  const vp1 = page.getViewport({ scale: 1 });
  await renderPageToCanvas(page, canvas, 2.0);

  const worker = await Tesseract.createWorker(lang, 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
  });

  try {
    const res = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const blocks: ExtractedTextBlock[] = [];
    let idx = 0;

    if (res.data.blocks) {
      for (const block of res.data.blocks) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            const text = (line.text || '').trim();
            if (!text) continue;
            const b = line.bbox;
            const normX = Math.max(0, b.x0 / canvas.width);
            const normY = Math.max(0, b.y0 / canvas.height);
            const normW = Math.min(1 - normX, Math.max(0.02, (b.x1 - b.x0) / canvas.width));
            const normH = Math.min(1 - normY, Math.max(0.015, (b.y1 - b.y0) / canvas.height));
            const approxFontPt = Math.max(8, Math.min(48, Math.round(normH * vp1.height * 0.78)));

            blocks.push({
              id: `ocr-${idx++}`,
              text,
              x: normX,
              y: normY,
              width: normW,
              height: normH,
              fontSizePt: approxFontPt,
              fontName: 'Helvetica',
              bold: approxFontPt >= 16,
              italic: false,
              angleDeg: 0,
            });
          }
        }
      }
    }
    return blocks;
  } finally {
    await worker.terminate();
  }
}

/**
 * PDF → Imágenes (PNG / JPG / WebP). Si tiene >1 página empaqueta en .zip localmente.
 */
export async function convertPdfToImages(
  buffer: ArrayBuffer,
  baseName: string,
  options: {
    format: ImageOutputFormat;
    scale: number;
    quality: number;
    pageIndices?: number[];
  },
  onProgress?: (p: ProgressInfo) => void
): Promise<{ blob: Blob; filename: string; count: number }> {
  const pdf = await loadPdfDocument(buffer);
  const cleanName = baseName.replace(/\.pdf$/i, '');
  const mime =
    options.format === 'png'
      ? 'image/png'
      : options.format === 'webp'
        ? 'image/webp'
        : 'image/jpeg';
  const ext = options.format === 'jpeg' ? 'jpg' : options.format;

  const pagesToProcess =
    options.pageIndices && options.pageIndices.length > 0
      ? options.pageIndices.filter((n) => n >= 1 && n <= pdf.numPages)
      : Array.from({ length: pdf.numPages }, (_, i) => i + 1);

  try {
    if (pagesToProcess.length === 1) {
      onProgress?.({ percent: 40, message: `Renderizando página ${pagesToProcess[0]}...` });
      const page = await pdf.getPage(pagesToProcess[0]);
      const canvas = document.createElement('canvas');
      await renderPageToCanvas(page, canvas, options.scale);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('No se pudo exportar la imagen'))),
          mime,
          options.quality
        )
      );
      onProgress?.({ percent: 100, message: 'Imagen lista' });
      return { blob, filename: `${cleanName}_pag${pagesToProcess[0]}.${ext}`, count: 1 };
    }

    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    for (let i = 0; i < pagesToProcess.length; i++) {
      const pNum = pagesToProcess[i];
      onProgress?.({
        percent: Math.round(((i + 0.5) / pagesToProcess.length) * 90),
        message: `Renderizando página ${pNum} de ${pagesToProcess.length}...`,
      });
      const page = await pdf.getPage(pNum);
      const canvas = document.createElement('canvas');
      await renderPageToCanvas(page, canvas, options.scale);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Error al renderizar imagen'))),
          mime,
          options.quality
        )
      );
      zip.file(`${cleanName}_pag_${String(pNum).padStart(3, '0')}.${ext}`, blob);
    }

    onProgress?.({ percent: 95, message: 'Empaquetando archivo ZIP local...' });
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    onProgress?.({ percent: 100, message: 'Conversión completada' });
    return {
      blob: zipBlob,
      filename: `${cleanName}_imagenes_${ext}.zip`,
      count: pagesToProcess.length,
    };
  } finally {
    await destroyPdfDocument(pdf);
  }
}

/**
 * PDF → Word (.docx) 100% EDITABLE por defecto.
 * Extrae textos con jerarquía real (títulos, negrita, cursiva) e imágenes embebidas individuales en su orden vertical.
 * Si una página no tiene texto vectorial (escaneo), usa OCR automático para generar párrafos editables y NO una foto fija.
 */
export async function convertPdfToDocx(
  buffer: ArrayBuffer,
  baseName: string,
  mode: 'editable' | 'visual' = 'editable',
  onProgress?: (p: ProgressInfo) => void,
  options?: { autoOcr?: boolean; ocrLang?: string }
): Promise<{ blob: Blob; filename: string }> {
  const cleanName = baseName.replace(/\.pdf$/i, '');
  const autoOcr = options?.autoOcr ?? true;
  const ocrLang = options?.ocrLang ?? 'spa';
  onProgress?.({ percent: 8, message: 'Cargando motor de documentos Word...' });

  const [pdf, docx] = await Promise.all([loadPdfDocument(buffer), import('docx')]);
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak, ImageRun } = docx;

  const children: Array<InstanceType<typeof Paragraph>> = [];

  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const pct = 12 + Math.round(((p - 0.5) / pdf.numPages) * 78);
      onProgress?.({
        percent: pct,
        message: `Extrayendo contenido editable de página ${p} de ${pdf.numPages}...`,
      });

      const page = await pdf.getPage(p);

      if (mode === 'visual') {
        const canvas = document.createElement('canvas');
        await renderPageToCanvas(page, canvas, 1.8);
        const pngBlob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Error PNG'))), 'image/png')
        );
        const imgBytes = new Uint8Array(await pngBlob.arrayBuffer());
        const vp = page.getViewport({ scale: 1 });
        const targetW = 600;
        const targetH = Math.round((vp.height / vp.width) * targetW);
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: imgBytes,
                transformation: { width: targetW, height: targetH },
                type: 'png',
              }),
            ],
          })
        );
      } else {
        // Extraer textos + imágenes individuales en paralelo
        let blocks = await extractPageTextBlocks(page);
        const embeddedImages = await extractPageImages(page).catch(() => []);

        if (blocks.length === 0 && autoOcr) {
          blocks = await extractTextBlocksWithOcrFallback(page, ocrLang, (msg) =>
            onProgress?.({ percent: pct, message: `Pág. ${p}: ${msg}` })
          );
        }

        const sizes = blocks.map((b) => b.fontSizePt).sort((a, b) => a - b);
        const medianSize = sizes[Math.floor(sizes.length / 2)] || 11;

        // Intercalar párrafos editables e imágenes individuales en su orden vertical (Y)
        type FlowItem =
          | { kind: 'text'; y: number; x: number; block: ExtractedTextBlock }
          | { kind: 'image'; y: number; x: number; img: (typeof embeddedImages)[number] };

        const flow: FlowItem[] = [
          ...blocks.map((block) => ({ kind: 'text' as const, y: block.y, x: block.x, block })),
          ...embeddedImages.map((img) => ({ kind: 'image' as const, y: img.y, x: img.x, img })),
        ].sort((a, b) => (Math.abs(a.y - b.y) > 0.015 ? a.y - b.y : a.x - b.x));

        if (flow.length === 0) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: `(Página ${p} sin texto detectable)`, italics: true })],
            })
          );
        } else {
          for (const item of flow) {
            if (item.kind === 'image') {
              const targetW = Math.min(540, Math.max(90, Math.round(item.img.width * 580)));
              const ratio = item.img.pixelHeight / Math.max(1, item.img.pixelWidth);
              const targetH = Math.min(680, Math.max(60, Math.round(targetW * ratio)));
              children.push(
                new Paragraph({
                  spacing: { before: 100, after: 120 },
                  children: [
                    new ImageRun({
                      data: item.img.pngBytes,
                      transformation: { width: targetW, height: targetH },
                      type: 'png',
                    }),
                  ],
                })
              );
            } else {
              const b = item.block;
              const isH1 = b.fontSizePt >= medianSize * 1.45 && b.text.length < 140;
              const isH2 = !isH1 && b.fontSizePt >= medianSize * 1.2 && b.text.length < 160;
              const isBold = Boolean(b.bold) || isH1 || isH2;

              children.push(
                new Paragraph({
                  heading: isH1
                    ? HeadingLevel.HEADING_1
                    : isH2
                      ? HeadingLevel.HEADING_2
                      : undefined,
                  spacing: { after: isH1 || isH2 ? 150 : 85 },
                  children: [
                    new TextRun({
                      text: b.text,
                      bold: isBold,
                      italics: Boolean(b.italic),
                      size: Math.round(Math.max(16, Math.min(48, b.fontSizePt * 2))),
                    }),
                  ],
                })
              );
            }
          }
        }
      }

      if (p < pdf.numPages) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
    }

    onProgress?.({ percent: 94, message: 'Generando documento Word editable (.docx)...' });
    const doc = new Document({
      creator: 'PDFStudio Local',
      title: cleanName,
      sections: [{ children }],
    });
    const blob = await Packer.toBlob(doc);
    onProgress?.({ percent: 100, message: 'Documento Word editable listo' });
    return { blob, filename: `${cleanName}.docx` };
  } finally {
    await destroyPdfDocument(pdf);
  }
}

/**
 * PDF → Excel (.xlsx) o CSV agrupando elementos por filas (Y) y columnas (X), con respaldo OCR automático.
 */
export async function convertPdfToExcel(
  buffer: ArrayBuffer,
  baseName: string,
  format: 'xlsx' | 'csv' = 'xlsx',
  onProgress?: (p: ProgressInfo) => void,
  options?: { autoOcr?: boolean; ocrLang?: string }
): Promise<{ blob: Blob; filename: string }> {
  const cleanName = baseName.replace(/\.pdf$/i, '');
  const autoOcr = options?.autoOcr ?? true;
  const ocrLang = options?.ocrLang ?? 'spa';
  onProgress?.({ percent: 10, message: 'Cargando motor de hojas de cálculo...' });

  const [pdf, XLSX] = await Promise.all([loadPdfDocument(buffer), import('xlsx')]);
  const wb = XLSX.utils.book_new();
  const allRows: string[][] = [];

  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const pct = 15 + Math.round((p / pdf.numPages) * 75);
      onProgress?.({
        percent: pct,
        message: `Extrayendo tabla editable de página ${p} de ${pdf.numPages}...`,
      });

      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();

      interface CellItem {
        str: string;
        x: number;
        y: number;
        w: number;
      }

      const items: CellItem[] = [];
      for (const it of textContent.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        const x = it.transform[4];
        const y = viewport.height - it.transform[5];
        items.push({ str: it.str.trim(), x, y, w: it.width || 10 });
      }

      // Respaldo OCR automático si el PDF es escaneado
      if (items.length === 0 && autoOcr) {
        const ocrBlocks = await extractTextBlocksWithOcrFallback(page, ocrLang, (msg) =>
          onProgress?.({ percent: pct, message: `Pág. ${p}: ${msg}` })
        );
        for (const b of ocrBlocks) {
          items.push({
            str: b.text,
            x: b.x * viewport.width,
            y: b.y * viewport.height,
            w: b.width * viewport.width,
          });
        }
      }

      items.sort((a, b) => (Math.abs(a.y - b.y) > 6 ? a.y - b.y : a.x - b.x));

      const rowGroups: CellItem[][] = [];
      for (const it of items) {
        const last = rowGroups[rowGroups.length - 1];
        if (last && Math.abs(it.y - last[0].y) <= 7) {
          last.push(it);
        } else {
          rowGroups.push([it]);
        }
      }

      const sheetRows: string[][] = rowGroups.map((row) => {
        row.sort((a, b) => a.x - b.x);
        const cells: string[] = [];
        for (let i = 0; i < row.length; i++) {
          const cur = row[i];
          if (i > 0) {
            const prev = row[i - 1];
            const gap = cur.x - (prev.x + prev.w);
            if (gap < 14 && cells.length > 0) {
              cells[cells.length - 1] += ` ${cur.str}`;
              continue;
            }
          }
          cells.push(cur.str);
        }
        return cells;
      });

      const safeRows = sheetRows.length > 0 ? sheetRows : [['(Sin texto tabular detectable en esta página)']];
      allRows.push(...safeRows);

      const ws = XLSX.utils.aoa_to_sheet(safeRows);
      XLSX.utils.book_append_sheet(wb, ws, `Pag_${p}`.slice(0, 31));
    }

    onProgress?.({ percent: 95, message: `Construyendo archivo .${format}...` });

    if (format === 'csv') {
      const combinedWs = XLSX.utils.aoa_to_sheet(allRows);
      const csv = XLSX.utils.sheet_to_csv(combinedWs);
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
      onProgress?.({ percent: 100, message: 'CSV listo' });
      return { blob, filename: `${cleanName}.csv` };
    }

    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    onProgress?.({ percent: 100, message: 'Excel editable listo' });
    return { blob, filename: `${cleanName}.xlsx` };
  } finally {
    await destroyPdfDocument(pdf);
  }
}

/**
 * PDF → PowerPoint (.pptx) 100% EDITABLE por defecto.
 * Separa cada imagen embebida y cada cuadro de texto con su posición, tamaño, estilo y rotación reales
 * (incluyendo texto vertical) y usa OCR automático si la página es escaneada.
 */
export async function convertPdfToPptx(
  buffer: ArrayBuffer,
  baseName: string,
  mode: 'editable' | 'visual' = 'editable',
  onProgress?: (p: ProgressInfo) => void,
  options?: { autoOcr?: boolean; ocrLang?: string }
): Promise<{ blob: Blob; filename: string }> {
  const cleanName = baseName.replace(/\.pdf$/i, '');
  const autoOcr = options?.autoOcr ?? true;
  const ocrLang = options?.ocrLang ?? 'spa';
  onProgress?.({ percent: 8, message: 'Cargando motor de presentaciones PowerPoint...' });

  const [pdf, PptxMod] = await Promise.all([loadPdfDocument(buffer), import('pptxgenjs')]);
  const PptxGenJS = PptxMod.default;
  const pptx = new PptxGenJS();
  pptx.title = cleanName;
  pptx.author = 'PDFStudio Local';

  try {
    // Ajustar el tamaño de diapositiva a la proporción real de la página 1 del PDF (sin recortar ni deformar)
    const firstPage = await pdf.getPage(1);
    const firstVp = firstPage.getViewport({ scale: 1 });
    const aspect = firstVp.width / Math.max(1, firstVp.height);
    let slideW = 13.333;
    let slideH = 7.5;
    if (aspect < 1) {
      // PDF vertical (ej. A4 o Carta)
      slideH = 10;
      slideW = Math.max(5.5, Math.min(13.333, Math.round(slideH * aspect * 100) / 100));
    } else {
      slideW = 13.333;
      slideH = Math.max(5, Math.min(10, Math.round((slideW / aspect) * 100) / 100));
    }
    pptx.defineLayout({ name: 'PDF_CUSTOM', width: slideW, height: slideH });
    pptx.layout = 'PDF_CUSTOM';

    for (let p = 1; p <= pdf.numPages; p++) {
      const pct = 14 + Math.round(((p - 0.5) / pdf.numPages) * 76);
      onProgress?.({
        percent: pct,
        message: `Creando diapositiva editable ${p} de ${pdf.numPages}...`,
      });

      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const slide = pptx.addSlide();

      if (mode === 'visual') {
        const canvas = document.createElement('canvas');
        await renderPageToCanvas(page, canvas, 1.8);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        const pageAspect = vp.width / vp.height;

        let w = slideW;
        let h = w / pageAspect;
        if (h > slideH) {
          h = slideH;
          w = h * pageAspect;
        }
        slide.addImage({
          data: dataUrl,
          x: (slideW - w) / 2,
          y: (slideH - h) / 2,
          w,
          h,
        });
      } else {
        // 1) Extraer e insertar cada imagen individual en su posición exacta (movible y editable en PPT)
        const embeddedImages = await extractPageImages(page).catch(() => []);
        for (const img of embeddedImages) {
          slide.addImage({
            data: img.dataUrl,
            x: img.x * slideW,
            y: img.y * slideH,
            w: Math.max(0.25, img.width * slideW),
            h: Math.max(0.25, img.height * slideH),
          });
        }

        // 2) Extraer e insertar cada bloque de texto como cuadro de texto nativo editable
        let blocks = await extractPageTextBlocks(page);
        if (blocks.length === 0 && autoOcr) {
          blocks = await extractTextBlocksWithOcrFallback(page, ocrLang, (msg) =>
            onProgress?.({ percent: pct, message: `Diapositiva ${p}: ${msg}` })
          );
        }

        // Escala de puntos PDF a puntos PowerPoint proporcional al tamaño de diapositiva
        const ptScale = (slideW * 72) / Math.max(1, vp.width);

        if (blocks.length === 0 && embeddedImages.length === 0) {
          slide.addText(`Página ${p} (sin elementos de texto o imagen detectables)`, {
            x: 0.6,
            y: 0.8,
            w: slideW - 1.2,
            h: 0.8,
            fontSize: 16,
            color: '64748B',
          });
        } else {
          for (const b of blocks) {
            const isVertical = Math.abs(Math.abs(b.angleDeg || 0) - 90) < 18;
            const scaledFont = Math.max(8, Math.min(54, Math.round(b.fontSizePt * ptScale * 0.92)));
            const boxX = b.x * slideW;
            const boxY = b.y * slideH;
            const boxW = Math.max(0.5, Math.min(slideW - boxX, b.width * slideW + 0.35));
            const boxH = Math.max(0.26, Math.min(slideH - boxY, b.height * slideH + 0.14));

            slide.addText(b.text, {
              x: boxX,
              y: boxY,
              w: isVertical ? Math.max(0.6, boxH) : boxW,
              h: isVertical ? Math.max(0.35, boxW) : boxH,
              fontSize: scaledFont,
              bold: Boolean(b.bold),
              italic: Boolean(b.italic),
              color: '111827',
              fontFace: /times|serif/i.test(b.fontName)
                ? 'Times New Roman'
                : /courier|mono/i.test(b.fontName)
                  ? 'Courier New'
                  : 'Arial',
              margin: 0,
              valign: 'top',
              fit: 'shrink',
              rotate: b.angleDeg && b.angleDeg !== 0 ? Math.round(b.angleDeg) : undefined,
            });
          }
        }
      }
    }

    onProgress?.({ percent: 94, message: 'Empaquetando presentación editable .pptx...' });
    const out = await pptx.write({ outputType: 'blob' });
    onProgress?.({ percent: 100, message: 'PowerPoint editable listo' });
    return { blob: out as Blob, filename: `${cleanName}.pptx` };
  } finally {
    await destroyPdfDocument(pdf);
  }
}

/**
 * PDF → TXT o HTML limpio (con respaldo OCR automático si es escaneado).
 */
export async function convertPdfToTextOrHtml(
  buffer: ArrayBuffer,
  baseName: string,
  format: 'txt' | 'html',
  onProgress?: (p: ProgressInfo) => void,
  options?: { autoOcr?: boolean; ocrLang?: string }
): Promise<{ blob: Blob; filename: string; textPreview: string }> {
  const cleanName = baseName.replace(/\.pdf$/i, '');
  const autoOcr = options?.autoOcr ?? true;
  const ocrLang = options?.ocrLang ?? 'spa';
  const pdf = await loadPdfDocument(buffer);
  const pagesText: string[] = [];

  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const pct = Math.round((p / pdf.numPages) * 90);
      onProgress?.({
        percent: pct,
        message: `Extrayendo texto de página ${p} de ${pdf.numPages}...`,
      });
      const page = await pdf.getPage(p);
      let blocks = await extractPageTextBlocks(page);
      if (blocks.length === 0 && autoOcr) {
        blocks = await extractTextBlocksWithOcrFallback(page, ocrLang, (msg) =>
          onProgress?.({ percent: pct, message: `Pág. ${p}: ${msg}` })
        );
      }
      pagesText.push(blocks.map((b) => b.text).join('\n'));
    }

    const fullText = pagesText.join('\n\n--- Página siguiente ---\n\n');

    if (format === 'txt') {
      const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
      onProgress?.({ percent: 100, message: 'Texto extraído' });
      return { blob, filename: `${cleanName}.txt`, textPreview: fullText };
    }

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const htmlBody = pagesText
      .map(
        (txt, idx) =>
          `<section class="page"><h2>Página ${idx + 1}</h2>${txt
            .split('\n')
            .filter(Boolean)
            .map((line) => `<p>${esc(line)}</p>`)
            .join('')}</section>`
      )
      .join('');

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(
      cleanName
    )}</title><style>body{font-family:system-ui,sans-serif;max-width:820px;margin:2rem auto;padding:0 1.25rem;line-height:1.6;color:#0f172a;background:#f8fafc}.page{background:#fff;padding:2rem;margin-bottom:1.5rem;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}h2{font-size:.85rem;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-top:0}</style></head><body>${htmlBody}</body></html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    onProgress?.({ percent: 100, message: 'HTML generado' });
    return { blob, filename: `${cleanName}.html`, textPreview: fullText };
  } finally {
    await destroyPdfDocument(pdf);
  }
}

/**
 * Imágenes (JPG/PNG/WebP) → PDF.
 */
export async function convertImagesToPdf(
  files: File[],
  options: {
    pageSize: 'fit' | 'a4' | 'letter';
    marginPt: number;
  },
  onProgress?: (p: ProgressInfo) => void
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setCreator('PDFStudio Local');

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.({
      percent: Math.round(((i + 0.5) / files.length) * 90),
      message: `Incrustando imagen ${i + 1} de ${files.length}...`,
    });

    const isPng = file.type === 'image/png';
    const isJpg = file.type === 'image/jpeg' || file.type === 'image/jpg';
    let embedded;

    if (isPng) {
      embedded = await doc.embedPng(new Uint8Array(await file.arrayBuffer()));
    } else if (isJpg) {
      embedded = await doc.embedJpg(new Uint8Array(await file.arrayBuffer()));
    } else {
      const bmp = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(bmp, 0, 0);
      const pngBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Error convirtiendo imagen'))), 'image/png')
      );
      embedded = await doc.embedPng(new Uint8Array(await pngBlob.arrayBuffer()));
    }

    const iw = embedded.width;
    const ih = embedded.height;

    if (options.pageSize === 'fit') {
      const page = doc.addPage([iw + options.marginPt * 2, ih + options.marginPt * 2]);
      page.drawImage(embedded, {
        x: options.marginPt,
        y: options.marginPt,
        width: iw,
        height: ih,
      });
    } else {
      const [pw, ph] = options.pageSize === 'a4' ? [595.28, 841.89] : [612, 792];
      const page = doc.addPage(iw > ih ? [ph, pw] : [pw, ph]);
      const availW = page.getWidth() - options.marginPt * 2;
      const availH = page.getHeight() - options.marginPt * 2;
      const scale = Math.min(availW / iw, availH / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      page.drawImage(embedded, {
        x: (page.getWidth() - dw) / 2,
        y: (page.getHeight() - dh) / 2,
        width: dw,
        height: dh,
      });
    }
  }

  onProgress?.({ percent: 100, message: 'PDF generado' });
  return doc.save({ useObjectStreams: true });
}

/**
 * Word (.docx), TXT, Markdown o HTML → PDF limpio y paginado 100% en navegador.
 */
export async function convertDocumentToPdf(
  file: File,
  onProgress?: (p: ProgressInfo) => void
): Promise<Uint8Array> {
  onProgress?.({ percent: 15, message: `Leyendo ${file.name}...` });
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  let plainParagraphs: Array<{ text: string; heading?: boolean }> = [];

  if (ext === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    const parser = new DOMParser();
    const htmlDoc = parser.parseFromString(result.value, 'text/html');
    const nodes = htmlDoc.body.querySelectorAll('h1, h2, h3, h4, p, li, tr');
    nodes.forEach((el) => {
      const txt = (el.textContent || '').trim();
      if (!txt) return;
      const isHeading = /^H[1-4]$/.test(el.tagName);
      plainParagraphs.push({
        text: el.tagName === 'LI' ? `• ${txt}` : txt,
        heading: isHeading,
      });
    });
  } else if (ext === 'html' || ext === 'htm') {
    const raw = await file.text();
    const parser = new DOMParser();
    const htmlDoc = parser.parseFromString(raw, 'text/html');
    const nodes = htmlDoc.body.querySelectorAll('h1, h2, h3, h4, p, li, div');
    if (nodes.length > 0) {
      nodes.forEach((el) => {
        if (el.tagName === 'DIV' && el.children.length > 0) return;
        const txt = (el.textContent || '').trim();
        if (txt) plainParagraphs.push({ text: txt, heading: /^H[1-4]$/.test(el.tagName) });
      });
    } else {
      plainParagraphs = (htmlDoc.body.textContent || '')
        .split(/\r?\n/)
        .map((t) => ({ text: t }));
    }
  } else {
    const raw = await file.text();
    plainParagraphs = raw.split(/\r?\n/).map((line) => {
      const heading = /^#{1,3}\s+/.test(line);
      return { text: line.replace(/^#{1,3}\s+/, ''), heading };
    });
  }

  onProgress?.({ percent: 55, message: 'Maquetando páginas PDF...' });
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(file.name.replace(/\.[^.]+$/, ''));
  doc.setCreator('PDFStudio Local');

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 54;
  const maxW = pageW - margin * 2;

  let page = doc.addPage([pageW, pageH]);
  let cursorY = pageH - margin;

  const sanitize = (s: string) =>
    s
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2022/g, '-')
      .replace(/\u00A0/g, ' ')
      .replace(/[^\x20-\x7E\xA0-\xFF€]/g, '');

  for (const para of plainParagraphs) {
    const safe = sanitize(para.text);
    const font = para.heading ? bold : regular;
    const size = para.heading ? 15 : 11;
    const lineH = size * 1.42;

    if (!safe.trim()) {
      cursorY -= lineH * 0.7;
      if (cursorY < margin + lineH) {
        page = doc.addPage([pageW, pageH]);
        cursorY = pageH - margin;
      }
      continue;
    }

    const words = safe.split(/\s+/);
    let line = '';
    const lines: string[] = [];
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) > maxW && line) {
        lines.push(line);
        line = w;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);

    if (para.heading) cursorY -= 6;

    for (const l of lines) {
      if (cursorY < margin + lineH) {
        page = doc.addPage([pageW, pageH]);
        cursorY = pageH - margin;
      }
      page.drawText(l, {
        x: margin,
        y: cursorY,
        size,
        font,
        color: para.heading ? rgb(0.08, 0.14, 0.28) : rgb(0.12, 0.16, 0.22),
      });
      cursorY -= lineH;
    }
    cursorY -= para.heading ? 6 : 4;
  }

  onProgress?.({ percent: 100, message: 'PDF creado' });
  return doc.save({ useObjectStreams: true });
}
