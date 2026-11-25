import React from 'react';
import {
  Plus,
  X,
  Moon,
  Sun,
  Menu,
  ShieldCheck,
  WifiOff,
  Download,
  FileText,
  Home,
} from 'lucide-react';
import type { AppTool, OpenTab } from '../types/pdf';

interface TopBarProps {
  activeTool: AppTool;
  activeTabId: string | null;
  openTabs: OpenTab[];
  darkMode: boolean;
  isOffline: boolean;
  canInstallPwa: boolean;
  onSelectHome: () => void;
  onSelectTab: (docId: string) => void;
  onCloseTab: (docId: string) => void;
  onOpenNewFile: () => void;
  onToggleDark: () => void;
  onToggleMobileMenu: () => void;
  onInstallPwa: () => void;
}

const TOOL_LABELS: Partial<Record<AppTool, string>> = {
  convert: 'Convertir',
  ocr: 'OCR',
  organize: 'Combinar / Dividir',
  compress: 'Comprimir',
  batch: 'Proceso por lotes',
  create: 'Crear PDF',
};

export const TopBar: React.FC<TopBarProps> = ({
  activeTool,
  activeTabId,
  openTabs,
  darkMode,
  isOffline,
  canInstallPwa,
  onSelectHome,
  onSelectTab,
  onCloseTab,
  onOpenNewFile,
  onToggleDark,
  onToggleMobileMenu,
  onInstallPwa,
}) => {
  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-slate-200/90 bg-white/95 px-2 sm:px-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      {/* Izquierda: menú móvil + logo + pestañas estilo PDFelement */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar">
        <button
          onClick={onToggleMobileMenu}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
          title="Menú"
          aria-label="Abrir menú"
        >
          <Menu className="h-4 w-4" />
        </button>

        {/* Logo Inicio */}
        <button
          onClick={onSelectHome}
          className={`flex h-8 shrink-0 items-center gap-2 rounded-lg px-2 transition-colors ${
            activeTool === 'home'
              ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
          }`}
          title="Inicio — PDFStudio"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-sm">
            <Home className="h-3.5 w-3.5" />
          </span>
          <span className="hidden text-sm font-bold tracking-tight sm:inline">PDFStudio</span>
        </button>

        {/* Pestaña de herramienta activa (si no es home ni editor) */}
        {activeTool !== 'home' && activeTool !== 'editor' && (
          <div className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50/70 px-2.5 text-xs font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
            <span>{TOOL_LABELS[activeTool] ?? activeTool}</span>
            <button
              onClick={onSelectHome}
              className="rounded p-0.5 hover:bg-blue-200/60 dark:hover:bg-blue-900"
              aria-label="Volver al inicio"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Pestañas de documentos abiertos */}
        {openTabs.map((tab) => {
          const isActive = activeTool === 'editor' && activeTabId === tab.docId;
          return (
            <div
              key={tab.docId}
              onClick={() => onSelectTab(tab.docId)}
              role="tab"
              aria-selected={isActive}
              className={`group flex h-8 max-w-[190px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-blue-200 bg-blue-50/90 text-blue-700 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                  : 'border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-blue-500" />
              <span className="truncate">{tab.name}</span>
              {tab.dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Cambios sin exportar" />}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.docId);
                }}
                className="ml-0.5 rounded p-0.5 opacity-60 hover:bg-slate-200/80 hover:opacity-100 dark:hover:bg-slate-700"
                title="Cerrar pestaña"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}

        {/* Botón + para abrir nuevo archivo */}
        <button
          onClick={onOpenNewFile}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          title="Abrir PDF"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Derecha: estado Local Zero-Server + Instalar PWA + Modo oscuro */}
      <div className="flex shrink-0 items-center gap-1.5">
        {isOffline ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
            title="Trabajando 100% sin conexión"
          >
            <WifiOff className="h-3 w-3" />
            <span className="hidden sm:inline">Modo Offline</span>
          </span>
        ) : (
          <span
            className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50/90 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300"
            title="Tus archivos jamás se suben a servidores ni consumen datos de Vercel"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>100% Local · 0 MB servidor</span>
          </span>
        )}

        {canInstallPwa && (
          <button
            onClick={onInstallPwa}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
            title="Instalar PDFStudio en tu dispositivo para uso offline instantáneo"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Instalar App</span>
          </button>
        )}

        <button
          onClick={onToggleDark}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          title={darkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          aria-label="Cambiar tema"
        >
          {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
};
