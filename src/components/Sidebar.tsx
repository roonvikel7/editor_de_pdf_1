import React from 'react';
import {
  Clock,
  Star,
  LayoutGrid,
  HardDrive,
  FolderOpen,
  FilePlus2,
  Trash2,
  X,
} from 'lucide-react';
import type { AppTool, SidebarFilter } from '../types/pdf';
import { formatBytes } from '../lib/storage';

interface SidebarProps {
  activeTool: AppTool;
  filter: SidebarFilter;
  docsCount: number;
  starredCount: number;
  storageDocsBytes: number;
  storageQuotaBytes: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onSelectFilter: (f: SidebarFilter) => void;
  onOpenPdf: () => void;
  onCreatePdf: () => void;
  onClearLocalCache: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTool,
  filter,
  docsCount,
  starredCount,
  storageDocsBytes,
  storageQuotaBytes,
  mobileOpen,
  onCloseMobile,
  onSelectFilter,
  onOpenPdf,
  onCreatePdf,
  onClearLocalCache,
}) => {
  const usagePct = Math.min(100, Math.round((storageDocsBytes / Math.max(1, storageQuotaBytes)) * 100));

  const navItems: Array<{
    id: SidebarFilter;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    {
      id: 'recent',
      label: 'Archivos Recientes',
      icon: <Clock className="h-4 w-4" />,
      badge: docsCount,
    },
    {
      id: 'starred',
      label: 'Archivos Destacados',
      icon: <Star className="h-4 w-4" />,
      badge: starredCount,
    },
    {
      id: 'tools',
      label: 'Centro de Herramientas',
      icon: <LayoutGrid className="h-4 w-4" />,
    },
  ];

  const content = (
    <aside className="flex h-full w-64 flex-col justify-between border-r border-slate-200/90 bg-white/95 p-3.5 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <div className="mb-3 flex items-center justify-between lg:hidden">
          <span className="text-sm font-bold text-slate-800 dark:text-slate-100">PDFStudio</span>
          <button
            onClick={onCloseMobile}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = activeTool === 'home' && filter === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onSelectFilter(item.id);
                  onCloseMobile();
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                    : 'text-slate-600 hover:bg-slate-100/90 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <span className={isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </span>
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      isActive
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/70 dark:text-blue-200'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Parte inferior inspirada en PDFelement: Almacenamiento local (sin nube) + Abrir / Crear PDF */}
      <div className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
            <span className="flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              Almacenamiento local
            </span>
            {storageDocsBytes > 0 && (
              <button
                onClick={onClearLocalCache}
                className="rounded p-1 text-slate-400 hover:bg-slate-200/70 hover:text-rose-600 dark:hover:bg-slate-700"
                title="Vaciar documentos guardados localmente"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {formatBytes(storageDocsBytes)} guardados en tu dispositivo
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300"
              style={{ width: `${Math.max(storageDocsBytes > 0 ? 4 : 0, usagePct)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[10px] leading-tight text-slate-400 dark:text-slate-500">
            Tus PDFs nunca salen del navegador. Cero uso de datos en servidor.
          </p>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => {
              onOpenPdf();
              onCloseMobile();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700 active:scale-[0.99] transition-all"
          >
            <FolderOpen className="h-4 w-4" />
            Abrir PDF
          </button>
          <button
            onClick={() => {
              onCreatePdf();
              onCloseMobile();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 active:scale-[0.99] transition-all dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <FilePlus2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            Crear PDF
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Escritorio */}
      <div className="hidden lg:block lg:shrink-0">{content}</div>

      {/* Móvil / Tablet Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <div className="relative z-50 h-full">{content}</div>
        </div>
      )}
    </>
  );
};
