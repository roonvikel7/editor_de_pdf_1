import React, { useState } from 'react';
import { Blocks, Trash2, Loader2, Download, CheckCircle2 } from 'lucide-react';
import { compressPdf } from '../../lib/pdfToolsEngine';
import { convertPdfToDocx, convertPdfToTextOrHtml } from '../../lib/pdfConvertEngine';
import { exportEditedPdf } from '../../lib/pdfEditorEngine';
import { downloadBlob, formatBytes, generateId } from '../../lib/storage';
import { FileDropzone } from '../FileDropzone';

type BatchAction = 'compress' | 'to-docx' | 'to-txt' | 'watermark' | 'page-numbers';

export const BatchTool: React.FC = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [action, setAction] = useState<BatchAction>('compress');
  const [watermarkText, setWatermarkText] = useState('CONFIDENCIAL');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [percent, setPercent] = useState(0);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runBatch = async () => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setZipBlob(null);
    setPercent(0);

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const clean = f.name.replace(/\.pdf$/i, '');
        setStatus(`Procesando ${i + 1} de ${files.length}: ${f.name}`);
        setPercent(Math.round((i / files.length) * 90));

        const buffer = await f.arrayBuffer();

        if (action === 'compress') {
          const res = await compressPdf(buffer, 'balanced');
          zip.file(`${clean}_comprimido.pdf`, res.bytes);
        } else if (action === 'to-docx') {
          const res = await convertPdfToDocx(buffer, f.name, 'editable');
          zip.file(res.filename, res.blob);
        } else if (action === 'to-txt') {
          const res = await convertPdfToTextOrHtml(buffer, f.name, 'txt');
          zip.file(res.filename, res.blob);
        } else if (action === 'watermark' || action === 'page-numbers') {
          const { PDFDocument } = await import('pdf-lib');
          const src = await PDFDocument.load(buffer.slice(0), { ignoreEncryption: true });
          const pages = Array.from({ length: src.getPageCount() }, (_, idx) => ({
            pageId: `b-${idx}-${generateId()}`,
            sourcePageIndex: idx,
            rotation: 0,
          }));
          const bytes = await exportEditedPdf({
            sourceBuffer: buffer,
            pages,
            annotations: [],
            watermark:
              action === 'watermark'
                ? {
                    enabled: true,
                    text: watermarkText || 'CONFIDENCIAL',
                    opacity: 0.22,
                    fontSize: 48,
                    color: '#64748B',
                    rotation: 35,
                  }
                : undefined,
            pageNumbers:
              action === 'page-numbers'
                ? { enabled: true, position: 'bottom-center', format: 'of-total', startFrom: 1 }
                : undefined,
          });
          zip.file(`${clean}_${action}.pdf`, bytes);
        }
      }

      setStatus('Empaquetando resultados en .ZIP...');
      setPercent(95);
      const blob = await zip.generateAsync({ type: 'blob' });
      setZipBlob(blob);
      setPercent(100);
      setStatus('¡Proceso por lotes completado!');
      downloadBlob(blob, `pdfstudio_lote_${action}.zip`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error en proceso por lotes');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Proceso por lotes</h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          Equivalente web a PDFToolbox: aplica una misma operación a decenas de PDFs simultáneamente en tu dispositivo.
        </p>
      </div>

      <FileDropzone
        accept=".pdf,application/pdf"
        multiple
        compact={files.length > 0}
        title="Arrastra o selecciona varios PDFs para procesar en lote"
        subtitle="Al finalizar recibirás un paquete .ZIP con todos los archivos listos"
        onFiles={(incoming) => {
          setFiles((prev) => [...prev, ...incoming]);
          setZipBlob(null);
        }}
      />

      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Acción a aplicar a los {files.length} archivos
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {(
            [
              ['compress', 'Comprimir todos'],
              ['to-docx', 'Convertir a Word'],
              ['to-txt', 'Extraer texto (.txt)'],
              ['watermark', 'Marca de agua'],
              ['page-numbers', 'Numerar páginas'],
            ] as Array<[BatchAction, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setAction(id)}
              className={`rounded-xl border px-3 py-2.5 text-xs font-bold transition-all ${
                action === id
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                  : 'border-slate-200 text-slate-700 hover:border-blue-300 dark:border-slate-800 dark:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {action === 'watermark' && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
              Texto de marca de agua:
            </label>
            <input
              type="text"
              value={watermarkText}
              onChange={(e) => setWatermarkText(e.target.value)}
              className="mt-1 w-full max-w-sm rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
        )}

        {files.length > 0 && (
          <div className="max-h-48 space-y-1.5 overflow-y-auto border-t border-slate-100 pt-3 dark:border-slate-800">
            {files.map((f, idx) => (
              <div
                key={`${f.name}-${idx}`}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-xs dark:bg-slate-800/60"
              >
                <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                  {idx + 1}. {f.name} ({formatBytes(f.size)})
                </span>
                <button
                  onClick={() => setFiles((p) => p.filter((_, i) => i !== idx))}
                  className="text-slate-400 hover:text-rose-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={runBatch}
          disabled={files.length === 0 || busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-45"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{status}</span>
            </>
          ) : (
            <>
              <Blocks className="h-4 w-4" />
              <span>Ejecutar lote ({files.length} PDFs)</span>
            </>
          )}
        </button>

        {busy && (
          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-blue-600 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          {error}
        </div>
      )}

      {zipBlob && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
              Paquete ZIP listo ({formatBytes(zipBlob.size)})
            </span>
          </div>
          <button
            onClick={() => downloadBlob(zipBlob, `pdfstudio_lote_${action}.zip`)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white"
          >
            <Download className="h-4 w-4" />
            Descargar ZIP
          </button>
        </div>
      )}
    </div>
  );
};
