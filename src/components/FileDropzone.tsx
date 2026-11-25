import React, { useRef, useState } from 'react';
import { UploadCloud, FileText } from 'lucide-react';

interface FileDropzoneProps {
  accept?: string;
  multiple?: boolean;
  title?: string;
  subtitle?: string;
  compact?: boolean;
  onFiles: (files: File[]) => void;
}

export const FileDropzone: React.FC<FileDropzoneProps> = ({
  accept = '.pdf,application/pdf',
  multiple = false,
  title = 'Pulsa o arrastra archivos aquí',
  subtitle = 'Todo se procesa en tu dispositivo · 0 MB enviados a servidores',
  compact = false,
  onFiles,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const list = Array.from(e.dataTransfer.files || []);
    if (list.length > 0) {
      onFiles(multiple ? list : [list[0]]);
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
      }}
      className={`group relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200 ${
        dragging
          ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-950/30 scale-[1.005]'
          : 'border-slate-300/90 hover:border-blue-400 bg-white/80 hover:bg-blue-50/30 dark:border-slate-700 dark:bg-slate-900/60 dark:hover:border-blue-500/70'
      } ${compact ? 'p-5' : 'p-8 sm:p-10'}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const list = Array.from(e.target.files || []);
          if (list.length > 0) {
            onFiles(multiple ? list : [list[0]]);
          }
          e.target.value = '';
        }}
      />
      <div className="flex flex-col items-center justify-center text-center gap-2.5">
        <div
          className={`flex items-center justify-center rounded-2xl transition-transform duration-200 group-hover:scale-105 ${
            dragging
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25'
              : 'bg-blue-50 text-blue-600 dark:bg-blue-950/70 dark:text-blue-400'
          } ${compact ? 'h-11 w-11' : 'h-14 w-14'}`}
        >
          {dragging ? <FileText className="h-6 w-6" /> : <UploadCloud className="h-6 w-6" />}
        </div>
        <div>
          <p className="text-sm sm:text-base font-semibold text-slate-800 dark:text-slate-100">
            {title}
          </p>
          <p className="mt-0.5 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            {subtitle}
          </p>
        </div>
      </div>
    </div>
  );
};
