import React, { useState } from 'react';
import { Minimize2, Loader2, Download, FolderOpen, CheckCircle2 } from 'lucide-react';
import type { LocalPdfMeta, ProgressInfo } from '../../types/pdf';
import { compressPdf, type CompressionLevel } from '../../lib/pdfToolsEngine';
import { downloadUint8Array, formatBytes, getLocalDoc } from '../../lib/storage';
import { FileDropzone } from '../FileDropzone';

interface CompressToolProps {
  recentDocs: LocalPdfMeta[];
  onSaveNewPdfAndOpen: (name: string, bytes: Uint8Array) => Promise<void>;
}

export const CompressTool: React.FC<CompressToolProps> = ({
  recentDocs,
  onSaveNewPdfAndOpen,
}) => {
  const [pdfFile, setPdfFile] = useState<{ name: string; buffer: ArrayBuffer; size: number } | null>(null);
  const [level, setLevel] = useState<CompressionLevel>('balanced');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    bytes: Uint8Array;
    originalSize: number;
    compressedSize: number;
    savedPercent: number;
    keptOriginal: boolean;
  } | null>(null);

  const runCompress = async () => {
    if (!pdfFile) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await compressPdf(pdfFile.buffer, level, setProgress);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al comprimir el PDF');
    } finally {
      setBusy(false);
    }
  };

  const outName = pdfFile ? `${pdfFile.name.replace(/\.pdf$/i, '')}_comprimido.pdf` : 'comprimido.pdf';

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Comprimir PDF</h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          Reduce el tamaño de tus archivos PDF directamente en tu dispositivo para enviarlos por WhatsApp o correo.
        </p>
      </div>

      <FileDropzone
        accept=".pdf,application/pdf"
        compact={Boolean(pdfFile)}
        title={pdfFile ? `${pdfFile.name} (${formatBytes(pdfFile.size)})` : 'Selecciona o arrastra el PDF a comprimir'}
        subtitle="Compresión local instantánea sin subir archivos"
        onFiles={async (files) => {
          const f = files[0];
          if (!f) return;
          setPdfFile({ name: f.name, buffer: await f.arrayBuffer(), size: f.size });
          setResult(null);
        }}
      />

      {recentDocs.length > 0 && !pdfFile && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold text-slate-500">O usa uno reciente:</span>
          {recentDocs.slice(0, 5).map((d) => (
            <button
              key={d.id}
              onClick={async () => {
                const doc = await getLocalDoc(d.id);
                if (doc) setPdfFile({ name: doc.name, buffer: doc.data, size: doc.size });
              }}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              {d.name} ({formatBytes(d.size)})
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Nivel de compresión
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(
            [
              ['low', 'Suave (Sin pérdida)', 'Mantiene texto vectorial intacto y optimiza estructura interna.'],
              ['balanced', 'Equilibrado (Recomendado)', 'Ideal para PDFs con imágenes o escaneos. Gran ahorro con buena nitidez.'],
              ['extreme', 'Máximo ahorro', 'Compresión agresiva pensada para límites estrictos de envío.'],
            ] as Array<[CompressionLevel, string, string]>
          ).map(([id, title, desc]) => (
            <button
              key={id}
              onClick={() => setLevel(id)}
              className={`rounded-xl border p-3.5 text-left transition-all ${
                level === id
                  ? 'border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-500/30 dark:bg-emerald-950/40'
                  : 'border-slate-200 hover:border-emerald-300 dark:border-slate-800'
              }`}
            >
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{desc}</p>
            </button>
          ))}
        </div>

        <button
          onClick={runCompress}
          disabled={!pdfFile || busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-45"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{progress?.message || 'Comprimiendo...'}</span>
            </>
          ) : (
            <>
              <Minimize2 className="h-4 w-4" />
              <span>Comprimir PDF ahora</span>
            </>
          )}
        </button>

        {busy && progress && (
          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 space-y-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
              <div>
                <p className="text-base font-bold text-emerald-900 dark:text-emerald-200">
                  {result.keptOriginal
                    ? 'Este PDF ya estaba altamente optimizado'
                    : `¡Redujiste un ${result.savedPercent}% del peso!`}
                </p>
                <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80">
                  Antes: <strong>{formatBytes(result.originalSize)}</strong> → Ahora:{' '}
                  <strong>{formatBytes(result.compressedSize)}</strong>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => downloadUint8Array(result.bytes, outName)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <Download className="h-4 w-4" />
                Descargar comprimido
              </button>
              <button
                onClick={() => onSaveNewPdfAndOpen(outName, result.bytes)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
              >
                <FolderOpen className="h-4 w-4" />
                Abrir en Editor
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
