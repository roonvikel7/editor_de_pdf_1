# PDFStudio — Suite PDF 100% Local (Zero-Vercel Data)

Aplicación web progresiva (PWA) inspirada en la arquitectura modular de **Wondershare PDFelement**, diseñada para funcionar con fluidez en PC, tablet y móvil **sin consumir funciones ni almacenamiento en Vercel**.

## Arquitectura Zero-Server

- **0 Serverless Functions / 0 APIs / 0 Storage en Vercel**: Todos los PDFs se leen, editan, convierten, comprimen, combinan y pasan por OCR directamente en el navegador del usuario.
- **Carga diferida por módulo (*Code Splitting*)**: Al abrir la página principal solo se descarga el cascarón ligero de la interfaz. Cada motor (`pdfjs-dist`, `pdf-lib`, `docx`, `xlsx`, `pptxgenjs`, `mammoth`, `tesseract.js`, `jszip`) se descarga únicamente cuando el usuario entra a esa herramienta.
- **Motores pesados desde CDN público (jsDelivr / tessdata)**: El Web Worker de PDF.js, los CMaps, las fuentes estándar y los binarios WASM + modelos de idioma de Tesseract OCR se descargan desde CDNs gratuitos sin consumir tu cuota de transferencia en Vercel.
- **PWA Offline + IndexedDB**: El Service Worker (`public/sw.js`) cachea permanentemente los assets inmutables y motores externos. Tras la primera visita, el consumo en Vercel es de **0 bytes** y la app funciona incluso sin conexión.

## Comandos locales

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Despliegue en Vercel

1. Sube esta carpeta a un repositorio en GitHub (o ejecuta `npx vercel` en esta carpeta).
2. Vercel detectará automáticamente `vercel.json` (build `npm run build`, carpeta `dist`, caché inmutable de 1 año en `/assets/*`).
3. No requiere variables de entorno ni funciones serverless.
