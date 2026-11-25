import React, { useState } from 'react';
import {
  ScanText,
  Copy,
  Check,
  Download,
  Loader2,
  FolderOpen,
  Sparkles,
} from 'lucide-react';
import type { LocalPdfMeta, ProgressInfo } from '../../types/pdf';
import { OCR_LANGUAGES, runPdfOcr } from '../../lib/pdfOcrEngine';
import { parsePageRange } from '../../lib/pdfToolsEngine';
import { downloadBlob, downloadUint8Array, formatBytes, getLocalDoc } from '../../lib/storage';
import { FileDropzone } from '../FileDropzone';

interface OcrToolProps {
  recentDocs: LocalPdfMeta[];
  onSaveNewPdfAndOpen: (name: string, bytes: Uint8Array) => Promise<void>;
}

export const OcrTool: React.FC<OcrToolProps> = ({ recentDocs, onSaveNewPdfAndOpen }) => {
  const [pdfFile, setPdfFile] = useState<{ name: string; buffer: ArrayBuffer; size: number } | null>(null);
  const [lang, setLang] = useState('spa');
  const [pageRange, setPageRange] = useState('');
  const [createSearchable, setCreateSearchable] = useState(true);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [extractedText, setExtractedText] = useState('');
  const [searchablePdf, setSearchablePdf] = useState<Uint8Array | null>(null);
  const [copied, setCopied] = useState(false);

  const loadRecent = async (id: string) => {
    const doc = await getLocalDoc(id);
    if (!doc) return;
    setPdfFile({ name: doc.name, buffer: doc.data, size: doc.size });
    setExtractedText('');
    setSearchablePdf(null);
    setError(null);
  };

  const handleRunOcr = async () => {
    if (!pdfFile) return;
    setBusy(true);
    setError(null);
    setExtractedText('');
    setSearchablePdf(null);

    try {
      const pages = pageRange.trim() ? parsePageRange(pageRange, 9999) : undefined;
      const result = await runPdfOcr(
        pdfFile.buffer,
        { lang, pageNumbers: pages, createSearchablePdf: createSearchable },
        setProgress
      );
      setExtractedText(result.fullText);
      setSearchablePdf(result.searchablePdfBytes ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al ejecutar OCR en el navegador');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(extractedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const cleanBase = (pdfFile?.name || 'documento').replace(/\.pdf$/i, '');

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          Reconocimiento Óptico de Texto (OCR)
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          Convierte PDFs escaneados en texto editable o PDF con capa de texto buscable. Descarga el idioma elegido solo 1 vez desde CDN y queda en caché offline (0 MB en Vercel).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5 space-y-4">
          <FileDropzone
            accept=".pdf,application/pdf"
            compact={Boolean(pdfFile)}
            title={pdfFile ? 'Cambiar archivo PDF' : 'Selecciona o arrastra un PDF escaneado'}
            subtitle="Motor Tesseract WASM ejecutado en tu CPU local"
            onFiles={async (files) => {
              const f = files[0];
              if (!f) return;
              setPdfFile({ name: f.name, buffer: await f.arrayBuffer(), size: f.size });
              setExtractedText('');
              setSearchablePdf(null);
            }}
          />

          {pdfFile && (
            <div className="rounded-xl border border-sky-200 bg-sky-50/70 px-3.5 py-2.5 dark:border-sky-900/60 dark:bg-sky-950/30">
              <p className="truncate text-sm font-semibold text-sky-900 dark:text-sky-200">
                {pdfFile.name}
              </p>
              <p className="text-xs text-sky-700/80 dark:text-sky-300/70">
                {formatBytes(pdfFile.size)}
              </p>
            </div>
          )}

          {recentDocs.length > 0 && (
            <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
              <p className="mb-2 text-xs font-bold text-slate-600 dark:text-slate-400">
                O selecciona un archivo reciente:
              </p>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {recentDocs.slice(0, 6).map((d) => (
                  <button
                    key={d.id}
                    onClick={() => loadRecent(d.id)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                      {d.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-400">{d.pageCount} pág.</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">
                Idioma del documento
              </label>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                {OCR_LANGUAGES.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label} ({o.approxSize} caché local 1 sola vez)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">
                Páginas a reconocer (opcional)
              </label>
              <input
                type="text"
                value={pageRange}
                onChange={(e) => setPageRange(e.target.value)}
                placeholder="Dejar vacío para todas, o ej: 1-3, 5"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>

            <label className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3 text-xs cursor-pointer dark:bg-slate-800/60">
              <input
                type="checkbox"
                checked={createSearchable}
                onChange={(e) => setCreateSearchable(e.target.checked)}
                className="mt-0.5 accent-blue-600"
              />
              <span>
                <strong className="block text-slate-800 dark:text-slate-100">
                  Generar PDF buscable y seleccionable
                </strong>
                <span className="text-slate-500">
                  Incrusta una capa de texto invisible exactamente sobre el escaneo original (estilo PDFelement).
                </span>
              </span>
            </label>

            <button
              onClick={handleRunOcr}
              disabled={!pdfFile || busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-45"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{progress?.message || 'Reconociendo texto...'}</span>
                </>
              ) : (
                <>
                  <ScanText className="h-4 w-4" />
                  <span>Iniciar reconocimiento OCR</span>
                </>
              )}
            </button>

            {busy && progress && (
              <div>
                <div className="flex justify-between text-xs font-semibold text-blue-600">
                  <span>{progress.message}</span>
                  <span>{progress.percent}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-300"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Resultado OCR */}
      {extractedText && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Texto reconocido
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copiado' : 'Copiar texto'}
              </button>
              <button
                onClick={() =>
                  downloadBlob(
                    new Blob([extractedText], { type: 'text/plain;charset=utf-8' }),
                    `${cleanBase}_ocr.txt`
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
              >
                <Download className="h-3.5 w-3.5" />
                Descargar .TXT
              </button>
              {searchablePdf && (
                <>
                  <button
                    onClick={() => downloadUint8Array(searchablePdf, `${cleanBase}_buscable.pdf`)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Descargar PDF buscable
                  </button>
                  <button
                    onClick={() => onSaveNewPdfAndOpen(`${cleanBase}_buscable.pdf`, searchablePdf)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Abrir en Editor
                  </button>
                </>
              )}
            </div>
          </div>

          <textarea
            value={extractedText}
            onChange={(e) => setExtractedText(e.target.value)}
            rows={10}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3.5 font-mono text-xs leading-relaxed text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          />
        </div>
      )}
    </div>
  );
};
