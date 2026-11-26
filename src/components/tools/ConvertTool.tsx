import React, { useState } from 'react';
import {
  FileText,
  FileSpreadsheet,
  Presentation,
  Image as ImageIcon,
  Code2,
  AlignLeft,
  ArrowRight,
  Download,
  Loader2,
  CheckCircle2,
  FolderOpen,
  Trash2,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import type { LocalPdfMeta, ProgressInfo } from '../../types/pdf';
import {
  convertDocumentToPdf,
  convertImagesToPdf,
  convertPdfToDocx,
  convertPdfToExcel,
  convertPdfToImages,
  convertPdfToPptx,
  convertPdfToTextOrHtml,
  type ImageOutputFormat,
} from '../../lib/pdfConvertEngine';
import { downloadBlob, downloadUint8Array, formatBytes, getLocalDoc } from '../../lib/storage';
import { FileDropzone } from '../FileDropzone';

interface ConvertToolProps {
  recentDocs: LocalPdfMeta[];
  onSaveNewPdfAndOpen: (name: string, bytes: Uint8Array) => Promise<void>;
}

type OutFormat = 'docx' | 'xlsx' | 'csv' | 'pptx' | 'png' | 'jpeg' | 'webp' | 'html' | 'txt';

export const ConvertTool: React.FC<ConvertToolProps> = ({
  recentDocs,
  onSaveNewPdfAndOpen,
}) => {
  const [direction, setDirection] = useState<'from-pdf' | 'to-pdf'>('from-pdf');

  // Estado PDF -> Otros
  const [pdfFile, setPdfFile] = useState<{ name: string; buffer: ArrayBuffer; size: number } | null>(null);
  const [targetFormat, setTargetFormat] = useState<OutFormat>('docx');
  const [imgScale, setImgScale] = useState(2);

  // Estado Otros -> PDF
  const [inputFiles, setInputFiles] = useState<File[]>([]);
  const [imgPageSize, setImgPageSize] = useState<'fit' | 'a4' | 'letter'>('a4');
  const [imgMargin, setImgMargin] = useState(24);

  // Progreso y resultado
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<{
    filename: string;
    blob: Blob;
    isPdf?: boolean;
    pdfBytes?: Uint8Array;
    textPreview?: string;
  } | null>(null);

  const loadRecent = async (id: string) => {
    const doc = await getLocalDoc(id);
    if (!doc) return;
    setPdfFile({ name: doc.name, buffer: doc.data, size: doc.size });
    setResultInfo(null);
    setError(null);
  };

  const handleSelectPdf = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setPdfFile({ name: f.name, buffer: await f.arrayBuffer(), size: f.size });
    setResultInfo(null);
    setError(null);
  };

  const runFromPdf = async () => {
    if (!pdfFile) return;
    setBusy(true);
    setError(null);
    setResultInfo(null);
    try {
      let res: { blob: Blob; filename: string; textPreview?: string };
      if (targetFormat === 'docx') {
        res = await convertPdfToDocx(pdfFile.buffer, pdfFile.name, setProgress);
      } else if (targetFormat === 'xlsx' || targetFormat === 'csv') {
        res = await convertPdfToExcel(pdfFile.buffer, pdfFile.name, targetFormat, setProgress);
      } else if (targetFormat === 'pptx') {
        res = await convertPdfToPptx(pdfFile.buffer, pdfFile.name, setProgress);
      } else if (targetFormat === 'png' || targetFormat === 'jpeg' || targetFormat === 'webp') {
        res = await convertPdfToImages(
          pdfFile.buffer,
          pdfFile.name,
          { format: targetFormat as ImageOutputFormat, scale: imgScale, quality: 0.9 },
          setProgress
        );
      } else {
        res = await convertPdfToTextOrHtml(pdfFile.buffer, pdfFile.name, targetFormat, setProgress);
      }

      setResultInfo(res);
      downloadBlob(res.blob, res.filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error durante la conversión');
    } finally {
      setBusy(false);
    }
  };

  const runToPdf = async () => {
    if (inputFiles.length === 0) return;
    setBusy(true);
    setError(null);
    setResultInfo(null);
    try {
      const allImages = inputFiles.every((f) => f.type.startsWith('image/'));
      let bytes: Uint8Array;
      let outName: string;

      if (allImages) {
        bytes = await convertImagesToPdf(
          inputFiles,
          { pageSize: imgPageSize, marginPt: imgMargin },
          setProgress
        );
        outName =
          inputFiles.length === 1
            ? `${inputFiles[0].name.replace(/\.[^.]+$/, '')}.pdf`
            : `imagenes_combinadas.pdf`;
      } else {
        bytes = await convertDocumentToPdf(inputFiles[0], setProgress);
        outName = `${inputFiles[0].name.replace(/\.[^.]+$/, '')}.pdf`;
      }

      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy], { type: 'application/pdf' });
      setResultInfo({ filename: outName, blob, isPdf: true, pdfBytes: bytes });
      downloadUint8Array(bytes, outName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al convertir a PDF');
    } finally {
      setBusy(false);
    }
  };

  const moveInputFile = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= inputFiles.length) return;
    setInputFiles((prev) => {
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const formatOptions: Array<{ id: OutFormat; label: string; sub: string; icon: React.ReactNode }> = [
    { id: 'docx', label: 'Word (.docx)', sub: 'Documento Word', icon: <FileText className="h-4 w-4 text-blue-600" /> },
    { id: 'xlsx', label: 'Excel (.xlsx)', sub: 'Hoja de cálculo', icon: <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> },
    { id: 'pptx', label: 'PowerPoint (.pptx)', sub: 'Presentación', icon: <Presentation className="h-4 w-4 text-orange-500" /> },
    { id: 'png', label: 'Imágenes PNG', sub: 'Alta nitidez', icon: <ImageIcon className="h-4 w-4 text-violet-600" /> },
    { id: 'jpeg', label: 'Imágenes JPG', sub: 'Peso ligero', icon: <ImageIcon className="h-4 w-4 text-pink-600" /> },
    { id: 'webp', label: 'Imágenes WebP', sub: 'Ultra compacto', icon: <ImageIcon className="h-4 w-4 text-cyan-600" /> },
    { id: 'csv', label: 'Tabla CSV', sub: 'Datos separados', icon: <FileSpreadsheet className="h-4 w-4 text-teal-600" /> },
    { id: 'html', label: 'Web HTML', sub: 'Página adaptable', icon: <Code2 className="h-4 w-4 text-indigo-600" /> },
    { id: 'txt', label: 'Texto (.txt)', sub: 'Texto limpio', icon: <AlignLeft className="h-4 w-4 text-slate-600" /> },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Conversor Universal PDF</h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          Convierte cualquier documento preservando su diseño original, colores, gráficos e imágenes 100% en tu dispositivo.
        </p>
      </div>

      {/* Selector de dirección */}
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        <button
          onClick={() => {
            setDirection('from-pdf');
            setResultInfo(null);
            setError(null);
          }}
          className={`rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold transition-colors ${
            direction === 'from-pdf'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
          }`}
        >
          De PDF a Word / Excel / PPT / Imagen
        </button>
        <button
          onClick={() => {
            setDirection('to-pdf');
            setResultInfo(null);
            setError(null);
          }}
          className={`rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold transition-colors ${
            direction === 'to-pdf'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
          }`}
        >
          De Imágenes / Word / HTML a PDF
        </button>
      </div>

      {direction === 'from-pdf' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Izquierda: Archivo fuente */}
          <div className="lg:col-span-5 space-y-4">
            <FileDropzone
              accept=".pdf,application/pdf"
              compact={Boolean(pdfFile)}
              title={pdfFile ? 'Cambiar archivo PDF' : 'Selecciona o arrastra un PDF'}
              subtitle="Conversión instantánea en tu dispositivo"
              onFiles={handleSelectPdf}
            />

            {pdfFile && (
              <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50/70 px-3.5 py-3 dark:border-blue-900/60 dark:bg-blue-950/30">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-blue-900 dark:text-blue-200">
                    {pdfFile.name}
                  </p>
                  <p className="text-xs text-blue-700/70 dark:text-blue-300/70">
                    {formatBytes(pdfFile.size)}
                  </p>
                </div>
                <button
                  onClick={() => setPdfFile(null)}
                  className="rounded-lg p-1.5 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}

            {recentDocs.length > 0 && (
              <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
                <p className="mb-2 text-xs font-bold text-slate-600 dark:text-slate-400">
                  O elige un documento reciente:
                </p>
                <div className="max-h-44 space-y-1 overflow-y-auto">
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

          {/* Derecha: Formato de salida y botón Convertir directo */}
          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">
                Elige el formato de salida
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {formatOptions.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setTargetFormat(opt.id)}
                    className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all ${
                      targetFormat === opt.id
                        ? 'border-blue-500 bg-blue-50/70 ring-1 ring-blue-500/30 dark:bg-blue-950/40'
                        : 'border-slate-200 hover:border-blue-300 dark:border-slate-800 dark:hover:border-slate-700'
                    }`}
                  >
                    <span className="shrink-0">{opt.icon}</span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">
                        {opt.label}
                      </p>
                      <p className="truncate text-[10px] text-slate-500">{opt.sub}</p>
                    </div>
                  </button>
                ))}
              </div>

              {(targetFormat === 'png' || targetFormat === 'jpeg' || targetFormat === 'webp') && (
                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Resolución:</span>
                  {[
                    [1.5, 'Estándar (108 DPI)'],
                    [2, 'Alta (144 DPI)'],
                    [3, 'Ultra (216 DPI)'],
                  ].map(([val, lbl]) => (
                    <button
                      key={String(val)}
                      onClick={() => setImgScale(Number(val))}
                      className={`rounded-lg px-2.5 py-1 font-semibold ${
                        imgScale === val
                          ? 'bg-blue-600 text-white'
                          : 'bg-white border border-slate-200 text-slate-600 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={runFromPdf}
                disabled={!pdfFile || busy}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-45 transition-all"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{progress?.message || 'Convirtiendo...'}</span>
                  </>
                ) : (
                  <>
                    <span>Convertir</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <FileDropzone
            accept=".png,.jpg,.jpeg,.webp,.docx,.txt,.md,.html,.htm"
            multiple
            title="Selecciona imágenes (JPG, PNG, WebP) o un documento Word (.docx), TXT, HTML"
            subtitle="Puedes seleccionar varias imágenes a la vez para crear un único PDF"
            onFiles={(files) => {
              setInputFiles((prev) => [...prev, ...files]);
              setResultInfo(null);
              setError(null);
            }}
          />

          {inputFiles.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  Archivos seleccionados ({inputFiles.length})
                </p>
                <button
                  onClick={() => setInputFiles([])}
                  className="text-xs font-semibold text-rose-600 hover:underline"
                >
                  Limpiar lista
                </button>
              </div>

              <div className="max-h-56 space-y-1.5 overflow-y-auto">
                {inputFiles.map((f, idx) => (
                  <div
                    key={`${f.name}-${idx}`}
                    className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-800/60"
                  >
                    <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                      {idx + 1}. {f.name} ({formatBytes(f.size)})
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => moveInputFile(idx, -1)}
                        disabled={idx === 0}
                        className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => moveInputFile(idx, 1)}
                        disabled={idx === inputFiles.length - 1}
                        className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setInputFiles((p) => p.filter((_, i) => i !== idx))}
                        className="rounded p-1 text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {inputFiles.every((f) => f.type.startsWith('image/')) && (
                <div className="flex flex-wrap items-center gap-4 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">Tamaño de página:</span>
                    <select
                      value={imgPageSize}
                      onChange={(e) => setImgPageSize(e.target.value as 'fit' | 'a4' | 'letter')}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                    >
                      <option value="a4">A4 Estándar</option>
                      <option value="letter">Carta (Letter)</option>
                      <option value="fit">Ajustar al tamaño original</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">Margen:</span>
                    <select
                      value={imgMargin}
                      onChange={(e) => setImgMargin(Number(e.target.value))}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                    >
                      <option value={0}>Sin margen</option>
                      <option value={24}>Pequeño</option>
                      <option value={48}>Amplio</option>
                    </select>
                  </div>
                </div>
              )}

              <button
                onClick={runToPdf}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-45"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{progress?.message || 'Creando PDF...'}</span>
                  </>
                ) : (
                  <>
                    <span>Convertir</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Barra de progreso */}
      {busy && progress && (
        <div className="rounded-xl border border-blue-200 bg-white p-4 dark:border-blue-900 dark:bg-slate-900">
          <div className="flex justify-between text-xs font-semibold text-blue-700 dark:text-blue-300">
            <span>{progress.message}</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-200"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {resultInfo && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                  ¡Listo! {resultInfo.filename}
                </p>
                <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
                  Tamaño generado: {formatBytes(resultInfo.blob.size)} · Procesado localmente
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => downloadBlob(resultInfo.blob, resultInfo.filename)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <Download className="h-3.5 w-3.5" />
                Descargar de nuevo
              </button>
              {resultInfo.isPdf && resultInfo.pdfBytes && (
                <button
                  onClick={() => onSaveNewPdfAndOpen(resultInfo.filename, resultInfo.pdfBytes!)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Abrir en el Editor
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
