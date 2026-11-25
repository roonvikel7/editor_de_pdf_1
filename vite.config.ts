import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Separación modular inspirada en PDFelement: cada motor va en su propio chunk lazy-loaded
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('pdfjs-dist')) return 'engine-pdfjs';
            if (id.includes('pdf-lib') || id.includes('@pdf-lib')) return 'engine-pdflib';
            if (id.includes('tesseract.js')) return 'engine-ocr';
            if (id.includes('/docx/') || id.includes('\\docx\\')) return 'engine-docx';
            if (id.includes('/xlsx/') || id.includes('\\xlsx\\')) return 'engine-xlsx';
            if (id.includes('pptxgenjs')) return 'engine-pptx';
            if (id.includes('mammoth')) return 'engine-mammoth';
            if (id.includes('jszip')) return 'engine-zip';
            if (id.includes('react-dom') || id.includes('/react/') || id.includes('\\react\\')) {
              return 'vendor-react';
            }
          }
        },
      },
    },
  },
});
