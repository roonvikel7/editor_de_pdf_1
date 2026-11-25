import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { AppTool, LocalPdfDoc, LocalPdfMeta, OpenTab, SidebarFilter } from './types/pdf';
import {
  clearAllLocalDocs,
  deleteLocalDoc,
  downloadUint8Array,
  generateId,
  getLocalDoc,
  getLocalStorageUsage,
  listLocalDocsMeta,
  saveLocalDoc,
  toggleStarDoc,
} from './lib/storage';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { HomeView } from './components/HomeView';

// Carga diferida de cada módulo (equivalente a cargar DLLs bajo demanda en PDFelement)
const EditorView = lazy(() =>
  import('./components/editor/EditorView').then((m) => ({ default: m.EditorView }))
);
const ConvertTool = lazy(() =>
  import('./components/tools/ConvertTool').then((m) => ({ default: m.ConvertTool }))
);
const OcrTool = lazy(() =>
  import('./components/tools/OcrTool').then((m) => ({ default: m.OcrTool }))
);
const OrganizeTool = lazy(() =>
  import('./components/tools/OrganizeTool').then((m) => ({ default: m.OrganizeTool }))
);
const CompressTool = lazy(() =>
  import('./components/tools/CompressTool').then((m) => ({ default: m.CompressTool }))
);
const BatchTool = lazy(() =>
  import('./components/tools/BatchTool').then((m) => ({ default: m.BatchTool }))
);
const CreatePdfTool = lazy(() =>
  import('./components/tools/CreatePdfTool').then((m) => ({ default: m.CreatePdfTool }))
);

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function App() {
  const [activeTool, setActiveTool] = useState<AppTool>('home');
  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>('recent');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [docsMeta, setDocsMeta] = useState<LocalPdfMeta[]>([]);
  const [storageStats, setStorageStats] = useState({ docsBytes: 0, quotaBytes: 500 * 1024 * 1024 });

  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<LocalPdfDoc | null>(null);

  const [importing, setImporting] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('pdfstudio-theme');
    if (saved) return saved === 'dark';
    return false; // Claro por defecto (estilo limpio PDFelement)
  });

  const hiddenFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('pdfstudio-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    const onInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
    };
  }, []);

  const refreshLibrary = useCallback(async () => {
    try {
      const [meta, stats] = await Promise.all([listLocalDocsMeta(), getLocalStorageUsage()]);
      setDocsMeta(meta);
      setStorageStats({ docsBytes: stats.docsBytes, quotaBytes: stats.quotaBytes });
    } catch {
      // IndexedDB no disponible en algún modo privado extremo
    }
  }, []);

  useEffect(() => {
    refreshLibrary();
  }, [refreshLibrary]);

  const openDocumentById = useCallback(async (docId: string) => {
    const doc = await getLocalDoc(docId);
    if (!doc) return;
    setActiveDoc(doc);
    setActiveTabId(doc.id);
    setOpenTabs((prev) =>
      prev.some((t) => t.docId === doc.id) ? prev : [...prev, { docId: doc.id, name: doc.name }]
    );
    setActiveTool('editor');
  }, []);

  const saveNewPdfBytesAndOpen = useCallback(
    async (name: string, bytes: Uint8Array) => {
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const { generatePdfThumbnail } = await import('./lib/pdfCore');
      const { pageCount, thumbnail } = await generatePdfThumbnail(buffer);
      const now = Date.now();
      const doc: LocalPdfDoc = {
        id: generateId(),
        name: name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`,
        size: buffer.byteLength,
        pageCount,
        thumbnail,
        starred: false,
        createdAt: now,
        updatedAt: now,
        data: buffer,
      };
      await saveLocalDoc(doc);
      await refreshLibrary();
      setActiveDoc(doc);
      setActiveTabId(doc.id);
      setOpenTabs((prev) => [...prev, { docId: doc.id, name: doc.name }]);
      setActiveTool('editor');
    },
    [refreshLibrary]
  );

  // Importa PDFs directamente, o convierte imágenes/DOCX/TXT/HTML a PDF al vuelo para abrirlos en el editor
  const handleImportFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setImporting(true);
      try {
        const allImages = files.every((f) => f.type.startsWith('image/'));
        if (allImages) {
          const { convertImagesToPdf } = await import('./lib/pdfConvertEngine');
          const bytes = await convertImagesToPdf(files, { pageSize: 'a4', marginPt: 20 });
          const name =
            files.length === 1
              ? `${files[0].name.replace(/\.[^.]+$/, '')}.pdf`
              : `imagenes_${files.length}.pdf`;
          await saveNewPdfBytesAndOpen(name, bytes);
          return;
        }

        let lastDoc: LocalPdfDoc | null = null;
        for (const f of files) {
          const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
          let buffer: ArrayBuffer;
          let finalName = f.name;

          if (isPdf) {
            buffer = await f.arrayBuffer();
          } else {
            const { convertDocumentToPdf } = await import('./lib/pdfConvertEngine');
            const bytes = await convertDocumentToPdf(f);
            buffer = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(buffer).set(bytes);
            finalName = `${f.name.replace(/\.[^.]+$/, '')}.pdf`;
          }

          const { generatePdfThumbnail } = await import('./lib/pdfCore');
          const { pageCount, thumbnail } = await generatePdfThumbnail(buffer);
          const now = Date.now();
          const doc: LocalPdfDoc = {
            id: generateId(),
            name: finalName,
            size: buffer.byteLength,
            pageCount,
            thumbnail,
            starred: false,
            createdAt: now,
            updatedAt: now,
            data: buffer,
          };
          await saveLocalDoc(doc);
          lastDoc = doc;
        }

        await refreshLibrary();
        if (lastDoc) {
          setActiveDoc(lastDoc);
          setActiveTabId(lastDoc.id);
          setOpenTabs((prev) =>
            prev.some((t) => t.docId === lastDoc!.id)
              ? prev
              : [...prev, { docId: lastDoc!.id, name: lastDoc!.name }]
          );
          setActiveTool('editor');
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : 'No se pudo importar el archivo.');
      } finally {
        setImporting(false);
      }
    },
    [refreshLibrary, saveNewPdfBytesAndOpen]
  );

  const handleSelectTool = (tool: AppTool) => {
    if (tool === 'editor') {
      if (activeDoc) {
        setActiveTool('editor');
      } else if (docsMeta.length > 0) {
        openDocumentById(docsMeta[0].id);
      } else {
        hiddenFileInputRef.current?.click();
      }
      return;
    }
    setActiveTool(tool);
  };

  const handleCloseTab = (docId: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.docId !== docId);
      if (activeTabId === docId) {
        if (next.length > 0) {
          openDocumentById(next[next.length - 1].docId);
        } else {
          setActiveTabId(null);
          setActiveDoc(null);
          setActiveTool('home');
        }
      }
      return next;
    });
  };

  const handleDeleteDoc = async (docId: string) => {
    await deleteLocalDoc(docId);
    handleCloseTab(docId);
    await refreshLibrary();
  };

  const handleClearLocal = async () => {
    if (!confirm('¿Vaciar todos los PDFs guardados en el historial local del navegador?')) return;
    await clearAllLocalDocs();
    setOpenTabs([]);
    setActiveTabId(null);
    setActiveDoc(null);
    setActiveTool('home');
    await refreshLibrary();
  };

  const handleInstallPwa = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    setDeferredPrompt(null);
  };

  const starredCount = docsMeta.filter((d) => d.starred).length;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#F6F8FC] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <input
        ref={hiddenFileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.txt,.md,.html"
        multiple
        className="hidden"
        onChange={(e) => {
          const list = Array.from(e.target.files || []);
          if (list.length > 0) handleImportFiles(list);
          e.target.value = '';
        }}
      />

      <TopBar
        activeTool={activeTool}
        activeTabId={activeTabId}
        openTabs={openTabs}
        darkMode={darkMode}
        isOffline={isOffline}
        canInstallPwa={Boolean(deferredPrompt)}
        onSelectHome={() => setActiveTool('home')}
        onSelectTab={openDocumentById}
        onCloseTab={handleCloseTab}
        onOpenNewFile={() => hiddenFileInputRef.current?.click()}
        onToggleDark={() => setDarkMode((d) => !d)}
        onToggleMobileMenu={() => setMobileMenuOpen((v) => !v)}
        onInstallPwa={handleInstallPwa}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar visible siempre en Inicio y herramientas (se oculta en el Editor para máximo lienzo) */}
        {activeTool !== 'editor' && (
          <Sidebar
            activeTool={activeTool}
            filter={sidebarFilter}
            docsCount={docsMeta.length}
            starredCount={starredCount}
            storageDocsBytes={storageStats.docsBytes}
            storageQuotaBytes={storageStats.quotaBytes}
            mobileOpen={mobileMenuOpen}
            onCloseMobile={() => setMobileMenuOpen(false)}
            onSelectFilter={(f) => {
              setSidebarFilter(f);
              setActiveTool('home');
            }}
            onOpenPdf={() => hiddenFileInputRef.current?.click()}
            onCreatePdf={() => setActiveTool('create')}
            onClearLocalCache={handleClearLocal}
          />
        )}

        <main className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
          {importing && (
            <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-slate-900/40 backdrop-blur-xs">
              <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 shadow-xl dark:bg-slate-900">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Preparando documento localmente...
                </span>
              </div>
            </div>
          )}

          {activeTool === 'home' && (
            <HomeView
              docs={docsMeta}
              filter={sidebarFilter}
              onSelectTool={handleSelectTool}
              onImportFiles={handleImportFiles}
              onOpenDoc={openDocumentById}
              onToggleStar={async (id) => {
                await toggleStarDoc(id);
                await refreshLibrary();
              }}
              onDeleteDoc={handleDeleteDoc}
              onDownloadDoc={async (id) => {
                const doc = await getLocalDoc(id);
                if (doc) downloadUint8Array(new Uint8Array(doc.data), doc.name);
              }}
            />
          )}

          {activeTool !== 'home' && (
            <Suspense
              fallback={
                <div className="flex flex-1 flex-col items-center justify-center gap-2.5 p-8">
                  <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
                  <p className="text-xs font-semibold text-slate-500">
                    Cargando módulo bajo demanda...
                  </p>
                </div>
              }
            >
              {activeTool === 'editor' && activeDoc && (
                <EditorView
                  doc={activeDoc}
                  onDocSaved={(updated) => {
                    setActiveDoc(updated);
                    refreshLibrary();
                  }}
                  onDirtyChange={(dirty) => {
                    setOpenTabs((prev) =>
                      prev.map((t) => (t.docId === activeDoc.id ? { ...t, dirty } : t))
                    );
                  }}
                />
              )}
              {activeTool === 'convert' && (
                <ConvertTool
                  recentDocs={docsMeta}
                  onSaveNewPdfAndOpen={saveNewPdfBytesAndOpen}
                />
              )}
              {activeTool === 'ocr' && (
                <OcrTool
                  recentDocs={docsMeta}
                  onSaveNewPdfAndOpen={saveNewPdfBytesAndOpen}
                />
              )}
              {activeTool === 'organize' && (
                <OrganizeTool
                  recentDocs={docsMeta}
                  onSaveNewPdfAndOpen={saveNewPdfBytesAndOpen}
                />
              )}
              {activeTool === 'compress' && (
                <CompressTool
                  recentDocs={docsMeta}
                  onSaveNewPdfAndOpen={saveNewPdfBytesAndOpen}
                />
              )}
              {activeTool === 'batch' && <BatchTool />}
              {activeTool === 'create' && (
                <CreatePdfTool onCreated={saveNewPdfBytesAndOpen} />
              )}
            </Suspense>
          )}
        </main>
      </div>
    </div>
  );
}
