import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Trash2, Copy, GripVertical } from 'lucide-react';
import type {
  AnnotationType,
  DrawPoint,
  EditorPageState,
  ExtractedTextBlock,
  FontFamilyKey,
  PageAnnotation,
  PageNumberConfig,
  WatermarkConfig,
} from '../../types/pdf';
import {
  extractPageTextBlocks,
  renderPageToCanvas,
  sampleCanvasBackgroundHex,
} from '../../lib/pdfCore';
import { generateId } from '../../lib/storage';

export type EditorToolMode =
  | 'select'
  | 'edit-text'
  | 'text'
  | 'highlight'
  | 'draw'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'redact'
  | 'note';

interface PageCanvasProps {
  pdfDoc: PDFDocumentProxy | null;
  pageState: EditorPageState;
  pageIndex: number;
  totalPages: number;
  scale: number;
  toolMode: EditorToolMode;
  activeColor: string;
  activeStrokeWidth: number;
  activeFontSize: number;
  activeFontFamily: FontFamilyKey;
  annotations: PageAnnotation[];
  selectedAnnotationId: string | null;
  watermark: WatermarkConfig;
  pageNumbers: PageNumberConfig;
  onSelectAnnotation: (id: string | null) => void;
  onAddAnnotation: (ann: PageAnnotation) => void;
  onUpdateAnnotation: (id: string, patch: Partial<PageAnnotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  onDuplicateAnnotation: (id: string) => void;
  onVisible?: (pageIndex: number) => void;
}

export const PageCanvas: React.FC<PageCanvasProps> = ({
  pdfDoc,
  pageState,
  pageIndex,
  totalPages,
  scale,
  toolMode,
  activeColor,
  activeStrokeWidth,
  activeFontSize,
  activeFontFamily,
  annotations,
  selectedAnnotationId,
  watermark,
  pageNumbers,
  onSelectAnnotation,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onDuplicateAnnotation,
  onVisible,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isVisible, setIsVisible] = useState(pageIndex < 3);
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: Math.round((pageState.blankWidthPt ?? 595.28) * scale),
    height: Math.round((pageState.blankHeightPt ?? 841.89) * scale),
  });
  const [textBlocks, setTextBlocks] = useState<ExtractedTextBlock[]>([]);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  // Estado temporal al crear trazos o formas arrastrando
  const [draftShape, setDraftShape] = useState<{
    startX: number;
    startY: number;
    curX: number;
    curY: number;
    points?: DrawPoint[];
  } | null>(null);

  // Estado temporal al arrastrar o redimensionar anotación existente
  const dragOpRef = useRef<{
    mode: 'move' | 'resize';
    annId: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  // Virtualización: observar cuándo la página entra cerca del viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
            if (entry.intersectionRatio > 0.35) {
              onVisible?.(pageIndex);
            }
          }
        }
      },
      { rootMargin: '420px 0px', threshold: [0.01, 0.4] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [pageIndex, onVisible]);

  // Renderizado real del PDF sobre canvas cuando está visible
  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      if (pageState.sourcePageIndex === null || !pdfDoc) {
        const w = Math.round((pageState.blankWidthPt ?? 595.28) * scale);
        const h = Math.round((pageState.blankHeightPt ?? 841.89) * scale);
        const swapped = pageState.rotation % 180 !== 0;
        const fw = swapped ? h : w;
        const fh = swapped ? w : h;
        setSize({ width: fw, height: fh });
        if (canvasRef.current) {
          canvasRef.current.width = fw;
          canvasRef.current.height = fh;
          canvasRef.current.style.width = `${fw}px`;
          canvasRef.current.style.height = `${fh}px`;
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, fw, fh);
          }
        }
        return;
      }

      const page = await pdfDoc.getPage(pageState.sourcePageIndex + 1);
      if (cancelled) return;
      const totalRot = (page.rotate + pageState.rotation) % 360;
      const vp = page.getViewport({ scale, rotation: totalRot });
      setSize({ width: Math.floor(vp.width), height: Math.floor(vp.height) });

      if (!isVisible || !canvasRef.current) return;
      try {
        await renderPageToCanvas(page, canvasRef.current, scale, pageState.rotation);
      } catch {
        // Cancelación normal al hacer zoom rápido
      }
    };

    render();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageState.sourcePageIndex, pageState.rotation, pageState.blankWidthPt, pageState.blankHeightPt, scale, isVisible]);

  // Extraer bloques de texto interactivos solo cuando el modo "Editar texto existente" está activo
  useEffect(() => {
    let cancelled = false;
    if (toolMode !== 'edit-text' || !isVisible || !pdfDoc || pageState.sourcePageIndex === null) {
      setTextBlocks([]);
      return;
    }

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageState.sourcePageIndex! + 1);
        if (cancelled) return;
        const blocks = await extractPageTextBlocks(page, pageState.rotation);
        if (!cancelled) setTextBlocks(blocks);
      } catch {
        if (!cancelled) setTextBlocks([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [toolMode, isVisible, pdfDoc, pageState.sourcePageIndex, pageState.rotation]);

  const getNormPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  // Manejar clic / inicio de trazo en la capa de página
  const handleOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    if (toolMode === 'select') {
      onSelectAnnotation(null);
      setEditingTextId(null);
      return;
    }

    if (toolMode === 'edit-text') return; // Los bloques tienen su propio clic

    const pt = getNormPoint(e.clientX, e.clientY);

    if (toolMode === 'text' || toolMode === 'note') {
      const id = generateId();
      const newAnn: PageAnnotation = {
        id,
        pageId: pageState.pageId,
        type: toolMode,
        x: Math.min(0.72, pt.x),
        y: Math.min(0.9, pt.y),
        width: toolMode === 'note' ? 0.28 : 0.32,
        height: toolMode === 'note' ? 0.14 : 0.055,
        text: toolMode === 'note' ? 'Nota...' : 'Nuevo texto',
        fontSize: toolMode === 'note' ? 11 : activeFontSize,
        fontFamily: activeFontFamily,
        color: toolMode === 'note' ? '#713F12' : activeColor,
        backgroundColor: toolMode === 'note' ? '#FEF08A' : 'transparent',
        opacity: 1,
      };
      onAddAnnotation(newAnn);
      onSelectAnnotation(id);
      setEditingTextId(id);
      return;
    }

    // Herramientas de arrastre (draw, highlight, rect, ellipse, line, arrow, redact)
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraftShape({
      startX: pt.x,
      startY: pt.y,
      curX: pt.x,
      curY: pt.y,
      points: toolMode === 'draw' ? [pt] : undefined,
    });
  };

  const handleOverlayPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragOpRef.current) {
      const op = dragOpRef.current;
      const rect = containerRef.current!.getBoundingClientRect();
      const dx = (e.clientX - op.startClientX) / rect.width;
      const dy = (e.clientY - op.startClientY) / rect.height;

      if (op.mode === 'move') {
        onUpdateAnnotation(op.annId, {
          x: Math.max(0, Math.min(1 - op.origW, op.origX + dx)),
          y: Math.max(0, Math.min(1 - op.origH, op.origY + dy)),
        });
      } else {
        onUpdateAnnotation(op.annId, {
          width: Math.max(0.03, Math.min(1 - op.origX, op.origW + dx)),
          height: Math.max(0.02, Math.min(1 - op.origY, op.origH + dy)),
        });
      }
      return;
    }

    if (!draftShape) return;
    const pt = getNormPoint(e.clientX, e.clientY);
    if (toolMode === 'draw') {
      setDraftShape((prev) =>
        prev ? { ...prev, curX: pt.x, curY: pt.y, points: [...(prev.points || []), pt] } : null
      );
    } else {
      setDraftShape((prev) => (prev ? { ...prev, curX: pt.x, curY: pt.y } : null));
    }
  };

  const handleOverlayPointerUp = () => {
    if (dragOpRef.current) {
      dragOpRef.current = null;
      return;
    }
    if (!draftShape) return;

    const minX = Math.min(draftShape.startX, draftShape.curX);
    const minY = Math.min(draftShape.startY, draftShape.curY);
    const w = Math.abs(draftShape.curX - draftShape.startX);
    const h = Math.abs(draftShape.curY - draftShape.startY);

    if (toolMode === 'draw' && draftShape.points && draftShape.points.length >= 2) {
      const xs = draftShape.points.map((p) => p.x);
      const ys = draftShape.points.map((p) => p.y);
      const bx = Math.min(...xs);
      const by = Math.min(...ys);
      const bw = Math.max(0.01, Math.max(...xs) - bx);
      const bh = Math.max(0.01, Math.max(...ys) - by);
      const id = generateId();
      onAddAnnotation({
        id,
        pageId: pageState.pageId,
        type: 'draw',
        x: bx,
        y: by,
        width: bw,
        height: bh,
        strokeColor: activeColor,
        strokeWidth: activeStrokeWidth,
        points: draftShape.points,
        opacity: 1,
      });
    } else if (w > 0.008 || h > 0.008) {
      const id = generateId();
      const base: PageAnnotation = {
        id,
        pageId: pageState.pageId,
        type: toolMode as AnnotationType,
        x: minX,
        y: minY,
        width: Math.max(0.015, w),
        height: Math.max(0.012, h),
        color: toolMode === 'highlight' ? '#FDE047' : activeColor,
        strokeColor: activeColor,
        strokeWidth: activeStrokeWidth,
        fillColor: toolMode === 'redact' ? '#000000' : 'transparent',
        opacity: toolMode === 'highlight' ? 0.38 : 1,
        points:
          toolMode === 'line' || toolMode === 'arrow'
            ? [
                { x: draftShape.startX, y: draftShape.startY },
                { x: draftShape.curX, y: draftShape.curY },
              ]
            : undefined,
      };
      onAddAnnotation(base);
      onSelectAnnotation(id);
    }

    setDraftShape(null);
  };

  const handleClickExistingTextBlock = (block: ExtractedTextBlock) => {
    const bgHex = canvasRef.current
      ? sampleCanvasBackgroundHex(canvasRef.current, block.x, block.y, block.width, block.height)
      : '#FFFFFF';
    const id = generateId();
    onAddAnnotation({
      id,
      pageId: pageState.pageId,
      type: 'edit-text',
      x: block.x,
      y: block.y,
      width: Math.min(1 - block.x, Math.max(block.width + 0.02, 0.14)),
      height: Math.max(block.height + 0.004, 0.024),
      text: block.text,
      originalText: block.text,
      fontSize: block.fontSizePt,
      fontFamily: /times|serif/i.test(block.fontName)
        ? 'Times'
        : /courier|mono/i.test(block.fontName)
          ? 'Courier'
          : 'Helvetica',
      bold: /bold|black|heavy/i.test(block.fontName),
      italic: /italic|oblique/i.test(block.fontName),
      color: '#111827',
      backgroundColor: bgHex,
      opacity: 1,
    });
    onSelectAnnotation(id);
    setEditingTextId(id);
  };

  const startDragAnnotation = (
    e: React.PointerEvent,
    ann: PageAnnotation,
    mode: 'move' | 'resize'
  ) => {
    e.stopPropagation();
    onSelectAnnotation(ann.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragOpRef.current = {
      mode,
      annId: ann.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: ann.x,
      origY: ann.y,
      origW: ann.width,
      origH: ann.height,
    };
  };

  const cursorClass =
    toolMode === 'select'
      ? 'cursor-default'
      : toolMode === 'text' || toolMode === 'note'
        ? 'cursor-text'
        : toolMode === 'edit-text'
          ? 'cursor-pointer'
          : 'cursor-crosshair';

  const cssFontFamily = (f?: FontFamilyKey) =>
    f === 'Times'
      ? 'Georgia, "Times New Roman", serif'
      : f === 'Courier'
        ? '"Courier New", Courier, monospace'
        : 'Helvetica, Arial, sans-serif';

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        ref={containerRef}
        style={{ width: size.width, height: size.height }}
        onPointerDown={handleOverlayPointerDown}
        onPointerMove={handleOverlayPointerMove}
        onPointerUp={handleOverlayPointerUp}
        onPointerCancel={handleOverlayPointerUp}
        className={`relative select-none overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-slate-200/90 dark:ring-slate-700/90 ${
          toolMode !== 'select' ? 'touch-canvas' : ''
        } ${cursorClass}`}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />

        {/* Vista previa Marca de agua */}
        {watermark.enabled && watermark.text.trim() && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
            <span
              className="font-bold whitespace-nowrap"
              style={{
                fontSize: `${watermark.fontSize * scale}px`,
                color: watermark.color,
                opacity: watermark.opacity,
                transform: `rotate(${-watermark.rotation}deg)`,
              }}
            >
              {watermark.text}
            </span>
          </div>
        )}

        {/* Vista previa Numeración de página */}
        {pageNumbers.enabled && (
          <div
            className={`pointer-events-none absolute text-slate-600 ${
              pageNumbers.position === 'bottom-center'
                ? 'bottom-3 left-1/2 -translate-x-1/2'
                : pageNumbers.position === 'bottom-right'
                  ? 'bottom-3 right-5'
                  : 'top-3 right-5'
            }`}
            style={{ fontSize: `${10 * scale}px` }}
          >
            {pageNumbers.format === 'of-total'
              ? `${pageIndex + pageNumbers.startFrom} / ${totalPages + pageNumbers.startFrom - 1}`
              : `${pageIndex + pageNumbers.startFrom}`}
          </div>
        )}

        {/* Bloques de texto nativo detectados (Modo "Editar texto del PDF" estilo PDFelement) */}
        {toolMode === 'edit-text' &&
          textBlocks.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClickExistingTextBlock(b);
              }}
              title="Clic para editar este texto en su sitio"
              style={{
                left: `${b.x * 100}%`,
                top: `${b.y * 100}%`,
                width: `${b.width * 100}%`,
                height: `${b.height * 100}%`,
              }}
              className="absolute rounded-[2px] border border-dashed border-blue-500/70 bg-blue-500/8 transition-colors hover:border-blue-600 hover:bg-blue-500/20"
            />
          ))}

        {/* Capa SVG para trazos a mano alzada, líneas y flechas */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {annotations
            .filter((a) => a.type === 'draw' || a.type === 'line' || a.type === 'arrow')
            .map((a) => {
              const pts = a.points || [];
              if (pts.length < 2) return null;
              const isSelected = a.id === selectedAnnotationId;
              const strokeW = Math.max(0.25, (a.strokeWidth ?? 2.2) * 0.22);

              if (a.type === 'draw') {
                const d = pts
                  .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x * 100).toFixed(2)} ${(p.y * 100).toFixed(2)}`)
                  .join(' ');
                return (
                  <path
                    key={a.id}
                    d={d}
                    fill="none"
                    stroke={a.strokeColor || '#2563EB'}
                    strokeWidth={strokeW}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={a.opacity ?? 1}
                    className={isSelected ? 'drop-shadow' : ''}
                  />
                );
              }

              const start = pts[0];
              const end = pts[pts.length - 1];
              const x1 = start.x * 100;
              const y1 = start.y * 100;
              const x2 = end.x * 100;
              const y2 = end.y * 100;
              const angle = Math.atan2(y2 - y1, x2 - x1);
              const head = 2.1;
              return (
                <g key={a.id} opacity={a.opacity ?? 1}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={a.strokeColor || '#EF4444'}
                    strokeWidth={strokeW}
                    strokeLinecap="round"
                  />
                  {a.type === 'arrow' && (
                    <>
                      <line
                        x1={x2}
                        y1={y2}
                        x2={x2 + Math.cos(angle + Math.PI * 0.82) * head}
                        y2={y2 + Math.sin(angle + Math.PI * 0.82) * head}
                        stroke={a.strokeColor || '#EF4444'}
                        strokeWidth={strokeW}
                        strokeLinecap="round"
                      />
                      <line
                        x1={x2}
                        y1={y2}
                        x2={x2 + Math.cos(angle - Math.PI * 0.82) * head}
                        y2={y2 + Math.sin(angle - Math.PI * 0.82) * head}
                        stroke={a.strokeColor || '#EF4444'}
                        strokeWidth={strokeW}
                        strokeLinecap="round"
                      />
                    </>
                  )}
                </g>
              );
            })}

          {/* Trazo/línea en curso */}
          {draftShape && toolMode === 'draw' && draftShape.points && draftShape.points.length >= 2 && (
            <path
              d={draftShape.points
                .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x * 100).toFixed(2)} ${(p.y * 100).toFixed(2)}`)
                .join(' ')}
              fill="none"
              stroke={activeColor}
              strokeWidth={Math.max(0.25, activeStrokeWidth * 0.22)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {draftShape && (toolMode === 'line' || toolMode === 'arrow') && (
            <line
              x1={draftShape.startX * 100}
              y1={draftShape.startY * 100}
              x2={draftShape.curX * 100}
              y2={draftShape.curY * 100}
              stroke={activeColor}
              strokeWidth={Math.max(0.25, activeStrokeWidth * 0.22)}
              strokeLinecap="round"
            />
          )}
        </svg>

        {/* Borrador de rectángulo / resaltado / elipse / redacción */}
        {draftShape &&
          (toolMode === 'rect' ||
            toolMode === 'ellipse' ||
            toolMode === 'highlight' ||
            toolMode === 'redact') && (
            <div
              className="pointer-events-none absolute"
              style={{
                left: `${Math.min(draftShape.startX, draftShape.curX) * 100}%`,
                top: `${Math.min(draftShape.startY, draftShape.curY) * 100}%`,
                width: `${Math.abs(draftShape.curX - draftShape.startX) * 100}%`,
                height: `${Math.abs(draftShape.curY - draftShape.startY) * 100}%`,
                borderRadius: toolMode === 'ellipse' ? '9999px' : '2px',
                backgroundColor:
                  toolMode === 'redact'
                    ? '#000000'
                    : toolMode === 'highlight'
                      ? 'rgba(253, 224, 71, 0.42)'
                      : 'transparent',
                border:
                  toolMode === 'rect' || toolMode === 'ellipse'
                    ? `${activeStrokeWidth}px solid ${activeColor}`
                    : 'none',
              }}
            />
          )}

        {/* Anotaciones renderizadas e interactivas */}
        {annotations.map((ann) => {
          const isSelected = ann.id === selectedAnnotationId;
          const isEditing = ann.id === editingTextId;

          const commonStyle: React.CSSProperties = {
            left: `${ann.x * 100}%`,
            top: `${ann.y * 100}%`,
            width: `${ann.width * 100}%`,
            height: `${ann.height * 100}%`,
          };

          const showSelectionRing = isSelected
            ? 'ring-2 ring-blue-500 ring-offset-1'
            : 'hover:ring-1 hover:ring-blue-400/70';

          // Para trazos y líneas solo mostramos caja invisible clicable en modo select
          if (ann.type === 'draw' || ann.type === 'line' || ann.type === 'arrow') {
            return (
              <div
                key={ann.id}
                style={commonStyle}
                onPointerDown={(e) => {
                  if (toolMode === 'select') {
                    e.stopPropagation();
                    onSelectAnnotation(ann.id);
                  }
                }}
                className={`absolute ${
                  toolMode === 'select' ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'
                } ${isSelected ? 'ring-1 ring-dashed ring-blue-500 rounded' : ''}`}
              >
                {isSelected && (
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteAnnotation(ann.id);
                    }}
                    className="absolute -right-3 -top-3 rounded-full bg-rose-600 p-1 text-white shadow hover:bg-rose-700"
                    title="Eliminar"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          }

          return (
            <div
              key={ann.id}
              style={{
                ...commonStyle,
                backgroundColor:
                  ann.type === 'redact'
                    ? '#000000'
                    : ann.type === 'highlight'
                      ? ann.color || '#FDE047'
                      : ann.type === 'edit-text'
                        ? ann.backgroundColor || '#FFFFFF'
                        : ann.type === 'note'
                          ? ann.backgroundColor || '#FEF08A'
                          : ann.backgroundColor && ann.backgroundColor !== 'transparent'
                            ? ann.backgroundColor
                            : undefined,
                opacity: ann.type === 'highlight' ? (ann.opacity ?? 0.38) : (ann.opacity ?? 1),
                border:
                  ann.type === 'rect' || ann.type === 'ellipse'
                    ? `${Math.max(1.5, (ann.strokeWidth ?? 2) * scale)}px solid ${ann.strokeColor || '#2563EB'}`
                    : ann.type === 'note'
                      ? '1px solid #EAB308'
                      : undefined,
                borderRadius: ann.type === 'ellipse' ? '9999px' : ann.type === 'note' ? '6px' : '2px',
              }}
              onPointerDown={(e) => {
                if (isEditing) {
                  e.stopPropagation();
                  return;
                }
                startDragAnnotation(e, ann, 'move');
              }}
              onDoubleClick={(e) => {
                if (ann.type === 'text' || ann.type === 'edit-text' || ann.type === 'note') {
                  e.stopPropagation();
                  setEditingTextId(ann.id);
                  onSelectAnnotation(ann.id);
                }
              }}
              className={`absolute transition-shadow ${showSelectionRing} ${
                isEditing ? 'cursor-text' : 'cursor-move'
              }`}
            >
              {/* Contenido de texto / edit-text / nota */}
              {(ann.type === 'text' || ann.type === 'edit-text' || ann.type === 'note') && (
                isEditing ? (
                  <textarea
                    autoFocus
                    value={ann.text ?? ''}
                    onChange={(e) => onUpdateAnnotation(ann.id, { text: e.target.value })}
                    onBlur={() => setEditingTextId(null)}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      fontSize: `${(ann.fontSize ?? 13) * scale}px`,
                      fontFamily: cssFontFamily(ann.fontFamily),
                      fontWeight: ann.bold ? 700 : 400,
                      fontStyle: ann.italic ? 'italic' : 'normal',
                      color: ann.color || '#111827',
                      lineHeight: 1.25,
                    }}
                    className={`h-full w-full resize-none bg-transparent outline-none ${
                      ann.type === 'note' ? 'p-1.5' : 'px-0.5'
                    }`}
                  />
                ) : (
                  <div
                    style={{
                      fontSize: `${(ann.fontSize ?? 13) * scale}px`,
                      fontFamily: cssFontFamily(ann.fontFamily),
                      fontWeight: ann.bold ? 700 : 400,
                      fontStyle: ann.italic ? 'italic' : 'normal',
                      color: ann.color || '#111827',
                      lineHeight: 1.25,
                    }}
                    className={`h-full w-full overflow-hidden whitespace-pre-wrap break-words ${
                      ann.type === 'note' ? 'p-1.5' : 'px-0.5'
                    }`}
                  >
                    {ann.text}
                  </div>
                )
              )}

              {/* Imágenes y firmas */}
              {(ann.type === 'image' || ann.type === 'signature') && ann.imageDataUrl && (
                <img
                  src={ann.imageDataUrl}
                  alt={ann.type === 'signature' ? 'Firma' : 'Imagen insertada'}
                  draggable={false}
                  className="pointer-events-none h-full w-full object-contain"
                />
              )}

              {/* Controles flotantes cuando está seleccionado */}
              {isSelected && (
                <>
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute -top-8 left-0 z-20 flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1.5 py-0.5 shadow-md dark:border-slate-700 dark:bg-slate-900"
                  >
                    <GripVertical className="h-3 w-3 text-slate-400" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicateAnnotation(ann.id);
                      }}
                      className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800"
                      title="Duplicar"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteAnnotation(ann.id);
                      }}
                      className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                      title="Eliminar"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Manejador de redimensión */}
                  <div
                    onPointerDown={(e) => startDragAnnotation(e, ann, 'resize')}
                    className="absolute -bottom-1.5 -right-1.5 z-20 h-3.5 w-3.5 cursor-nwse-resize rounded-full border-2 border-white bg-blue-600 shadow"
                    title="Redimensionar"
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
        Página {pageIndex + 1} de {totalPages}
      </span>
    </div>
  );
};
