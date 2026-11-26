import type { ProgressInfo } from '../types/pdf';
import { destroyPdfDocument, loadPdfDocument, renderPageToCanvas } from './pdfCore';
import { analyzePdfPage, type SceneGraphicElement } from './pdfSceneAnalyzer';

export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';

/**
 * Helper: renderiza una forma nativa (`rect`, `roundRect`, `ellipse`, `line`) a un PNG transparente
 * de su tamaño exacto para Word (`.docx`) donde `docx` no tiene autoformas nativas dibujadas con stroke/radius.
 */
async function renderShapeElementToPng(
  el: Extract<SceneGraphicElement, { kind: 'shape' }>,
  pageWidthPt: number,
  pageHeightPt: number
): Promise<{ pngBytes: Uint8Array; widthPx: number; heightPx: number } | null> {
  const scale = 2;
  const wPx = Math.max(6, Math.round(el.width * pageWidthPt * scale));
  const hPx = Math.max(6, Math.round(el.height * pageHeightPt * scale));
  const canvas = document.createElement('canvas');
  canvas.width = wPx;
  canvas.height = hPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const lw = (el.strokeWidthPt || 0) * scale;
  const half = lw / 2;

  ctx.beginPath();
  if (el.shapeType === 'line') {
    const x1 = el.lineFlipH ? wPx - half : half;
    const y1 = el.lineFlipV ? hPx - half : half;
    const x2 = el.lineFlipH ? half : wPx - half;
    const y2 = el.lineFlipV ? half : hPx - half;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  } else if (el.shapeType === 'ellipse') {
    ctx.ellipse(wPx / 2, hPx / 2, Math.max(1, wPx / 2 - half), Math.max(1, hPx / 2 - half), 0, 0, Math.PI * 2);
  } else if (el.shapeType === 'roundRect') {
    const r = Math.min(wPx, hPx) * (el.rectRadiusRatio ?? 0.08);
    ctx.roundRect(half, half, Math.max(1, wPx - lw), Math.max(1, hPx - lw), r);
  } else {
    ctx.rect(half, half, Math.max(1, wPx - lw), Math.max(1, hPx - lw));
  }

  if (el.fillHex && el.shapeType !== 'line') {
    ctx.fillStyle = `#${el.fillHex}`;
    ctx.fill();
  }
  if (el.strokeHex && lw > 0) {
    ctx.strokeStyle = `#${el.strokeHex}`;
    ctx.lineWidth = lw;
    ctx.stroke();
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return {
    pngBytes: new Uint8Array(await blob.arrayBuffer()),
    widthPx: wPx / scale,
    heightPx: hPx / scale,
  };
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
 * PDF → PowerPoint (.pptx) con TODOS LOS ELEMENTOS SEPARADOS Y EDITABLES:
 * - Fondo sólido nativo (`slide.background`), SIN imagen gigante tapando la diapositiva.
 * - Formas geométricas nativas editables (`rect`, `roundRect`, `ellipse`, `line`) mediante `slide.addShape`.
 * - Cada ilustración/pétalo/imagen como su propio objeto independiente recortado con transparencia.
 * - Cada bloque de texto como cuadro de texto nativo editable con color, fuente, tamaño, alineación y rotación exactos.
 */
export async function convertPdfToPptx(
  buffer: ArrayBuffer,
  baseName: string,
  onProgress?: (p: ProgressInfo) => void
): Promise<{ blob: Blob; filename: string }> {
  const cleanName = baseName.replace(/\.pdf$/i, '');
  onProgress?.({ percent: 6, message: 'Preparando motor de presentaciones PowerPoint...' });

  const [pdf, PptxMod] = await Promise.all([loadPdfDocument(buffer), import('pptxgenjs')]);
  const PptxGenJS = PptxMod.default;
  const pptx = new PptxGenJS();
  pptx.title = cleanName;
  pptx.author = 'PDFStudio Local';

  try {
    const firstPage = await pdf.getPage(1);
    const firstVp = firstPage.getViewport({ scale: 1 });
    const aspect = firstVp.width / Math.max(1, firstVp.height);
    let slideW = 13.333;
    let slideH = 7.5;
    if (aspect < 1) {
      slideH = 10;
      slideW = Math.max(5.5, Math.min(13.333, Math.round(slideH * aspect * 100) / 100));
    } else {
      slideW = 13.333;
      slideH = Math.max(5, Math.min(10, Math.round((slideW / aspect) * 100) / 100));
    }
    pptx.defineLayout({ name: 'PDF_EXACT', width: slideW, height: slideH });
    pptx.layout = 'PDF_EXACT';

    for (let p = 1; p <= pdf.numPages; p++) {
      const pct = 10 + Math.round(((p - 0.5) / pdf.numPages) * 80);
      onProgress?.({
        percent: pct,
        message: `Descomponiendo objetos de diapositiva ${p} de ${pdf.numPages}...`,
      });

      const page = await pdf.getPage(p);
      const scene = await analyzePdfPage(page, p, (msg) =>
        onProgress?.({ percent: pct, message: msg })
      );

      const slide = pptx.addSlide();

      // 1) Fondo nativo de la diapositiva (NO es una imagen seleccionable encima!)
      if (scene.scannedFallbackBg) {
        slide.background = { data: scene.scannedFallbackBg.dataUrl };
      } else {
        slide.background = { color: scene.pageBackgroundHex || 'FFFFFF' };
      }

      const ptScale = (slideW * 72) / Math.max(1, scene.widthPt);

      // 2) Cada forma nativa y cada gráfico/imagen por separado en su zOrder original
      for (const el of scene.elements) {
        if (el.kind === 'shape') {
          const x = el.x * slideW;
          const y = el.y * slideH;
          const w = Math.max(0.02, el.width * slideW);
          const h = Math.max(0.02, el.height * slideH);
          const lineWidthPt = el.strokeWidthPt ? Math.max(0.5, el.strokeWidthPt * ptScale) : 0;

          const shapeTypeMap = {
            rect: pptx.ShapeType.rect,
            roundRect: pptx.ShapeType.roundRect,
            ellipse: pptx.ShapeType.ellipse,
            line: pptx.ShapeType.line,
          };

          slide.addShape(shapeTypeMap[el.shapeType], {
            x,
            y,
            w: el.shapeType === 'line' && el.width < 0.005 ? 0 : w,
            h: el.shapeType === 'line' && el.height < 0.005 ? 0 : h,
            fill:
              el.fillHex && el.shapeType !== 'line'
                ? { color: el.fillHex }
                : { type: 'none' },
            line:
              el.strokeHex && lineWidthPt > 0
                ? { color: el.strokeHex, width: lineWidthPt }
                : { type: 'none' },
            rectRadius:
              el.shapeType === 'roundRect'
                ? Math.max(0.04, Math.min(0.35, (el.rectRadiusRatio ?? 0.08) * 1.4))
                : undefined,
            flipH: el.shapeType === 'line' ? el.lineFlipH : undefined,
            flipV: el.shapeType === 'line' ? el.lineFlipV : undefined,
          });
        } else {
          slide.addImage({
            data: el.dataUrl,
            x: el.x * slideW,
            y: el.y * slideH,
            w: Math.max(0.12, el.width * slideW),
            h: Math.max(0.12, el.height * slideH),
          });
        }
      }

      // 3) Cuadros de texto nativos editables
      for (const para of scene.paragraphs) {
        const isVertical = Math.abs(Math.abs(para.angleDeg) - 90) < 18;
        const scaledFont = Math.max(7, Math.min(64, Math.round(para.fontSizePt * ptScale * 0.94)));

        if (isVertical) {
          const origW = Math.max(0.28, para.width * slideW);
          const origH = Math.max(0.5, para.height * slideH + 0.2);
          const cx = para.x * slideW + origW / 2;
          const cy = para.y * slideH + origH / 2;
          const rotW = origH;
          const rotH = Math.max(0.32, origW * 1.15);

          slide.addText(para.text, {
            x: Math.max(0, cx - rotW / 2),
            y: Math.max(0, cy - rotH / 2),
            w: rotW,
            h: rotH,
            fontSize: scaledFont,
            bold: para.bold,
            italic: para.italic,
            color: para.colorHex,
            fontFace: para.fontFamily,
            align: 'center',
            valign: 'middle',
            margin: 0,
            fit: 'shrink',
            rotate: Math.round(para.angleDeg),
          });
        } else {
          const padW = Math.min(0.45, Math.max(0.18, para.width * slideW * 0.14));
          let boxX = para.x * slideW;
          let boxW = para.width * slideW + padW;
          if (para.align === 'center') {
            boxX = Math.max(0, boxX - padW / 2);
          } else if (para.align === 'right') {
            boxX = Math.max(0, boxX - padW);
          }
          boxW = Math.min(slideW - boxX, Math.max(0.4, boxW));

          const boxY = Math.max(0, para.y * slideH - 0.03);
          const boxH = Math.min(slideH - boxY, Math.max(0.24, para.height * slideH + 0.14));

          slide.addText(
            para.lines.map((line, lIdx) => ({
              text: line.text,
              options: {
                fontSize: Math.max(7, Math.min(64, Math.round(line.fontSizePt * ptScale * 0.94))),
                bold: line.bold,
                italic: line.italic,
                color: line.colorHex,
                fontFace: line.fontFamily,
                breakLine: lIdx < para.lines.length - 1,
              },
            })),
            {
              x: boxX,
              y: boxY,
              w: boxW,
              h: boxH,
              align: para.align,
              valign: 'top',
              margin: 0,
              lineSpacingMultiple: 1.08,
              fit: 'shrink',
            }
          );
        }
      }
    }

    onProgress?.({ percent: 94, message: 'Empaquetando presentación .pptx...' });
    const out = await pptx.write({ outputType: 'blob' });
    onProgress?.({ percent: 100, message: 'Presentación PowerPoint lista' });
    return { blob: out as Blob, filename: `${cleanName}.pptx` };
  } finally {
    await destroyPdfDocument(pdf);
  }
}

/**
 * PDF → Word (.docx) con objetos separados y texto editable (sin imagen gigante aplastando la página).
 */
export async function convertPdfToDocx(
  buffer: ArrayBuffer,
  baseName: string,
  onProgress?: (p: ProgressInfo) => void
): Promise<{ blob: Blob; filename: string }> {
  const cleanName = baseName.replace(/\.pdf$/i, '');
  onProgress?.({ percent: 6, message: 'Preparando motor de reconstrucción Word...' });

  const [pdf, docx] = await Promise.all([loadPdfDocument(buffer), import('docx')]);
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    ImageRun,
    AlignmentType,
    FrameAnchorType,
    FrameWrap,
    HorizontalPositionRelativeFrom,
    VerticalPositionRelativeFrom,
    TextWrappingType,
    PageOrientation,
  } = docx;

  const PT_TO_TWIPS = 20;
  const PT_TO_EMU = 12700;
  const PT_TO_PX = 96 / 72;

  const sections: Array<{
    properties: Record<string, unknown>;
    children: Array<InstanceType<typeof Paragraph>>;
  }> = [];

  let docBgHex: string | undefined;

  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const pct = 10 + Math.round(((p - 0.5) / pdf.numPages) * 80);
      onProgress?.({
        percent: pct,
        message: `Descomponiendo objetos de página ${p} de ${pdf.numPages}...`,
      });

      const page = await pdf.getPage(p);
      const scene = await analyzePdfPage(page, p, (msg) =>
        onProgress?.({ percent: pct, message: msg })
      );

      if (p === 1 && scene.pageBackgroundHex && scene.pageBackgroundHex !== 'FFFFFF') {
        docBgHex = scene.pageBackgroundHex;
      }

      const pageWTrips = Math.round(scene.widthPt * PT_TO_TWIPS);
      const pageHTrips = Math.round(scene.heightPt * PT_TO_TWIPS);
      const pageChildren: Array<InstanceType<typeof Paragraph>> = [];

      if (scene.hasComplexLayout) {
        const graphicRuns: Array<InstanceType<typeof ImageRun>> = [];

        if (scene.scannedFallbackBg) {
          graphicRuns.push(
            new ImageRun({
              data: scene.scannedFallbackBg.pngBytes,
              type: 'png',
              transformation: {
                width: Math.round(scene.widthPt * PT_TO_PX),
                height: Math.round(scene.heightPt * PT_TO_PX),
              },
              floating: {
                horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
                verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
                behindDocument: true,
                allowOverlap: true,
                zIndex: 0,
                wrap: { type: TextWrappingType.NONE },
              },
            })
          );
        }

        // Insertar cada elemento (forma, pétalo, imagen) como su propio objeto separado en su coordenada exacta
        for (let idx = 0; idx < scene.elements.length; idx++) {
          const el = scene.elements[idx];
          let pngBytes: Uint8Array | null = null;
          let widthPx = Math.max(8, Math.round(el.width * scene.widthPt * PT_TO_PX));
          let heightPx = Math.max(8, Math.round(el.height * scene.heightPt * PT_TO_PX));

          if (el.kind === 'graphic') {
            pngBytes = el.pngBytes;
          } else {
            const rendered = await renderShapeElementToPng(el, scene.widthPt, scene.heightPt);
            if (rendered) {
              pngBytes = rendered.pngBytes;
              widthPx = Math.max(4, Math.round(rendered.widthPx * PT_TO_PX));
              heightPx = Math.max(4, Math.round(rendered.heightPx * PT_TO_PX));
            }
          }

          if (!pngBytes) continue;
          const isLargeContainer = el.width > 0.72 && el.height > 0.72;

          graphicRuns.push(
            new ImageRun({
              data: pngBytes,
              type: 'png',
              transformation: { width: widthPx, height: heightPx },
              floating: {
                horizontalPosition: {
                  relative: HorizontalPositionRelativeFrom.PAGE,
                  offset: Math.round(el.x * scene.widthPt * PT_TO_EMU),
                },
                verticalPosition: {
                  relative: VerticalPositionRelativeFrom.PAGE,
                  offset: Math.round(el.y * scene.heightPt * PT_TO_EMU),
                },
                behindDocument: isLargeContainer,
                allowOverlap: true,
                zIndex: isLargeContainer ? 1 : 10 + idx,
                wrap: { type: TextWrappingType.NONE },
              },
            })
          );
        }

        if (graphicRuns.length > 0) {
          pageChildren.push(
            new Paragraph({
              spacing: { before: 0, after: 0, line: 240 },
              children: graphicRuns,
            })
          );
        }

        // Cada bloque de texto en su posición exacta editable
        for (const para of scene.paragraphs) {
          const frameX = Math.max(0, Math.round(para.x * pageWTrips));
          const frameY = Math.max(0, Math.round(para.y * pageHTrips));
          const frameW = Math.min(
            pageWTrips - frameX,
            Math.max(720, Math.round((para.width + 0.03) * pageWTrips))
          );

          const alignment =
            para.align === 'center'
              ? AlignmentType.CENTER
              : para.align === 'right'
                ? AlignmentType.RIGHT
                : AlignmentType.LEFT;

          const runs: Array<InstanceType<typeof TextRun>> = [];
          para.lines.forEach((line, lIdx) => {
            runs.push(
              new TextRun({
                text: line.text,
                font: line.fontFamily,
                size: Math.round(Math.max(14, Math.min(96, line.fontSizePt * 2))),
                bold: line.bold,
                italics: line.italic,
                color: line.colorHex,
                break: lIdx > 0 ? 1 : undefined,
              })
            );
          });

          pageChildren.push(
            new Paragraph({
              alignment,
              spacing: { before: 0, after: 0, line: Math.round(para.fontSizePt * 24) },
              frame: {
                type: 'absolute',
                position: { x: frameX, y: frameY },
                width: frameW,
                anchor: {
                  horizontal: FrameAnchorType.PAGE,
                  vertical: FrameAnchorType.PAGE,
                },
                wrap: FrameWrap.NONE,
                space: { horizontal: 0, vertical: 0 },
              },
              children: runs,
            })
          );
        }

        if (pageChildren.length === 0) {
          pageChildren.push(new Paragraph({ children: [] }));
        }

        sections.push({
          properties: {
            page: {
              size: {
                width: scene.isLandscape ? pageHTrips : pageWTrips,
                height: scene.isLandscape ? pageWTrips : pageHTrips,
                orientation: scene.isLandscape
                  ? PageOrientation.LANDSCAPE
                  : PageOrientation.PORTRAIT,
              },
              margin: { top: 360, bottom: 360, left: 360, right: 360 },
            },
          },
          children: pageChildren,
        });
      } else {
        const sizes = scene.paragraphs.map((b) => b.fontSizePt).sort((a, b) => a - b);
        const medianSize = sizes[Math.floor(sizes.length / 2)] || 11;

        for (const para of scene.paragraphs) {
          const isH1 = para.fontSizePt >= medianSize * 1.45 && para.text.length < 140;
          const isH2 = !isH1 && para.fontSizePt >= medianSize * 1.2 && para.text.length < 160;
          const alignment =
            para.align === 'center'
              ? AlignmentType.CENTER
              : para.align === 'right'
                ? AlignmentType.RIGHT
                : AlignmentType.LEFT;

          pageChildren.push(
            new Paragraph({
              heading: isH1
                ? HeadingLevel.HEADING_1
                : isH2
                  ? HeadingLevel.HEADING_2
                  : undefined,
              alignment,
              spacing: { after: isH1 || isH2 ? 160 : 100 },
              children: [
                new TextRun({
                  text: para.lines.map((l) => l.text).join(' '),
                  font: para.fontFamily,
                  bold: para.bold || isH1 || isH2,
                  italics: para.italic,
                  color: para.colorHex,
                  size: Math.round(Math.max(16, Math.min(56, para.fontSizePt * 2))),
                }),
              ],
            })
          );
        }

        sections.push({
          properties: {
            page: {
              size: {
                width: scene.isLandscape ? pageHTrips : pageWTrips,
                height: scene.isLandscape ? pageWTrips : pageHTrips,
                orientation: scene.isLandscape
                  ? PageOrientation.LANDSCAPE
                  : PageOrientation.PORTRAIT,
              },
              margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 },
            },
          },
          children: pageChildren.length > 0 ? pageChildren : [new Paragraph({ children: [] })],
        });
      }
    }

    onProgress?.({ percent: 94, message: 'Empaquetando documento Word (.docx)...' });
    const doc = new Document({
      creator: 'PDFStudio Local',
      title: cleanName,
      background: docBgHex ? { color: docBgHex } : undefined,
      sections,
    });
    const blob = await Packer.toBlob(doc);
    onProgress?.({ percent: 100, message: 'Documento Word listo' });
    return { blob, filename: `${cleanName}.docx` };
  } finally {
    await destroyPdfDocument(pdf);
  }
}

function parseExcelCellValue(raw: string): string | number {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed.replace(/,/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return trimmed;
}

/**
 * PDF → Excel (.xlsx) o CSV con alineación global de columnas, detección numérica y ajuste de ancho automático.
 */
export async function convertPdfToExcel(
  buffer: ArrayBuffer,
  baseName: string,
  format: 'xlsx' | 'csv' = 'xlsx',
  onProgress?: (p: ProgressInfo) => void
): Promise<{ blob: Blob; filename: string }> {
  const cleanName = baseName.replace(/\.pdf$/i, '');
  onProgress?.({ percent: 8, message: 'Preparando motor de hojas de cálculo...' });

  const [pdf, XLSX] = await Promise.all([loadPdfDocument(buffer), import('xlsx')]);
  const wb = XLSX.utils.book_new();
  const allRows: Array<Array<string | number>> = [];

  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const pct = 12 + Math.round((p / pdf.numPages) * 78);
      onProgress?.({
        percent: pct,
        message: `Extrayendo tabla de página ${p} de ${pdf.numPages}...`,
      });

      const page = await pdf.getPage(p);
      const scene = await analyzePdfPage(page, p, (msg) =>
        onProgress?.({ percent: pct, message: msg })
      );

      const sorted = [...scene.rawLines].sort((a, b) =>
        Math.abs(a.y - b.y) > 0.012 ? a.y - b.y : a.x - b.x
      );

      const rowGroups: Array<typeof sorted> = [];
      for (const line of sorted) {
        const last = rowGroups[rowGroups.length - 1];
        if (last && Math.abs(line.y - last[0].y) <= Math.max(0.012, line.height * 0.65)) {
          last.push(line);
        } else {
          rowGroups.push([line]);
        }
      }

      const allXs = sorted.map((l) => l.x).sort((a, b) => a - b);
      const colAnchors: number[] = [];
      for (const x of allXs) {
        if (colAnchors.length === 0 || x - colAnchors[colAnchors.length - 1] > 0.065) {
          colAnchors.push(x);
        }
      }

      const sheetRows: Array<Array<string | number>> = rowGroups.map((row) => {
        row.sort((a, b) => a.x - b.x);
        if (colAnchors.length <= 1) {
          return row.map((r) => parseExcelCellValue(r.text));
        }

        const cells: string[] = new Array(colAnchors.length).fill('');
        for (const item of row) {
          let bestCol = 0;
          let bestDist = Infinity;
          for (let c = 0; c < colAnchors.length; c++) {
            const dist = Math.abs(item.x - colAnchors[c]);
            if (dist < bestDist) {
              bestDist = dist;
              bestCol = c;
            }
          }
          cells[bestCol] = cells[bestCol] ? `${cells[bestCol]} ${item.text}` : item.text;
        }
        while (cells.length > 1 && !cells[cells.length - 1]) cells.pop();
        return cells.map((c) => parseExcelCellValue(c));
      });

      const safeRows = sheetRows.length > 0 ? sheetRows : [['']];
      allRows.push(...safeRows);

      const ws = XLSX.utils.aoa_to_sheet(safeRows);
      const colWidths: Array<{ wch: number }> = [];
      for (const r of safeRows) {
        r.forEach((cell, idx) => {
          const len = String(cell ?? '').length;
          const prev = colWidths[idx]?.wch ?? 10;
          colWidths[idx] = { wch: Math.min(60, Math.max(prev, len + 3)) };
        });
      }
      ws['!cols'] = colWidths;

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
 * PDF → HTML adaptable con todos los objetos separados (fondo CSS, formas SVG/DIV, gráficos e imágenes y texto editable) o TXT.
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
  const htmlPages: string[] = [];

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const pct = Math.round(((p - 0.3) / pdf.numPages) * 90);
      onProgress?.({
        percent: pct,
        message: `Procesando página ${p} de ${pdf.numPages}...`,
      });
      const page = await pdf.getPage(p);
      const scene = await analyzePdfPage(page, p, (msg) =>
        onProgress?.({ percent: pct, message: msg })
      );

      pagesText.push(scene.paragraphs.map((b) => b.text).join('\n\n'));

      if (format === 'html') {
        const bgTag = scene.scannedFallbackBg
          ? `<img class="bg" src="${scene.scannedFallbackBg.dataUrl}" alt="" />`
          : '';

        const elementTags = scene.elements
          .map((el) => {
            const left = (el.x * 100).toFixed(3);
            const top = (el.y * 100).toFixed(3);
            const width = (el.width * 100).toFixed(3);
            const height = (el.height * 100).toFixed(3);

            if (el.kind === 'graphic') {
              return `<img class="obj" src="${el.dataUrl}" alt="" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%" />`;
            }

            if (el.shapeType === 'line') {
              const thickness = Math.max(1, el.strokeWidthPt || 1);
              const isVert = el.width < el.height;
              return `<div class="shp" style="left:${left}%;top:${top}%;width:${
                isVert ? `${thickness}px` : `${width}%`
              };height:${isVert ? `${height}%` : `${thickness}px`};background:#${
                el.strokeHex || '111827'
              }"></div>`;
            }

            const radius =
              el.shapeType === 'ellipse'
                ? '50%'
                : el.shapeType === 'roundRect'
                  ? `${Math.round((el.rectRadiusRatio ?? 0.08) * 180)}px`
                  : '0';
            const bg = el.fillHex ? `background:#${el.fillHex};` : '';
            const border =
              el.strokeHex && el.strokeWidthPt
                ? `border:${Math.max(1, el.strokeWidthPt)}px solid #${el.strokeHex};`
                : '';
            return `<div class="shp" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%;border-radius:${radius};${bg}${border}"></div>`;
          })
          .join('');

        const textTags = scene.paragraphs
          .map((para) => {
            const isVert = Math.abs(Math.abs(para.angleDeg) - 90) < 18;
            const fontPct = (para.fontSizePt / scene.widthPt) * 100;
            const transform = isVert ? `transform:rotate(${para.angleDeg}deg);` : '';
            return `<div class="txt" contenteditable="true" style="left:${(para.x * 100).toFixed(
              3
            )}%;top:${(para.y * 100).toFixed(3)}%;width:${(para.width * 100 + 2).toFixed(
              3
            )}%;font-size:clamp(9px, ${fontPct.toFixed(2)}cqw, 48px);font-family:${esc(
              para.fontFamily
            )},sans-serif;font-weight:${para.bold ? 700 : 400};font-style:${
              para.italic ? 'italic' : 'normal'
            };color:#${para.colorHex};text-align:${para.align};${transform}">${esc(
              para.text
            ).replace(/\n/g, '<br/>')}</div>`;
          })
          .join('');

        htmlPages.push(
          `<section class="pdf-page" style="aspect-ratio:${scene.widthPt.toFixed(
            2
          )}/${scene.heightPt.toFixed(2)};background:#${scene.pageBackgroundHex}">${bgTag}${elementTags}${textTags}</section>`
        );
      }
    }

    const fullText = pagesText.join('\n\n--- Página siguiente ---\n\n');

    if (format === 'txt') {
      const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
      onProgress?.({ percent: 100, message: 'Texto extraído' });
      return { blob, filename: `${cleanName}.txt`, textPreview: fullText };
    }

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(
      cleanName
    )}</title><style>*{box-sizing:border-box}body{margin:0;padding:24px 12px;background:#eef2f7;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;gap:24px}.pdf-page{position:relative;width:min(100%,960px);box-shadow:0 8px 28px rgba(15,23,42,.12);border-radius:6px;overflow:hidden;container-type:inline-size}.pdf-page .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none}.pdf-page .shp{position:absolute}.pdf-page .obj{position:absolute;object-fit:contain}.pdf-page .txt{position:absolute;line-height:1.18;outline:none;white-space:pre-wrap}.pdf-page .txt:focus{outline:1px dashed #2563eb;background:rgba(37,99,235,.06)}</style></head><body>${htmlPages.join(
      ''
    )}</body></html>`;

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
