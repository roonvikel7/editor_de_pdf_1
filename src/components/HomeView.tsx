import React, { useMemo, useState } from 'react';
import {
  FileEdit,
  ArrowLeftRight,
  ScanText,
  Layers,
  Minimize2,
  Blocks,
  Search,
  LayoutGrid,
  List,
  Star,
  Trash2,
  Download,
  FileText,
  Sparkles,
  FilePlus2,
} from 'lucide-react';
import type { AppTool, LocalPdfMeta, SidebarFilter } from '../types/pdf';
import { formatBytes, formatRelativeDate } from '../lib/storage';
import { FileDropzone } from './FileDropzone';

interface HomeViewProps {
  docs: LocalPdfMeta[];
  filter: SidebarFilter;
  onSelectTool: (tool: AppTool) => void;
  onImportFiles: (files: File[]) => void;
  onOpenDoc: (docId: string) => void;
  onToggleStar: (docId: string) => void;
  onDeleteDoc: (docId: string) => void;
  onDownloadDoc: (docId: string) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  docs,
  filter,
  onSelectTool,
  onImportFiles,
  onOpenDoc,
  onToggleStar,
  onDeleteDoc,
  onDownloadDoc,
}) => {
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  const quickTools: Array<{
    id: AppTool;
    title: string;
    desc: string;
    icon: React.ReactNode;
    accent: string;
  }> = [
    {
      id: 'editor',
      title: 'Editar',
      desc: 'Edita textos, imágenes, firmas y anotaciones en el PDF.',
      icon: <FileEdit className="h-5 w-5" />,
      accent: 'bg-blue-50 text-blue-600 dark:bg-blue-950/70 dark:text-blue-400',
    },
    {
      id: 'convert',
      title: 'Convertir',
      desc: 'PDF a Word, Excel, PPT, Imágenes y viceversa.',
      icon: <ArrowLeftRight className="h-5 w-5" />,
      accent: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/70 dark:text-indigo-400',
    },
    {
      id: 'ocr',
      title: 'OCR',
      desc: 'Convierte escaneos en texto editable o PDF buscable.',
      icon: <ScanText className="h-5 w-5" />,
      accent: 'bg-sky-50 text-sky-600 dark:bg-sky-950/70 dark:text-sky-400',
    },
    {
      id: 'organize',
      title: 'Combinar y Dividir',
      desc: 'Une varios PDFs, extrae rangos o separa páginas.',
      icon: <Layers className="h-5 w-5" />,
      accent: 'bg-violet-50 text-violet-600 dark:bg-violet-950/70 dark:text-violet-400',
    },
    {
      id: 'compress',
      title: 'Comprimir',
      desc: 'Reduce el tamaño del archivo PDF con control de calidad.',
      icon: <Minimize2 className="h-5 w-5" />,
      accent: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-400',
    },
    {
      id: 'batch',
      title: 'Proceso por lotes',
      desc: 'Comprime, convierte o marca múltiples PDFs a la vez.',
      icon: <Blocks className="h-5 w-5" />,
      accent: 'bg-amber-50 text-amber-600 dark:bg-amber-950/70 dark:text-amber-400',
    },
  ];

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (filter === 'starred' && !d.starred) return false;
      if (q && !d.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [docs, filter, search]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 space-y-8">
      {/* Encabezado Herramientas Rápidas */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Herramientas Rápidas
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Cada motor se carga bajo demanda en tu navegador · Rápido en PC y móvil
            </p>
          </div>
          <button
            onClick={() => onSelectTool('create')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-600 transition-colors dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            Crear PDF desde cero
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {quickTools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => onSelectTool(tool.id)}
              className="group flex items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-xs transition-all duration-150 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md hover:shadow-blue-500/5 active:translate-y-0 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-700/80"
            >
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold text-slate-900 group-hover:text-blue-600 dark:text-slate-100 dark:group-hover:text-blue-400 transition-colors">
                  {tool.title}
                </h2>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {tool.desc}
                </p>
              </div>
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-150 group-hover:scale-105 ${tool.accent}`}
              >
                {tool.icon}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Sección Archivos Recientes / Destacados */}
      {filter !== 'tools' && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              {filter === 'starred' ? 'Archivos Destacados' : 'Archivos Recientes'}
            </h2>

            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar documento..."
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center rounded-xl border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
                <button
                  onClick={() => setViewMode('list')}
                  className={`rounded-lg p-1.5 ${
                    viewMode === 'list'
                      ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/70 dark:text-blue-400'
                      : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                  title="Vista lista"
                >
                  <List className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`rounded-lg p-1.5 ${
                    viewMode === 'grid'
                      ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/70 dark:text-blue-400'
                      : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                  title="Vista cuadrícula"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {filteredDocs.length === 0 ? (
            <FileDropzone
              accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.txt,.md,.html"
              multiple
              title={
                filter === 'starred'
                  ? 'No tienes archivos destacados todavía'
                  : 'No hay archivos recientes — Pulsa o arrastra tus archivos aquí'
              }
              subtitle="Soporta PDF, imágenes (JPG/PNG/WebP), Word (.docx), TXT y HTML · Privado y 100% offline"
              onFiles={onImportFiles}
            />
          ) : (
            <>
              {viewMode === 'list' ? (
                <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredDocs.map((doc) => (
                      <div
                        key={doc.id}
                        onClick={() => onOpenDoc(doc.id)}
                        className="group flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-blue-50/40 dark:hover:bg-slate-800/70"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3.5">
                          <div className="flex h-12 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                            {doc.thumbnail ? (
                              <img
                                src={doc.thumbnail}
                                alt={doc.name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <FileText className="h-5 w-5 text-blue-500" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-800 group-hover:text-blue-600 dark:text-slate-100 dark:group-hover:text-blue-400">
                              {doc.name}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                              {doc.pageCount} {doc.pageCount === 1 ? 'página' : 'páginas'} ·{' '}
                              {formatBytes(doc.size)} · {formatRelativeDate(doc.updatedAt)}
                            </p>
                          </div>
                        </div>

                        <div
                          className="flex shrink-0 items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => onToggleStar(doc.id)}
                            className={`rounded-lg p-2 transition-colors ${
                              doc.starred
                                ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                                : 'text-slate-400 hover:bg-slate-100 hover:text-amber-500 dark:hover:bg-slate-800'
                            }`}
                            title={doc.starred ? 'Quitar destacado' : 'Destacar'}
                          >
                            <Star className={`h-4 w-4 ${doc.starred ? 'fill-amber-400' : ''}`} />
                          </button>
                          <button
                            onClick={() => onDownloadDoc(doc.id)}
                            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800"
                            title="Descargar PDF"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => onDeleteDoc(doc.id)}
                            className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                            title="Eliminar del historial local"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4">
                  {filteredDocs.map((doc) => (
                    <div
                      key={doc.id}
                      onClick={() => onOpenDoc(doc.id)}
                      className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-800">
                        {doc.thumbnail ? (
                          <img
                            src={doc.thumbnail}
                            alt={doc.name}
                            className="h-full w-full object-contain p-2 transition-transform duration-200 group-hover:scale-[1.03]"
                          />
                        ) : (
                          <FileText className="h-10 w-10 text-blue-500/70" />
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleStar(doc.id);
                          }}
                          className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 shadow-xs backdrop-blur hover:bg-white dark:bg-slate-900/90"
                        >
                          <Star
                            className={`h-3.5 w-3.5 ${
                              doc.starred ? 'fill-amber-400 text-amber-500' : 'text-slate-400'
                            }`}
                          />
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2 p-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                            {doc.name}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {doc.pageCount} págs · {formatBytes(doc.size)}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteDoc(doc.id);
                          }}
                          className="rounded-lg p-1 text-slate-400 hover:text-rose-600"
                          title="Eliminar"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <FileDropzone
                compact
                accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.txt,.md,.html"
                multiple
                title="Arrastra más archivos para abrir o convertir a PDF al instante"
                subtitle="PDF · JPG · PNG · WebP · Word (.docx) · TXT · HTML"
                onFiles={onImportFiles}
              />
            </>
          )}
        </section>
      )}

      {/* Banner informativo Zero-Vercel */}
      <section className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50/90 via-white to-indigo-50/70 p-4 sm:p-5 dark:border-blue-900/40 dark:from-blue-950/30 dark:via-slate-900 dark:to-indigo-950/30">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Arquitectura modular inspirada en PDFelement — 0% consumo de servidor
              </h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Cada herramienta carga su propio motor en tu navegador solo cuando la usas. Tus documentos se quedan en tu dispositivo con privacidad absoluta y funcionamiento offline.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
