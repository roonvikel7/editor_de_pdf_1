import React, { useEffect, useRef, useState } from 'react';
import { X, PenTool, Type, Upload, Trash2, Check } from 'lucide-react';
import type { SavedSignature } from '../../types/pdf';
import { deleteSignature, generateId, listSignatures, saveSignature } from '../../lib/storage';

interface SignatureModalProps {
  onClose: () => void;
  onSelectSignature: (dataUrl: string) => void;
}

export const SignatureModal: React.FC<SignatureModalProps> = ({
  onClose,
  onSelectSignature,
}) => {
  const [tab, setTab] = useState<'draw' | 'type' | 'upload'>('draw');
  const [inkColor, setInkColor] = useState('#0F172A');
  const [typedName, setTypedName] = useState('');
  const [savedList, setSavedList] = useState<SavedSignature[]>([]);
  const [hasDrawing, setHasDrawing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    listSignatures().then(setSavedList).catch(() => {});
  }, []);

  const clearCanvas = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx?.clearRect(0, 0, c.width, c.height);
    setHasDrawing(false);
  };

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * c.width,
      y: ((e.clientY - rect.top) / rect.height) * c.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPtRef.current = getCanvasPoint(e);
    setHasDrawing(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !lastPtRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const pt = getCanvasPoint(e);
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(lastPtRef.current.x, lastPtRef.current.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPtRef.current = pt;
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
    lastPtRef.current = null;
  };

  const createTypedDataUrl = (): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 560;
    canvas.height = 170;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = inkColor;
      ctx.font = 'italic 68px "Brush Script MT", "Segoe Script", cursive';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(typedName.trim() || 'Firma', canvas.width / 2, canvas.height / 2);
    }
    return canvas.toDataURL('image/png');
  };

  const handleUseCurrent = async () => {
    let dataUrl = '';
    if (tab === 'draw') {
      if (!canvasRef.current || !hasDrawing) return;
      dataUrl = canvasRef.current.toDataURL('image/png');
    } else if (tab === 'type') {
      if (!typedName.trim()) return;
      dataUrl = createTypedDataUrl();
    }
    if (!dataUrl) return;

    const sig: SavedSignature = {
      id: generateId(),
      name: tab === 'type' ? typedName.trim() : `Firma ${new Date().toLocaleDateString('es-ES')}`,
      dataUrl,
      createdAt: Date.now(),
    };
    await saveSignature(sig).catch(() => {});
    onSelectSignature(dataUrl);
  };

  const handleUploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl) return;
      await saveSignature({
        id: generateId(),
        name: file.name,
        dataUrl,
        createdAt: Date.now(),
      }).catch(() => {});
      onSelectSignature(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteSaved = async (id: string) => {
    await deleteSignature(id);
    setSavedList((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            Firmar documento
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Pestañas */}
          <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {[
              { id: 'draw', label: 'Dibujar', icon: <PenTool className="h-3.5 w-3.5" /> },
              { id: 'type', label: 'Escribir', icon: <Type className="h-3.5 w-3.5" /> },
              { id: 'upload', label: 'Imagen', icon: <Upload className="h-3.5 w-3.5" /> },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id as 'draw' | 'type' | 'upload')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                  tab === item.id
                    ? 'bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>

          {/* Selector de color de tinta */}
          {tab !== 'upload' && (
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">Color de tinta:</span>
              <div className="flex items-center gap-2">
                {['#0F172A', '#1D4ED8', '#B91C1C', '#047857'].map((c) => (
                  <button
                    key={c}
                    onClick={() => setInkColor(c)}
                    className={`h-6 w-6 rounded-full border-2 transition-transform ${
                      inkColor === c ? 'scale-110 border-blue-500 ring-2 ring-blue-500/30' : 'border-white dark:border-slate-700'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          )}

          {tab === 'draw' && (
            <div className="space-y-2">
              <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70">
                <canvas
                  ref={canvasRef}
                  width={520}
                  height={170}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  className="touch-canvas h-40 w-full cursor-crosshair bg-white"
                />
                {!hasDrawing && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400">
                    Dibuja tu firma aquí con el ratón o el dedo
                  </span>
                )}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={clearCanvas}
                  className="text-xs font-medium text-slate-500 hover:text-rose-600"
                >
                  Limpiar lienzo
                </button>
              </div>
            </div>
          )}

          {tab === 'type' && (
            <div className="space-y-3">
              <input
                type="text"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="Escribe tu nombre completo..."
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <div className="flex h-28 items-center justify-center rounded-xl border border-slate-200 bg-white px-4">
                <span
                  className="font-signature text-4xl sm:text-5xl truncate"
                  style={{ color: inkColor }}
                >
                  {typedName.trim() || 'Tu Firma'}
                </span>
              </div>
            </div>
          )}

          {tab === 'upload' && (
            <label className="flex h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/70 text-center hover:border-blue-400 dark:border-slate-700 dark:bg-slate-800/50">
              <Upload className="h-6 w-6 text-blue-600" />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Subir imagen de firma (PNG transparente recomendado)
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={handleUploadFile} />
            </label>
          )}

          {/* Firmas guardadas localmente */}
          {savedList.length > 0 && (
            <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                Firmas guardadas en tu dispositivo (1 clic para insertar)
              </p>
              <div className="grid grid-cols-2 gap-2 max-h-28 overflow-y-auto">
                {savedList.map((sig) => (
                  <div
                    key={sig.id}
                    onClick={() => onSelectSignature(sig.dataUrl)}
                    className="group relative flex h-14 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white p-1.5 hover:border-blue-400 dark:border-slate-700"
                  >
                    <img src={sig.dataUrl} alt={sig.name} className="max-h-full max-w-full object-contain" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSaved(sig.id);
                      }}
                      className="absolute right-1 top-1 hidden rounded bg-white/90 p-1 text-slate-400 hover:text-rose-600 group-hover:block"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Botones de acción */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            {tab !== 'upload' && (
              <button
                onClick={handleUseCurrent}
                disabled={(tab === 'draw' && !hasDrawing) || (tab === 'type' && !typedName.trim())}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" />
                Insertar firma
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
