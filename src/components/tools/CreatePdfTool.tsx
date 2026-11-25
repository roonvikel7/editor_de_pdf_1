import React, { useState } from 'react';
import { FilePlus2, Loader2 } from 'lucide-react';
import { createBlankPdf } from '../../lib/pdfCore';

interface CreatePdfToolProps {
  onCreated: (name: string, bytes: Uint8Array) => Promise<void>;
}

const PRESETS = [
  { id: 'a4', label: 'A4 (210 × 297 mm)', w: 595.28, h: 841.89 },
  { id: 'letter', label: 'Carta / Letter (8.5 × 11")', w: 612, h: 792 },
  { id: 'legal', label: 'Oficio / Legal', w: 612, h: 1008 },
  { id: 'slide', label: 'Presentación 16:9', w: 960, h: 540 },
];

export const CreatePdfTool: React.FC<CreatePdfToolProps> = ({ onCreated }) => {
  const [title, setTitle] = useState('Documento nuevo');
  const [preset, setPreset] = useState('a4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [pageCount, setPageCount] = useState(1);
  const [busy, setBusy] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const p = PRESETS.find((x) => x.id === preset) || PRESETS[0];
      const isSlide = p.id === 'slide';
      const w = isSlide ? p.w : orientation === 'portrait' ? p.w : p.h;
      const h = isSlide ? p.h : orientation === 'portrait' ? p.h : p.w;
      const bytes = await createBlankPdf({
        pageCount: Math.max(1, Math.min(50, pageCount)),
        widthPt: w,
        heightPt: h,
        title: title.trim() || 'Documento nuevo',
      });
      const filename = `${(title.trim() || 'documento_nuevo').replace(/\.pdf$/i, '')}.pdf`;
      await onCreated(filename, bytes);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/70 dark:text-blue-400">
            <FilePlus2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              Crear nuevo documento PDF
            </h1>
            <p className="text-xs text-slate-500">
              Se abrirá inmediatamente en el editor para añadir texto, imágenes o firmas.
            </p>
          </div>
        </div>

        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">
              Nombre del documento
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">
                Tamaño de página
              </label>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">
                Número de páginas
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={pageCount}
                onChange={(e) => setPageCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>

          {preset !== 'slide' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">
                Orientación
              </label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(['portrait', 'landscape'] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setOrientation(o)}
                    className={`rounded-xl border py-2 text-xs font-semibold ${
                      orientation === o
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                        : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {o === 'portrait' ? 'Vertical' : 'Horizontal'}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
            <span>Crear y abrir en el Editor</span>
          </button>
        </form>
      </div>
    </div>
  );
};
