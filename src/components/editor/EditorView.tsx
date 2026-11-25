import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  MousePointer2,
  Type,
  FilePenLine,
  Highlighter,
  Pencil,
  Square,
  Circle,
  Minus,
  MoveUpRight,
  ImagePlus,
  PenTool,
  EyeOff,
  StickyNote,
  ZoomIn,
  ZoomOut,
  RotateCw,
  CopyPlus,
  FilePlus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Undo2,
  Redo2,
  Download,
  Save,
  PanelLeft,
  Bold,
  Italic,
  Droplets,
  Hash,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import type {
  EditorPageState,
  FontFamilyKey,
  LocalPdfDoc,
  PageAnnotation,
  PageNumberConfig,
  WatermarkConfig,
} from '../../types/pdf';
import { destroyPdfDocument, generatePdfThumbnail, loadPdfDocument } from '../../lib/pdfCore';
import { exportEditedPdf } from '../../lib/pdfEditorEngine';
import { downloadUint8Array, generateId, saveLocalDoc } from '../../lib/storage';
import { PageCanvas, type EditorToolMode } from './PageCanvas';
import { SignatureModal } from './SignatureModal';

interface EditorViewProps {
  doc: LocalPdfDoc;
  onDocSaved: (updated: LocalPdfDoc) => void;
  onDirtyChange: (dirty: boolean) => void;
}

type RibbonTab = 'edit' | 'annotate' | 'pages' | 'protect';

interface HistorySnapshot {
  pages: EditorPageState[];
  annotations: PageAnnotation[];
}

export const EditorView: React.FC<EditorViewProps> = ({
  doc,
  onDocSaved,
  onDirtyChange,
}) => {
  const [pdfProxy, setPdfProxy] = useState<PDFDocumentProxy | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('edit');
  const [toolMode, setToolMode] = useState<EditorToolMode>('select');
  const [showThumbnails, setShowThumbnails] = useState(() => window.innerWidth >= 1024);

  const [scale, setScale] = useState(() => (window.innerWidth < 640 ? 0.62 : 1.05));
  const [currentPageIdx, setCurrentPageIdx] = useState(0);

  const [pages, setPages] = useState<EditorPageState[]>([]);
  const [annotations, setAnnotations] = useState<PageAnnotation[]>([]);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);

  // Historial Deshacer / Rehacer
  const [past, setPast] = useState<HistorySnapshot[]>([]);
  const [future, setFuture] = useState<HistorySnapshot[]>([]);

  // Propiedades activas de herramienta
  const [activeColor, setActiveColor] = useState('#1E293B');
  const [activeStrokeWidth, setActiveStrokeWidth] = useState(2.2);
  const [activeFontSize, setActiveFontSize] = useState(14);
  const [activeFontFamily, setActiveFontFamily] = useState<FontFamilyKey>('Helvetica');

  // Marca de agua y numeración
  const [watermark, setWatermark] = useState<WatermarkConfig>({
    enabled: false,
    text: 'CONFIDENCIAL',
    opacity: 0.2,
    fontSize: 48,
    color: '#64748B',
    rotation: 35,
  });
  const [pageNumbers, setPageNumbers] = useState<PageNumberConfig>({
    enabled: false,
    position: 'bottom-center',
    format: 'of-total',
    startFrom: 1,
  });

  const [showSignModal, setShowSignModal] = useState(false);
  const [showWatermarkPanel, setShowWatermarkPanel] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  // Cargar PDF.js proxy cada vez que cambia el documento abierto
  useEffect(() => {
    let active = true;
    let loadedProxy: PDFDocumentProxy | null = null;
    setLoadingPdf(true);
    setErrorMsg(null);
    setAnnotations([]);
    setSelectedAnnId(null);
    setPast([]);
    setFuture([]);
    setCurrentPageIdx(0);
    onDirtyChange(false);

    (async () => {
      try {
        const proxy = await loadPdfDocument(doc.data);
        if (!active) {
          await destroyPdfDocument(proxy);
          return;
        }
        loadedProxy = proxy;
        setPdfProxy(proxy);
        const initPages: EditorPageState[] = Array.from({ length: proxy.numPages }, (_, i) => ({
          pageId: `pg-${i}-${generateId()}`,
          sourcePageIndex: i,
          rotation: 0,
        }));
        setPages(initPages);
      } catch (err) {
        if (active) {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : 'No se pudo abrir este PDF. Verifica que no esté dañado o protegido con contraseña.'
          );
        }
      } finally {
        if (active) setLoadingPdf(false);
      }
    })();

    return () => {
      active = false;
      destroyPdfDocument(loadedProxy).catch(() => {});
    };
  }, [doc.id, doc.updatedAt]);

  // Guardar instantánea en historial antes de mutar
  const pushHistory = useCallback(() => {
    setPast((prev) => [...prev.slice(-24), { pages, annotations }]);
    setFuture([]);
    onDirtyChange(true);
  }, [pages, annotations, onDirtyChange]);

  const handleUndo = useCallback(() => {
    setPast((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setFuture((f) => [{ pages, annotations }, ...f.slice(0, 24)]);
      setPages(last.pages);
      setAnnotations(last.annotations);
      setSelectedAnnId(null);
      return prev.slice(0, -1);
    });
  }, [pages, annotations]);

  const handleRedo = useCallback(() => {
    setFuture((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[0];
      setPast((p) => [...p.slice(-24), { pages, annotations }]);
      setPages(next.pages);
      setAnnotations(next.annotations);
      setSelectedAnnId(null);
      return prev.slice(1);
    });
  }, [pages, annotations]);

  const selectedAnn = annotations.find((a) => a.id === selectedAnnId) ?? null;

  const handleAddAnnotation = useCallback(
    (ann: PageAnnotation) => {
      pushHistory();
      setAnnotations((prev) => [...prev, ann]);
      if (ann.type === 'text' || ann.type === 'edit-text' || ann.type === 'note') {
        setToolMode('select');
      }
    },
    [pushHistory]
  );

  const handleUpdateAnnotation = useCallback(
    (id: string, patch: Partial<PageAnnotation>) => {
      setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
      onDirtyChange(true);
    },
    [onDirtyChange]
  );

  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      pushHistory();
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
      setSelectedAnnId((cur) => (cur === id ? null : cur));
    },
    [pushHistory]
  );

  const handleDuplicateAnnotation = useCallback(
    (id: string) => {
      const target = annotations.find((a) => a.id === id);
      if (!target) return;
      pushHistory();
      const copy: PageAnnotation = {
        ...target,
        id: generateId(),
        x: Math.min(0.85, target.x + 0.03),
        y: Math.min(0.88, target.y + 0.03),
      };
      setAnnotations((prev) => [...prev, copy]);
      setSelectedAnnId(copy.id);
    },
    [annotations, pushHistory]
  );

  // Atajos de teclado (Ctrl+Z, Ctrl+Y, Supr)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnId) {
        e.preventDefault();
        handleDeleteAnnotation(selectedAnnId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo, selectedAnnId, handleDeleteAnnotation]);

  // Operaciones de página
  const rotateCurrentPage = (idx: number) => {
    pushHistory();
    setPages((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, rotation: (p.rotation + 90) % 360 } : p))
    );
  };

  const duplicatePage = (idx: number) => {
    const src = pages[idx];
    if (!src) return;
    pushHistory();
    const copy: EditorPageState = { ...src, pageId: `pg-dup-${generateId()}` };
    setPages((prev) => [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)]);
    showToast('Página duplicada');
  };

  const insertBlankPageAfter = (idx: number) => {
    pushHistory();
    const blank: EditorPageState = {
      pageId: `pg-blank-${generateId()}`,
      sourcePageIndex: null,
      rotation: 0,
      blankWidthPt: 595.28,
      blankHeightPt: 841.89,
    };
    setPages((prev) => [...prev.slice(0, idx + 1), blank, ...prev.slice(idx + 1)]);
    showToast('Página en blanco insertada');
  };

  const deletePageAt = (idx: number) => {
    if (pages.length <= 1) {
      showToast('El documento debe tener al menos una página');
      return;
    }
    pushHistory();
    const removedId = pages[idx].pageId;
    setPages((prev) => prev.filter((_, i) => i !== idx));
    setAnnotations((prev) => prev.filter((a) => a.pageId !== removedId));
    setCurrentPageIdx((c) => Math.max(0, Math.min(c, pages.length - 2)));
  };

  const movePage = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= pages.length) return;
    pushHistory();
    setPages((prev) => {
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
    setCurrentPageIdx(target);
  };

  const jumpToPage = (idx: number) => {
    setCurrentPageIdx(idx);
    const p = pages[idx];
    if (p) {
      pageRefs.current.get(p.pageId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Insertar imagen o firma en la página visible actual
  const insertImageOnCurrentPage = (dataUrl: string, isSignature: boolean) => {
    const page = pages[currentPageIdx] || pages[0];
    if (!page) return;
    pushHistory();
    const id = generateId();
    const newAnn: PageAnnotation = {
      id,
      pageId: page.pageId,
      type: isSignature ? 'signature' : 'image',
      x: 0.3,
      y: isSignature ? 0.72 : 0.28,
      width: isSignature ? 0.32 : 0.38,
      height: isSignature ? 0.1 : 0.26,
      imageDataUrl: dataUrl,
      opacity: 1,
    };
    setAnnotations((prev) => [...prev, newAnn]);
    setSelectedAnnId(id);
    setToolMode('select');
    showToast(isSignature ? 'Firma colocada · Arrástrala para ubicarla' : 'Imagen insertada');
  };

  const handleImageFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      insertImageOnCurrentPage(String(reader.result || ''), false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Compilar PDF editado con pdf-lib, guardar en IndexedDB y opcionalmente descargar
  const handleSaveOrDownload = async (triggerDownload: boolean) => {
    setExporting(true);
    try {
      const bytes = await exportEditedPdf({
        sourceBuffer: doc.data,
        pages,
        annotations,
        watermark,
        pageNumbers,
        title: doc.name.replace(/\.pdf$/i, ''),
      });

      const bufferCopy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(bufferCopy).set(bytes);
      const { pageCount, thumbnail } = await generatePdfThumbnail(bufferCopy);

      const updated: LocalPdfDoc = {
        ...doc,
        data: bufferCopy,
        size: bufferCopy.byteLength,
        pageCount,
        thumbnail,
        updatedAt: Date.now(),
      };
      await saveLocalDoc(updated);
      onDocSaved(updated);
      onDirtyChange(false);

      if (triggerDownload) {
        const outName = doc.name.toLowerCase().endsWith('.pdf') ? doc.name : `${doc.name}.pdf`;
        downloadUint8Array(bytes, outName);
        showToast('PDF guardado y descargado');
      } else {
        showToast('Cambios guardados en tu dispositivo');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al exportar el PDF');
    } finally {
      setExporting(false);
    }
  };

  const fitWidth = () => {
    if (!scrollAreaRef.current) return;
    const avail = scrollAreaRef.current.clientWidth - (window.innerWidth < 640 ? 28 : 64);
    const next = Math.max(0.45, Math.min(2.2, Math.round((avail / 600) * 20) / 20));
    setScale(next);
  };

  if (loadingPdf) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Abriendo "{doc.name}" en el motor local...
        </p>
        <p className="text-xs text-slate-400">Renderizado 100% en tu navegador</p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="max-w-md rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {errorMsg}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-100/80 dark:bg-slate-950">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFileSelected}
      />

      {/* Cinta superior de pestañas contextuales estilo PDFelement */}
      <div className="shrink-0 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {/* Fila 1: Pestañas de categoría + Acciones de Guardar / Descargar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 dark:border-slate-800">
          <div className="flex items-center gap-1 overflow-x-auto">
            {(
              [
                ['edit', 'Editar'],
                ['annotate', 'Comentar y Dibujar'],
                ['pages', 'Páginas'],
                ['protect', 'Marca y Números'],
              ] as Array<[RibbonTab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setRibbonTab(id)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  ribbonTab === id
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleUndo}
              disabled={past.length === 0}
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800"
              title="Deshacer (Ctrl+Z)"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              onClick={handleRedo}
              disabled={future.length === 0}
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800"
              title="Rehacer (Ctrl+Y)"
            >
              <Redo2 className="h-4 w-4" />
            </button>

            <div className="mx-1 hidden h-5 w-px bg-slate-200 dark:bg-slate-700 sm:block" />

            <button
              onClick={() => handleSaveOrDownload(false)}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              title="Guardar cambios localmente en el navegador"
            >
              <Save className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Guardar</span>
            </button>
            <button
              onClick={() => handleSaveOrDownload(true)}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              <span>Descargar PDF</span>
            </button>
          </div>
        </div>

        {/* Fila 2: Herramientas de la categoría activa + Zoom */}
        <div className="flex items-center justify-between gap-2 overflow-x-auto px-3 py-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowThumbnails((v) => !v)}
              className={`rounded-lg p-2 text-xs transition-colors ${
                showThumbnails
                  ? 'bg-slate-100 text-blue-600 dark:bg-slate-800 dark:text-blue-400'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title="Mostrar u ocultar panel de páginas"
            >
              <PanelLeft className="h-4 w-4" />
            </button>

            <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

            {ribbonTab === 'edit' && (
              <>
                <ToolBtn
                  active={toolMode === 'select'}
                  onClick={() => setToolMode('select')}
                  icon={<MousePointer2 className="h-4 w-4" />}
                  label="Seleccionar"
                />
                <ToolBtn
                  active={toolMode === 'edit-text'}
                  onClick={() => {
                    setToolMode('edit-text');
                    showToast('Haz clic sobre cualquier texto del PDF para editarlo');
                  }}
                  icon={<FilePenLine className="h-4 w-4" />}
                  label="Editar texto"
                  highlight
                />
                <ToolBtn
                  active={toolMode === 'text'}
                  onClick={() => setToolMode('text')}
                  icon={<Type className="h-4 w-4" />}
                  label="Añadir texto"
                />
                <ToolBtn
                  active={false}
                  onClick={() => imageInputRef.current?.click()}
                  icon={<ImagePlus className="h-4 w-4" />}
                  label="Imagen"
                />
                <ToolBtn
                  active={false}
                  onClick={() => setShowSignModal(true)}
                  icon={<PenTool className="h-4 w-4" />}
                  label="Firmar"
                />
                <ToolBtn
                  active={toolMode === 'redact'}
                  onClick={() => setToolMode('redact')}
                  icon={<EyeOff className="h-4 w-4" />}
                  label="Censurar"
                />
              </>
            )}

            {ribbonTab === 'annotate' && (
              <>
                <ToolBtn
                  active={toolMode === 'select'}
                  onClick={() => setToolMode('select')}
                  icon={<MousePointer2 className="h-4 w-4" />}
                  label="Seleccionar"
                />
                <ToolBtn
                  active={toolMode === 'highlight'}
                  onClick={() => setToolMode('highlight')}
                  icon={<Highlighter className="h-4 w-4" />}
                  label="Resaltar"
                />
                <ToolBtn
                  active={toolMode === 'draw'}
                  onClick={() => setToolMode('draw')}
                  icon={<Pencil className="h-4 w-4" />}
                  label="Lápiz"
                />
                <ToolBtn
                  active={toolMode === 'rect'}
                  onClick={() => setToolMode('rect')}
                  icon={<Square className="h-4 w-4" />}
                  label="Rectángulo"
                />
                <ToolBtn
                  active={toolMode === 'ellipse'}
                  onClick={() => setToolMode('ellipse')}
                  icon={<Circle className="h-4 w-4" />}
                  label="Elipse"
                />
                <ToolBtn
                  active={toolMode === 'arrow'}
                  onClick={() => setToolMode('arrow')}
                  icon={<MoveUpRight className="h-4 w-4" />}
                  label="Flecha"
                />
                <ToolBtn
                  active={toolMode === 'line'}
                  onClick={() => setToolMode('line')}
                  icon={<Minus className="h-4 w-4" />}
                  label="Línea"
                />
                <ToolBtn
                  active={toolMode === 'note'}
                  onClick={() => setToolMode('note')}
                  icon={<StickyNote className="h-4 w-4" />}
                  label="Nota"
                />
              </>
            )}

            {ribbonTab === 'pages' && (
              <>
                <ToolBtn
                  active={false}
                  onClick={() => rotateCurrentPage(currentPageIdx)}
                  icon={<RotateCw className="h-4 w-4" />}
                  label="Rotar 90°"
                />
                <ToolBtn
                  active={false}
                  onClick={() => duplicatePage(currentPageIdx)}
                  icon={<CopyPlus className="h-4 w-4" />}
                  label="Duplicar pág."
                />
                <ToolBtn
                  active={false}
                  onClick={() => insertBlankPageAfter(currentPageIdx)}
                  icon={<FilePlus className="h-4 w-4" />}
                  label="Pág. en blanco"
                />
                <ToolBtn
                  active={false}
                  onClick={() => movePage(currentPageIdx, -1)}
                  icon={<ArrowUp className="h-4 w-4" />}
                  label="Subir"
                />
                <ToolBtn
                  active={false}
                  onClick={() => movePage(currentPageIdx, 1)}
                  icon={<ArrowDown className="h-4 w-4" />}
                  label="Bajar"
                />
                <ToolBtn
                  active={false}
                  onClick={() => deletePageAt(currentPageIdx)}
                  icon={<Trash2 className="h-4 w-4 text-rose-500" />}
                  label="Eliminar pág."
                />
              </>
            )}

            {ribbonTab === 'protect' && (
              <>
                <ToolBtn
                  active={watermark.enabled}
                  onClick={() => setShowWatermarkPanel((v) => !v)}
                  icon={<Droplets className="h-4 w-4" />}
                  label={watermark.enabled ? 'Marca de agua (Activa)' : 'Marca de agua'}
                />
                <ToolBtn
                  active={pageNumbers.enabled}
                  onClick={() => {
                    setPageNumbers((p) => ({ ...p, enabled: !p.enabled }));
                    onDirtyChange(true);
                  }}
                  icon={<Hash className="h-4 w-4" />}
                  label={pageNumbers.enabled ? 'Números de página (Activos)' : 'Numerar páginas'}
                />
              </>
            )}
          </div>

          {/* Controles de zoom */}
          <div className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800">
            <button
              onClick={() => setScale((s) => Math.max(0.4, Math.round((s - 0.15) * 100) / 100))}
              className="rounded p-1 text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700"
              title="Alejar"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={fitWidth}
              className="min-w-[44px] rounded px-1.5 py-0.5 text-center text-[11px] font-semibold text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-700"
              title="Ajustar al ancho"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              onClick={() => setScale((s) => Math.min(2.6, Math.round((s + 0.15) * 100) / 100))}
              className="rounded p-1 text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-700"
              title="Acercar"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Sub-barra de propiedades contextuales (color, fuente, tamaño, grosor) */}
        {(selectedAnn ||
          toolMode === 'text' ||
          toolMode === 'draw' ||
          toolMode === 'rect' ||
          toolMode === 'ellipse' ||
          toolMode === 'line' ||
          toolMode === 'arrow') && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-slate-50/90 px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900/70">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-slate-500">Color:</span>
              {['#111827', '#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED'].map((c) => {
                const curColor = selectedAnn
                  ? selectedAnn.type === 'text' || selectedAnn.type === 'edit-text' || selectedAnn.type === 'note' || selectedAnn.type === 'highlight'
                    ? selectedAnn.color
                    : selectedAnn.strokeColor
                  : activeColor;
                return (
                  <button
                    key={c}
                    onClick={() => {
                      setActiveColor(c);
                      if (selectedAnn) {
                        if (
                          selectedAnn.type === 'text' ||
                          selectedAnn.type === 'edit-text' ||
                          selectedAnn.type === 'note' ||
                          selectedAnn.type === 'highlight'
                        ) {
                          handleUpdateAnnotation(selectedAnn.id, { color: c });
                        } else {
                          handleUpdateAnnotation(selectedAnn.id, { strokeColor: c });
                        }
                      }
                    }}
                    className={`h-5 w-5 rounded-full border-2 ${
                      curColor === c ? 'border-blue-500 scale-110' : 'border-white dark:border-slate-700'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                );
              })}
            </div>

            {(toolMode === 'text' ||
              selectedAnn?.type === 'text' ||
              selectedAnn?.type === 'edit-text' ||
              selectedAnn?.type === 'note') && (
              <>
                <select
                  value={selectedAnn?.fontFamily ?? activeFontFamily}
                  onChange={(e) => {
                    const f = e.target.value as FontFamilyKey;
                    setActiveFontFamily(f);
                    if (selectedAnn) handleUpdateAnnotation(selectedAnn.id, { fontFamily: f });
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="Helvetica">Helvetica (Sans)</option>
                  <option value="Times">Times (Serif)</option>
                  <option value="Courier">Courier (Mono)</option>
                </select>

                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-slate-500">Tam:</span>
                  <input
                    type="number"
                    min={7}
                    max={72}
                    value={selectedAnn?.fontSize ?? activeFontSize}
                    onChange={(e) => {
                      const v = Math.max(7, Math.min(72, Number(e.target.value) || 12));
                      setActiveFontSize(v);
                      if (selectedAnn) handleUpdateAnnotation(selectedAnn.id, { fontSize: v });
                    }}
                    className="w-14 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>

                {selectedAnn && (
                  <>
                    <button
                      onClick={() => handleUpdateAnnotation(selectedAnn.id, { bold: !selectedAnn.bold })}
                      className={`rounded p-1 ${
                        selectedAnn.bold
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300'
                          : 'text-slate-600 hover:bg-slate-200/70'
                      }`}
                      title="Negrita"
                    >
                      <Bold className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleUpdateAnnotation(selectedAnn.id, { italic: !selectedAnn.italic })}
                      className={`rounded p-1 ${
                        selectedAnn.italic
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300'
                          : 'text-slate-600 hover:bg-slate-200/70'
                      }`}
                      title="Cursiva"
                    >
                      <Italic className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </>
            )}

            {(toolMode === 'draw' ||
              toolMode === 'rect' ||
              toolMode === 'ellipse' ||
              toolMode === 'line' ||
              toolMode === 'arrow') && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-500">Grosor:</span>
                <input
                  type="range"
                  min={1}
                  max={8}
                  step={0.5}
                  value={activeStrokeWidth}
                  onChange={(e) => setActiveStrokeWidth(Number(e.target.value))}
                  className="w-20 accent-blue-600"
                />
                <span className="text-[11px] font-semibold text-slate-600">{activeStrokeWidth}pt</span>
              </div>
            )}
          </div>
        )}

        {/* Panel desplegable de Marca de agua */}
        {showWatermarkPanel && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-blue-50/50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-blue-950/30">
            <label className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={watermark.enabled}
                onChange={(e) => {
                  setWatermark((w) => ({ ...w, enabled: e.target.checked }));
                  onDirtyChange(true);
                }}
                className="accent-blue-600"
              />
              Activar marca de agua
            </label>
            <input
              type="text"
              value={watermark.text}
              onChange={(e) => {
                setWatermark((w) => ({ ...w, text: e.target.value, enabled: true }));
                onDirtyChange(true);
              }}
              placeholder="Texto de marca de agua..."
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
            />
            <label className="flex items-center gap-1.5">
              <span>Opacidad</span>
              <input
                type="range"
                min={0.08}
                max={0.6}
                step={0.04}
                value={watermark.opacity}
                onChange={(e) => setWatermark((w) => ({ ...w, opacity: Number(e.target.value) }))}
                className="w-20 accent-blue-600"
              />
            </label>
            <button
              onClick={() => setShowWatermarkPanel(false)}
              className="ml-auto rounded-lg px-2 py-1 font-semibold text-blue-600 hover:bg-blue-100/70"
            >
              Listo
            </button>
          </div>
        )}
      </div>

      {/* Cuerpo principal: Panel miniaturas + Lienzo virtualizado */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {showThumbnails && (
          <aside className="flex w-44 sm:w-52 shrink-0 flex-col border-r border-slate-200 bg-white/95 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-800 dark:text-slate-200">
              <span>Páginas ({pages.length})</span>
              <button
                onClick={() => insertBlankPageAfter(pages.length - 1)}
                className="rounded-md p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/60"
                title="Añadir página en blanco al final"
              >
                <FilePlus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
              {pages.map((p, idx) => {
                const isCurrent = idx === currentPageIdx;
                const annCount = annotations.filter((a) => a.pageId === p.pageId).length;
                return (
                  <div
                    key={p.pageId}
                    onClick={() => jumpToPage(idx)}
                    className={`group cursor-pointer rounded-xl border p-2 transition-all ${
                      isCurrent
                        ? 'border-blue-500 bg-blue-50/70 shadow-xs dark:bg-blue-950/40'
                        : 'border-slate-200 bg-slate-50/60 hover:border-blue-300 dark:border-slate-800 dark:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                      <span>Pág. {idx + 1}</span>
                      {annCount > 0 && (
                        <span className="rounded-full bg-blue-600 px-1.5 py-0.2 text-[10px] text-white">
                          {annCount}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {p.sourcePageIndex === null
                        ? 'En blanco'
                        : `Original #${p.sourcePageIndex + 1}`}
                      {p.rotation ? ` · ${p.rotation}°` : ''}
                    </p>
                    <div
                      className="mt-2 flex items-center justify-between gap-0.5 border-t border-slate-200/70 pt-1.5 dark:border-slate-700/70"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => movePage(idx, -1)}
                        disabled={idx === 0}
                        className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30"
                        title="Subir"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => movePage(idx, 1)}
                        disabled={idx === pages.length - 1}
                        className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30"
                        title="Bajar"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => rotateCurrentPage(idx)}
                        className="rounded p-1 text-slate-400 hover:bg-white hover:text-blue-600"
                        title="Rotar 90°"
                      >
                        <RotateCw className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => duplicatePage(idx)}
                        className="rounded p-1 text-slate-400 hover:bg-white hover:text-blue-600"
                        title="Duplicar"
                      >
                        <CopyPlus className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => deletePageAt(idx)}
                        className="rounded p-1 text-slate-400 hover:bg-white hover:text-rose-600"
                        title="Eliminar"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        {/* Área de lienzo de páginas */}
        <div ref={scrollAreaRef} className="relative flex-1 overflow-auto p-4 sm:p-6">
          <div className="mx-auto flex flex-col items-center gap-6 pb-16">
            {pages.map((p, idx) => (
              <div
                key={p.pageId}
                ref={(el) => {
                  if (el) pageRefs.current.set(p.pageId, el);
                  else pageRefs.current.delete(p.pageId);
                }}
              >
                <PageCanvas
                  pdfDoc={pdfProxy}
                  pageState={p}
                  pageIndex={idx}
                  totalPages={pages.length}
                  scale={scale}
                  toolMode={toolMode}
                  activeColor={activeColor}
                  activeStrokeWidth={activeStrokeWidth}
                  activeFontSize={activeFontSize}
                  activeFontFamily={activeFontFamily}
                  annotations={annotations.filter((a) => a.pageId === p.pageId)}
                  selectedAnnotationId={selectedAnnId}
                  watermark={watermark}
                  pageNumbers={pageNumbers}
                  onSelectAnnotation={setSelectedAnnId}
                  onAddAnnotation={handleAddAnnotation}
                  onUpdateAnnotation={handleUpdateAnnotation}
                  onDeleteAnnotation={handleDeleteAnnotation}
                  onDuplicateAnnotation={handleDuplicateAnnotation}
                  onVisible={setCurrentPageIdx}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modal de firma */}
      {showSignModal && (
        <SignatureModal
          onClose={() => setShowSignModal(false)}
          onSelectSignature={(dataUrl) => {
            setShowSignModal(false);
            insertImageOnCurrentPage(dataUrl, true);
          }}
        />
      )}

      {/* Toast discreto */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xl dark:bg-blue-600">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 dark:text-white" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
};

const ToolBtn: React.FC<{
  active: boolean;
  highlight?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}> = ({ active, highlight, icon, label, onClick }) => (
  <button
    onClick={onClick}
    className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition-all ${
      active
        ? 'bg-blue-600 text-white shadow-xs'
        : highlight
          ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
    }`}
  >
    {icon}
    <span className="whitespace-nowrap">{label}</span>
  </button>
);
