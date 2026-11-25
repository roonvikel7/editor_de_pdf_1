import type { ProgressInfo } from '../types/pdf';
import { destroyPdfDocument, extractPageTextBlocks, loadPdfDocument, renderPageToCanvas } from './pdfCore';

export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';

/**
 * PDF → Imágenes (PNG / JPG / WebP). Si tiene >1 página empaqueta en .zip localmente.
 */
export async function convertPdfToImages(
  buffer: ArrayBuffer,
  baseName: string,
  options: {
    format: ImageOutputFormat;
    scale: number; // 1.5 = ~108 DPI, 2 = ~144 DPI, 3 = ~216 DPI
    quality: number; // 0.6 - 0.96
    pageIndices?: number[]; // 1-based; omit = todas
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
 * PDF → Word (.docx) 100% en navegador.
 * Modo 'editable': extrae párrafos y encabezados reales por tamaño de fuente.
 * Modo 'visual': inserta cada página como imagen nítida de alta resolución (ideal para escaneos).
 */
export async function convertPdfToDocx(
  buffer: ArrayBuffer,
  baseName: string,
  mode: 'editable' | 'visual' = 'editable',
  onProgress?: (p: ProgressInfo) => void
): Promise<{ blob: Blob; filename: string }> {
  const cleanName = baseName.replace(/\.pdf$/i, '');
  onProgress?.({ percent: 10, message: 'Cargando motor de documentos Word...' });

  const [pdf, docx] = await Promise.all([loadPdfDocument(buffer), import('docx')]);
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak, ImageRun } = docx;

  const children: Array<InstanceType<typeof Paragraph>> = [];

  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      onProgress?.({
        percent: 15 + Math.round((p / pdf.numPages) * 75),
        message: `Procesando página ${p} de ${pdf.numPages}...`,
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
        const blocks = await extractPageTextBlocks(page);

        if (blocks.length === 0) {
          // Si la página parece escaneada sin texto, insertamos su captura para no perder contenido
          const canvas = document.createElement('canvas');
          await renderPageToCanvas(page, canvas, 1.5);
          const pngBlob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Error PNG'))), 'image/png')
          );
          const imgBytes = new Uint8Array(await pngBlob.arrayBuffer());
          const vp = page.getViewport({ scale: 1 });
          children.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: imgBytes,
                  transformation: { width: 580, height: Math.round((vp.height / vp.width) * 580) },
                  type: 'png',
                }),
              ],
            })
          );
        } else {
          // Calcular tamaño de fuente típico del cuerpo de texto para detectar títulos
          const sizes = blocks.map((b) => b.fontSizePt).sort((a, b) => a - b);
          const medianSize = sizes[Math.floor(sizes.length / 2)] || 11;

          for (const block of blocks) {
            const isH1 = block.fontSizePt >= medianSize * 1.45 && block.text.length < 140;
            const isH2 = !isH1 && block.fontSizePt >= medianSize * 1.2 && block.text.length < 160;
            const isBold = /bold|black|heavy|demi/i.test(block.fontName) || isH1 || isH2;

            children.push(
              new Paragraph({
                heading: isH1
                  ? HeadingLevel.HEADING_1
                  : isH2
                    ? HeadingLevel.HEADING_2
                    : undefined,
                spacing: { after: isH1 || isH2 ? 160 : 90 },
                children: [
                  new TextRun({
                    text: block.text,
                    bold: isBold,
                    size: Math.round(Math.max(16, Math.min(48, block.fontSizePt * 2))),
                  }),
                ],
              })
            );
          }
        }
      }

      if (p < pdf.numPages) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
    }

    onProgress?.({ percent: 94, message: 'Generando archivo .docx...' });
    const doc = new Document({
      creator: 'PDFStudio Local',
      title: cleanName,
      sections: [{ children }],
    });
    const blob = await Packer.toBlob(doc);
    onProgress?.({ percent: 100, message: 'Documento Word listo' });
    return { blob, filename: `${cleanName}.docx` };
  } finally {
    await destroyPdfDocument(pdf);
  }
}

/**
 * PDF → Excel (.xlsx) o CSV agrupando elementos por filas (Y) y columnas (X).
 */
export async function convertPdfToExcel(
  buffer: ArrayBuffer,
  baseName: string,
  format: 'xlsx' | 'csv' = 'xlsx',
  onProgress?: (p: ProgressInfo) => void
): Promise<{ blob: Blob; filename: string }> {
  const cleanName = baseName.replace(/\.pdf$/i, '');
  onProgress?.({ percent: 10, message: 'Cargando motor de hojas de cálculo...' });

  const [pdf, XLSX] = await Promise.all([loadPdfDocument(buffer), import('xlsx')]);
  const wb = XLSX.utils.book_new();
  const allRows: string[][] = [];

  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      onProgress?.({
        percent: 15 + Math.round((p / pdf.numPages) * 75),
        message: `Extrayendo tabla de página ${p} de ${pdf.numPages}...`,
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

      items.sort((a, b) => (Math.abs(a.y - b.y) > 6 ? a.y - b.y : a.x - b.x));

      // Agrupar por filas
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
    onProgress?.({ percent: 100, message: 'Excel listo' });
    return { blob, filename: `${cleanName}.xlsx` };
  } finally {
    await destroyPdfDocument(pdf);
  }
}

/**
 * PDF → PowerPoint (.pptx).
 */
export async function convertPdfToPptx(
  buffer: ArrayBuffer,
  baseName: string,
  mode: 'visual' | 'editable' = 'visual',
  onProgress?: (p: ProgressInfo) => void
): Promise<{ blob: Blob; filename: string }> {
  const cleanName = baseName.replace(/\.pdf$/i, '');
  onProgress?.({ percent: 10, message: 'Cargando motor de presentaciones PowerPoint...' });

  const [pdf, PptxMod] = await Promise.all([loadPdfDocument(buffer), import('pptxgenjs')]);
  const PptxGenJS = PptxMod.default;
  const pptx = new PptxGenJS();
  pptx.title = cleanName;
  pptx.author = 'PDFStudio Local';
  pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 pulgadas

  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      onProgress?.({
        percent: 15 + Math.round((p / pdf.numPages) * 75),
        message: `Creando diapositiva ${p} de ${pdf.numPages}...`,
      });

      const page = await pdf.getPage(p);
      const slide = pptx.addSlide();

      if (mode === 'visual') {
        const canvas = document.createElement('canvas');
        await renderPageToCanvas(page, canvas, 1.8);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        const vp = page.getViewport({ scale: 1 });
        const slideW = 13.333;
        const slideH = 7.5;
        const aspect = vp.width / vp.height;

        let w = slideW;
        let h = w / aspect;
        if (h > slideH) {
          h = slideH;
          w = h * aspect;
        }
        const x = (slideW - w) / 2;
        const y = (slideH - h) / 2;
        slide.addImage({ data: dataUrl, x, y, w, h });
      } else {
        const blocks = await extractPageTextBlocks(page);
        const slideW = 13.333;
        const slideH = 7.5;
        if (blocks.length === 0) {
          slide.addText(`Página ${p} (sin texto extraíble)`, { x: 0.8, y: 1, w: 11, h: 1, fontSize: 18 });
        } else {
          for (const b of blocks) {
            slide.addText(b.text, {
              x: b.x * slideW,
              y: b.y * slideH,
              w: Math.max(0.8, Math.min(slideW - b.x * slideW, b.width * slideW + 0.4)),
              h: Math.max(0.3, b.height * slideH + 0.1),
              fontSize: Math.max(9, Math.min(36, Math.round(b.fontSizePt * 0.95))),
              color: '1E293B',
              valign: 'top',
            });
          }
        }
      }
    }

    onProgress?.({ percent: 94, message: 'Empaquetando .pptx...' });
    const out = await pptx.write({ outputType: 'blob' });
    onProgress?.({ percent: 100, message: 'PowerPoint listo' });
    return { blob: out as Blob, filename: `${cleanName}.pptx` };
  } finally {
    await destroyPdfDocument(pdf);
  }
}

/**
 * PDF → TXT o HTML limpio.
 */
export async function convertPdfToTextOrHtml(
  buffer: ArrayBuffer,
  baseName: string,
  format: 'txt' | 'html',
  onProgress?: (p: ProgressInfo) => void
): Promise<{ blob: Blob; filename: string; textPreview: string }> {
  const cleanName = baseName.replace(/\.pdf$/i, '');
  const pdf = await loadPdfDocument(buffer);
  const pagesText: string[] = [];

  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      onProgress?.({
        percent: Math.round((p / pdf.numPages) * 90),
        message: `Extrayendo texto de página ${p} de ${pdf.numPages}...`,
      });
      const page = await pdf.getPage(p);
      const blocks = await extractPageTextBlocks(page);
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
      // Convertir WebP / BMP / GIF a PNG usando canvas local
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
