import type {
  EditorPageState,
  FontFamilyKey,
  PageAnnotation,
  PageNumberConfig,
  WatermarkConfig,
} from '../types/pdf';

function hexToRgbValues(hex = '#000000'): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) / 255;
    const g = parseInt(clean[1] + clean[1], 16) / 255;
    const b = parseInt(clean[2] + clean[2], 16) / 255;
    return { r, g, b };
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    return { r, g, b };
  }
  return { r: 0, g: 0, b: 0 };
}

/**
 * Sanitiza texto para StandardFonts (WinAnsi) preservando acentos españoles (áéíóúñü¿¡€°).
 */
function sanitizeWinAnsi(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF\n\r\t€]/g, '');
}

function wrapTextLines(
  text: string,
  maxWidth: number,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  fontSize: number
): string[] {
  const safe = sanitizeWinAnsi(text);
  const paragraphs = safe.split(/\r?\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (!para) {
      lines.push('');
      continue;
    }
    const words = para.split(' ');
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (maxWidth > 12 && font.widthOfTextAtSize(candidate, fontSize) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

async function dataUrlToBytes(dataUrl: string): Promise<{ bytes: Uint8Array; isPng: boolean }> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const isPng = blob.type.includes('png') || dataUrl.startsWith('data:image/png');
  if (blob.type.includes('webp') || (!isPng && !blob.type.includes('jpeg') && !blob.type.includes('jpg'))) {
    // Convertir WebP u otros formatos a PNG en un canvas para compatibilidad total con pdf-lib
    const img = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(img, 0, 0);
    const pngBlob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Error convirtiendo imagen'))), 'image/png')
    );
    return { bytes: new Uint8Array(await pngBlob.arrayBuffer()), isPng: true };
  }
  return { bytes: new Uint8Array(await blob.arrayBuffer()), isPng };
}

/**
 * Transforma un punto normalizado del espacio visual (top-left, tras rotación visible)
 * al sistema de coordenadas interno de pdf-lib (bottom-left sin rotar).
 */
function visualToPdfPoint(
  normX: number,
  normY: number,
  mediaW: number,
  mediaH: number,
  totalRotation: number
): { x: number; y: number } {
  const rot = ((totalRotation % 360) + 360) % 360;
  switch (rot) {
    case 90:
      return { x: normY * mediaW, y: normX * mediaH };
    case 180:
      return { x: (1 - normX) * mediaW, y: normY * mediaH };
    case 270:
      return { x: (1 - normY) * mediaW, y: (1 - normX) * mediaH };
    default:
      return { x: normX * mediaW, y: (1 - normY) * mediaH };
  }
}

export async function exportEditedPdf(params: {
  sourceBuffer: ArrayBuffer;
  pages: EditorPageState[];
  annotations: PageAnnotation[];
  watermark?: WatermarkConfig;
  pageNumbers?: PageNumberConfig;
  title?: string;
}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, degrees, LineCapStyle } = await import('pdf-lib');

  const srcDoc = await PDFDocument.load(params.sourceBuffer.slice(0), { ignoreEncryption: true });
  const outDoc = await PDFDocument.create();
  if (params.title) outDoc.setTitle(params.title);
  outDoc.setProducer('PDFStudio — 100% Local Client-Side');
  outDoc.setCreator('PDFStudio');

  // Cache de fuentes estándar
  const fontCache = new Map<string, Awaited<ReturnType<typeof outDoc.embedFont>>>();
  const getFont = async (family: FontFamilyKey = 'Helvetica', bold = false, italic = false) => {
    const key = `${family}-${bold}-${italic}`;
    const existing = fontCache.get(key);
    if (existing) return existing;

    let std = StandardFonts.Helvetica;
    if (family === 'Helvetica') {
      if (bold && italic) std = StandardFonts.HelveticaBoldOblique;
      else if (bold) std = StandardFonts.HelveticaBold;
      else if (italic) std = StandardFonts.HelveticaOblique;
      else std = StandardFonts.Helvetica;
    } else if (family === 'Times') {
      if (bold && italic) std = StandardFonts.TimesRomanBoldItalic;
      else if (bold) std = StandardFonts.TimesRomanBold;
      else if (italic) std = StandardFonts.TimesRomanItalic;
      else std = StandardFonts.TimesRoman;
    } else if (family === 'Courier') {
      if (bold && italic) std = StandardFonts.CourierBoldOblique;
      else if (bold) std = StandardFonts.CourierBold;
      else if (italic) std = StandardFonts.CourierOblique;
      else std = StandardFonts.Courier;
    }

    const embedded = await outDoc.embedFont(std);
    fontCache.set(key, embedded);
    return embedded;
  };

  // Pre-copiar páginas de origen de forma eficiente
  const validSourceIndices = params.pages
    .map((p) => p.sourcePageIndex)
    .filter((i): i is number => i !== null && i >= 0 && i < srcDoc.getPageCount());
  const uniqueIndices = Array.from(new Set(validSourceIndices));
  const copiedMap = new Map<number, number>();
  // Como una página puede duplicarse, copiamos en cada iteración si se repite
  void copiedMap;
  void uniqueIndices;

  const totalOutPages = params.pages.length;

  for (let outIdx = 0; outIdx < totalOutPages; outIdx++) {
    const pageState = params.pages[outIdx];
    let page;
    let baseRotation = 0;

    if (pageState.sourcePageIndex !== null && pageState.sourcePageIndex < srcDoc.getPageCount()) {
      const [copied] = await outDoc.copyPages(srcDoc, [pageState.sourcePageIndex]);
      baseRotation = copied.getRotation().angle;
      const finalRot = (baseRotation + pageState.rotation) % 360;
      if (pageState.rotation !== 0) {
        copied.setRotation(degrees(finalRot));
      }
      page = outDoc.addPage(copied);
    } else {
      page = outDoc.addPage([pageState.blankWidthPt ?? 595.28, pageState.blankHeightPt ?? 841.89]);
      if (pageState.rotation !== 0) {
        page.setRotation(degrees(pageState.rotation % 360));
      }
    }

    const mediaW = page.getWidth();
    const mediaH = page.getHeight();
    const totalRot = ((page.getRotation().angle % 360) + 360) % 360;
    const isSwapped = totalRot === 90 || totalRot === 270;
    const visW = isSwapped ? mediaH : mediaW;
    const visH = isSwapped ? mediaW : mediaH;

    const pageAnns = params.annotations.filter((a) => a.pageId === pageState.pageId);

    for (const ann of pageAnns) {
      const opacity = ann.opacity ?? 1;

      if (ann.type === 'rect' || ann.type === 'highlight' || ann.type === 'redact') {
        const fillHex =
          ann.type === 'redact'
            ? '#000000'
            : ann.type === 'highlight'
              ? ann.color || '#FDE047'
              : ann.fillColor;
        const borderHex = ann.type === 'rect' ? ann.strokeColor || '#2563EB' : undefined;
        const rectOpacity = ann.type === 'highlight' ? (ann.opacity ?? 0.38) : opacity;

        const p1 = visualToPdfPoint(ann.x, ann.y, mediaW, mediaH, totalRot);
        const p2 = visualToPdfPoint(ann.x + ann.width, ann.y + ann.height, mediaW, mediaH, totalRot);
        const rx = Math.min(p1.x, p2.x);
        const ry = Math.min(p1.y, p2.y);
        const rw = Math.abs(p2.x - p1.x);
        const rh = Math.abs(p2.y - p1.y);

        const f = fillHex && fillHex !== 'transparent' ? hexToRgbValues(fillHex) : null;
        const b = borderHex ? hexToRgbValues(borderHex) : null;

        page.drawRectangle({
          x: rx,
          y: ry,
          width: rw,
          height: rh,
          color: f ? rgb(f.r, f.g, f.b) : undefined,
          opacity: f ? rectOpacity : undefined,
          borderColor: b ? rgb(b.r, b.g, b.b) : undefined,
          borderWidth: b ? (ann.strokeWidth ?? 2) : undefined,
          borderOpacity: b ? opacity : undefined,
        });
      } else if (ann.type === 'ellipse') {
        const p1 = visualToPdfPoint(ann.x, ann.y, mediaW, mediaH, totalRot);
        const p2 = visualToPdfPoint(ann.x + ann.width, ann.y + ann.height, mediaW, mediaH, totalRot);
        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        const xScale = Math.abs(p2.x - p1.x) / 2;
        const yScale = Math.abs(p2.y - p1.y) / 2;
        const b = hexToRgbValues(ann.strokeColor || '#2563EB');
        const f = ann.fillColor && ann.fillColor !== 'transparent' ? hexToRgbValues(ann.fillColor) : null;

        page.drawEllipse({
          x: cx,
          y: cy,
          xScale,
          yScale,
          color: f ? rgb(f.r, f.g, f.b) : undefined,
          opacity: f ? opacity * 0.25 : undefined,
          borderColor: rgb(b.r, b.g, b.b),
          borderWidth: ann.strokeWidth ?? 2,
          borderOpacity: opacity,
        });
      } else if (ann.type === 'line' || ann.type === 'arrow') {
        const pts = ann.points && ann.points.length >= 2
          ? ann.points
          : [
              { x: ann.x, y: ann.y },
              { x: ann.x + ann.width, y: ann.y + ann.height },
            ];
        const start = visualToPdfPoint(pts[0].x, pts[0].y, mediaW, mediaH, totalRot);
        const end = visualToPdfPoint(pts[pts.length - 1].x, pts[pts.length - 1].y, mediaW, mediaH, totalRot);
        const c = hexToRgbValues(ann.strokeColor || '#EF4444');
        const thickness = ann.strokeWidth ?? 2.2;

        page.drawLine({
          start,
          end,
          thickness,
          color: rgb(c.r, c.g, c.b),
          opacity,
          lineCap: LineCapStyle.Round,
        });

        if (ann.type === 'arrow') {
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const headLen = Math.max(8, thickness * 4.5);
          const a1 = angle + Math.PI * 0.82;
          const a2 = angle - Math.PI * 0.82;
          page.drawLine({
            start: end,
            end: { x: end.x + Math.cos(a1) * headLen, y: end.y + Math.sin(a1) * headLen },
            thickness,
            color: rgb(c.r, c.g, c.b),
            opacity,
            lineCap: LineCapStyle.Round,
          });
          page.drawLine({
            start: end,
            end: { x: end.x + Math.cos(a2) * headLen, y: end.y + Math.sin(a2) * headLen },
            thickness,
            color: rgb(c.r, c.g, c.b),
            opacity,
            lineCap: LineCapStyle.Round,
          });
        }
      } else if (ann.type === 'draw' && ann.points && ann.points.length >= 2) {
        const c = hexToRgbValues(ann.strokeColor || '#2563EB');
        const thickness = ann.strokeWidth ?? 2.2;
        for (let i = 1; i < ann.points.length; i++) {
          const start = visualToPdfPoint(ann.points[i - 1].x, ann.points[i - 1].y, mediaW, mediaH, totalRot);
          const end = visualToPdfPoint(ann.points[i].x, ann.points[i].y, mediaW, mediaH, totalRot);
          page.drawLine({
            start,
            end,
            thickness,
            color: rgb(c.r, c.g, c.b),
            opacity,
            lineCap: LineCapStyle.Round,
          });
        }
      } else if ((ann.type === 'image' || ann.type === 'signature') && ann.imageDataUrl) {
        try {
          const { bytes, isPng } = await dataUrlToBytes(ann.imageDataUrl);
          const img = isPng ? await outDoc.embedPng(bytes) : await outDoc.embedJpg(bytes);
          const p1 = visualToPdfPoint(ann.x, ann.y, mediaW, mediaH, totalRot);
          const p2 = visualToPdfPoint(ann.x + ann.width, ann.y + ann.height, mediaW, mediaH, totalRot);

          if (totalRot === 0) {
            page.drawImage(img, {
              x: Math.min(p1.x, p2.x),
              y: Math.min(p1.y, p2.y),
              width: Math.abs(p2.x - p1.x),
              height: Math.abs(p2.y - p1.y),
              opacity,
            });
          } else {
            // Para páginas rotadas ajustamos el anclaje según la rotación
            const boxW = ann.width * visW;
            const boxH = ann.height * visH;
            const anchor = visualToPdfPoint(ann.x, ann.y + ann.height, mediaW, mediaH, totalRot);
            page.drawImage(img, {
              x: anchor.x,
              y: anchor.y,
              width: boxW,
              height: boxH,
              rotate: degrees(totalRot),
              opacity,
            });
          }
        } catch (err) {
          console.warn('No se pudo incrustar imagen/firma:', err);
        }
      } else if (ann.type === 'text' || ann.type === 'edit-text' || ann.type === 'note') {
        const fontSize = ann.fontSize ?? 13;
        const font = await getFont(ann.fontFamily ?? 'Helvetica', ann.bold, ann.italic);
        const textColor = hexToRgbValues(ann.color || '#111827');

        // Fondo: en edit-text cubre el texto original del PDF; en note pinta post-it amarillo
        const bgHex =
          ann.type === 'edit-text'
            ? ann.backgroundColor || '#FFFFFF'
            : ann.type === 'note'
              ? ann.backgroundColor || '#FEF08A'
              : ann.backgroundColor;

        if (bgHex && bgHex !== 'transparent') {
          const padX = ann.type === 'edit-text' ? 0.004 : 0;
          const padY = ann.type === 'edit-text' ? 0.003 : 0;
          const p1 = visualToPdfPoint(Math.max(0, ann.x - padX), Math.max(0, ann.y - padY), mediaW, mediaH, totalRot);
          const p2 = visualToPdfPoint(
            Math.min(1, ann.x + ann.width + padX),
            Math.min(1, ann.y + ann.height + padY),
            mediaW,
            mediaH,
            totalRot
          );
          const bg = hexToRgbValues(bgHex);
          page.drawRectangle({
            x: Math.min(p1.x, p2.x),
            y: Math.min(p1.y, p2.y),
            width: Math.abs(p2.x - p1.x),
            height: Math.abs(p2.y - p1.y),
            color: rgb(bg.r, bg.g, bg.b),
            opacity: ann.type === 'note' ? 0.94 : 1,
            borderColor: ann.type === 'note' ? rgb(0.92, 0.7, 0.03) : undefined,
            borderWidth: ann.type === 'note' ? 1 : undefined,
          });
        }

        const content = ann.text ?? '';
        if (content.trim()) {
          const boxW = Math.max(24, ann.width * visW - (ann.type === 'note' ? 10 : 2));
          const lines = wrapTextLines(content, boxW, font, fontSize);
          const lineHeight = fontSize * 1.25;
          const paddingTop = ann.type === 'note' ? 6 : 1;
          const paddingLeft = ann.type === 'note' ? 6 : 1;

          lines.forEach((line, lineIdx) => {
            if (!line) return;
            const normLineY = ann.y + (paddingTop + fontSize * 0.88 + lineIdx * lineHeight) / visH;
            const normLineX = ann.x + paddingLeft / visW;
            const pt = visualToPdfPoint(normLineX, normLineY, mediaW, mediaH, totalRot);
            page.drawText(line, {
              x: pt.x,
              y: pt.y,
              size: fontSize,
              font,
              color: rgb(textColor.r, textColor.g, textColor.b),
              opacity,
              rotate: totalRot !== 0 ? degrees(totalRot) : undefined,
            });
          });
        }
      }
    }

    // Marca de agua opcional en todas las páginas
    if (params.watermark?.enabled && params.watermark.text.trim()) {
      const wmFont = await getFont('Helvetica', true, false);
      const wmText = sanitizeWinAnsi(params.watermark.text);
      const wmSize = params.watermark.fontSize || 46;
      const wmWidth = wmFont.widthOfTextAtSize(wmText, wmSize);
      const wmColor = hexToRgbValues(params.watermark.color || '#94A3B8');

      page.drawText(wmText, {
        x: mediaW / 2 - wmWidth / 2.6,
        y: mediaH / 2 - wmSize / 3,
        size: wmSize,
        font: wmFont,
        color: rgb(wmColor.r, wmColor.g, wmColor.b),
        opacity: params.watermark.opacity ?? 0.22,
        rotate: degrees(params.watermark.rotation ?? 35),
      });
    }

    // Numeración de páginas opcional
    if (params.pageNumbers?.enabled) {
      const numFont = await getFont('Helvetica', false, false);
      const numVal = outIdx + (params.pageNumbers.startFrom || 1);
      const label =
        params.pageNumbers.format === 'of-total'
          ? `${numVal} / ${totalOutPages + (params.pageNumbers.startFrom || 1) - 1}`
          : `${numVal}`;
      const size = 10;
      const w = numFont.widthOfTextAtSize(label, size);
      let nx = mediaW / 2 - w / 2;
      let ny = 22;
      if (params.pageNumbers.position === 'bottom-right') {
        nx = mediaW - w - 32;
        ny = 22;
      } else if (params.pageNumbers.position === 'top-right') {
        nx = mediaW - w - 32;
        ny = mediaH - 28;
      }
      page.drawText(label, {
        x: nx,
        y: ny,
        size,
        font: numFont,
        color: rgb(0.35, 0.4, 0.48),
      });
    }
  }

  return outDoc.save({ useObjectStreams: true });
}
