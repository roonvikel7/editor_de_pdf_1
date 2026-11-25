import React, { useState } from 'react';
import {
  Layers,
  Scissors,
  ArrowUp,
  ArrowDown,
  Trash2,
  Loader2,
  Download,
  FolderOpen,
  CheckCircle2,
} from 'lucide-react';
import type { LocalPdfMeta, ProgressInfo } from '../../types/pdf';
import { mergePdfs, splitPdf } from '../../lib/pdfToolsEngine';
import { downloadBlob, downloadUint8Array, formatBytes, getLocalDoc } from '../../lib/storage';
import { FileDropzone } from '../FileDropzone';

interface OrganizeToolProps {
  recentDocs: LocalPdfMeta[];
  onSaveNewPdfAndOpen: (name: string, bytes: Uint8Array) => Promise<void>;
}

interface MergeItem {
  id: string;
  name: string;
  size: number;
  buffer: ArrayBuffer;
  pageRange: string;
}

export const OrganizeTool: React.FC<OrganizeToolProps> = ({
  recentDocs,
  onSaveNewPdfAndOpen,
}) => {
  const [mode, setMode] = useState<'merge' | 'split'>('merge');

  // Combinar
  const [mergeItems, setMergeItems] = useState<MergeItem[]>([]);
  const [mergedBytes, setMergedBytes] = useState<Uint8Array | null>(null);
  const [outputName, setOutputName] = useState('documento_combinado.pdf');

  // Dividir
  const [splitFile, setSplitFile] = useState<{ name: string; buffer: ArrayBuffer; size: number } | null>(null);
  const [splitMode, setSplitMode] = useState<'extract' | 'every-page' | 'chunks'>('extract');
  const [rangeInput, setRangeInput] = useState('1-2');
  const [chunkSize, setChunkSize] = useState(2);
  const [splitResult, setSplitResult] = useState<{ blob: Blob; filename: string; fileCount: number } | null>(null);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addMergeFiles = async (files: File[]) => {
    const items: MergeItem[] = [];
    for (const f of files) {
      items.push({
        id: `${f.name}-${Date.now()}-${Math.random()}`,
        name: f.name,
        size: f.size,
        buffer: await f.arrayBuffer(),
        pageRange: '',
      });
    }
    setMergeItems((prev) => [...prev, ...items]);
    setMergedBytes(null);
    setError(null);
  };

  const addRecentToMerge = async (id: string) => {
    const doc = await getLocalDoc(id);
    if (!doc) return;
    setMergeItems((prev) => [
      ...prev,
      {
        id: `${doc.id}-${Date.now()}`,
        name: doc.name,
        size: doc.size,
        buffer: doc.data,
        pageRange: '',
      },
    ]);
    setMergedBytes(null);
  };

  const moveItem = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= mergeItems.length) return;
    setMergeItems((prev) => {
      const next = [...prev];
      const [x] = next.splice(idx, 1);
      next.splice(target, 0, x);
      return next;
    });
  };

  const runMerge = async () => {
    if (mergeItems.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = await mergePdfs(mergeItems, setProgress);
      setMergedBytes(bytes);
      const finalName = outputName.endsWith('.pdf') ? outputName : `${outputName}.pdf`;
      downloadUint8Array(bytes, finalName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error combinando PDFs');
    } finally {
      setBusy(false);
    }
  };

  const runSplit = async () => {
    if (!splitFile) return;
    setBusy(true);
    setError(null);
    setSplitResult(null);
    try {
      const res = await splitPdf(
        splitFile.buffer,
        splitFile.name,
        splitMode,
        { rangeInput, chunkSize },
        setProgress
      );
      setSplitResult(res);
      downloadBlob(res.blob, res.filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al dividir el PDF');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          Combinar y Dividir PDF
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          Une varios documentos en el orden que desees o extrae páginas concretas sin perder calidad.
        </p>
      </div>

      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        <button
          onClick={() => setMode('merge')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold ${
            mode === 'merge' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          <Layers className="h-4 w-4" />
          Combinar PDFs
        </button>
        <button
          onClick={() => setMode('split')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold ${
            mode === 'split' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          <Scissors className="h-4 w-4" />
          Dividir / Extraer páginas
        </button>
      </div>

      {mode === 'merge' ? (
        <div className="space-y-4">
          <FileDropzone
            accept=".pdf,application/pdf"
            multiple
            compact={mergeItems.length > 0}
            title="Añade dos o más archivos PDF para combinar"
            subtitle="Puedes arrastrar varios archivos a la vez y luego ordenarlos"
            onFiles={addMergeFiles}
          />

          {recentDocs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold text-slate-500">Añadir desde recientes:</span>
              {recentDocs.slice(0, 5).map((d) => (
                <button
                  key={d.id}
                  onClick={() => addRecentToMerge(d.id)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:border-blue-400 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  + {d.name}
                </button>
              ))}
            </div>
          )}

          {mergeItems.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="space-y-2">
                {mergeItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-800/60"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {idx + 1}. {item.name}
                      </p>
                      <p className="text-[11px] text-slate-500">{formatBytes(item.size)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={item.pageRange}
                        onChange={(e) =>
                          setMergeItems((prev) =>
                            prev.map((m) => (m.id === item.id ? { ...m, pageRange: e.target.value } : m))
                          )
                        }
                        placeholder="Todas (o ej. 1-3)"
                        className="w-36 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                      />
                      <button
                        onClick={() => moveItem(idx, -1)}
                        disabled={idx === 0}
                        className="rounded p-1.5 text-slate-500 hover:bg-white disabled:opacity-30"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => moveItem(idx, 1)}
                        disabled={idx === mergeItems.length - 1}
                        className="rounded p-1.5 text-slate-500 hover:bg-white disabled:opacity-30"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setMergeItems((prev) => prev.filter((m) => m.id !== item.id))}
                        className="rounded p-1.5 text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  type="text"
                  value={outputName}
                  onChange={(e) => setOutputName(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  placeholder="Nombre del PDF combinado..."
                />
                <button
                  onClick={runMerge}
                  disabled={mergeItems.length < 2 || busy}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-45"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
                  <span>Combinar ({mergeItems.length} archivos)</span>
                </button>
              </div>
            </div>
          )}

          {mergedBytes && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <span className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                  PDF combinado ({formatBytes(mergedBytes.byteLength)})
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => downloadUint8Array(mergedBytes, outputName)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"
                >
                  <Download className="h-3.5 w-3.5" />
                  Descargar
                </button>
                <button
                  onClick={() => onSaveNewPdfAndOpen(outputName, mergedBytes)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Abrir en Editor
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <FileDropzone
            accept=".pdf,application/pdf"
            compact={Boolean(splitFile)}
            title={splitFile ? `Archivo: ${splitFile.name}` : 'Selecciona el PDF que quieres dividir'}
            subtitle="Extrae páginas específicas o separa el PDF completo en partes"
            onFiles={async (files) => {
              const f = files[0];
              if (!f) return;
              setSplitFile({ name: f.name, buffer: await f.arrayBuffer(), size: f.size });
              setSplitResult(null);
            }}
          />

          {recentDocs.length > 0 && !splitFile && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold text-slate-500">O usa uno reciente:</span>
              {recentDocs.slice(0, 5).map((d) => (
                <button
                  key={d.id}
                  onClick={async () => {
                    const doc = await getLocalDoc(d.id);
                    if (doc) setSplitFile({ name: doc.name, buffer: doc.data, size: doc.size });
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {d.name} ({d.pageCount} pág.)
                </button>
              ))}
            </div>
          )}

          {splitFile && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {[
                  ['extract', 'Extraer rango a 1 PDF', 'Ej: 1-3, 5, 8'],
                  ['every-page', 'Separar cada página', '1 PDF por página en .ZIP'],
                  ['chunks', 'Dividir cada N páginas', 'Bloques iguales en .ZIP'],
                ].map(([id, title, sub]) => (
                  <button
                    key={id}
                    onClick={() => setSplitMode(id as 'extract' | 'every-page' | 'chunks')}
                    className={`rounded-xl border p-3 text-left ${
                      splitMode === id
                        ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>
                  </button>
                ))}
              </div>

              {splitMode === 'extract' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">
                    Páginas a extraer (ej. 1-3, 5, 7-9):
                  </label>
                  <input
                    type="text"
                    value={rangeInput}
                    onChange={(e) => setRangeInput(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              )}

              {splitMode === 'chunks' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">
                    Páginas por cada archivo dividido:
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={chunkSize}
                    onChange={(e) => setChunkSize(Math.max(1, Number(e.target.value) || 1))}
                    className="mt-1.5 w-32 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
              )}

              <button
                onClick={runSplit}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-45"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{progress?.message || 'Dividiendo...'}</span>
                  </>
                ) : (
                  <>
                    <Scissors className="h-4 w-4" />
                    <span>Dividir y descargar</span>
                  </>
                )}
              </button>
            </div>
          )}

          {splitResult && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
              <span className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                ¡Generado! {splitResult.filename} ({splitResult.fileCount}{' '}
                {splitResult.fileCount === 1 ? 'archivo' : 'partes'})
              </span>
              <button
                onClick={() => downloadBlob(splitResult.blob, splitResult.filename)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white"
              >
                <Download className="h-3.5 w-3.5" />
                Descargar
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}
    </div>
  );
};
