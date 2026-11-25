import type { LocalPdfDoc, LocalPdfMeta, SavedSignature } from '../types/pdf';

const DB_NAME = 'pdfstudio-local-db';
const DB_VERSION = 1;
const STORE_DOCS = 'documents';
const STORE_SIGNATURES = 'signatures';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DOCS)) {
        const store = db.createObjectStore(STORE_DOCS, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SIGNATURES)) {
        db.createObjectStore(STORE_SIGNATURES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalDoc(doc: LocalPdfDoc): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCS, 'readwrite');
    // Clonamos ArrayBuffer para evitar problemas si está detached
    const clonedBuffer = doc.data.slice(0);
    tx.objectStore(STORE_DOCS).put({ ...doc, data: clonedBuffer });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getLocalDoc(id: string): Promise<LocalPdfDoc | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCS, 'readonly');
    const req = tx.objectStore(STORE_DOCS).get(id);
    req.onsuccess = () => resolve((req.result as LocalPdfDoc) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function listLocalDocsMeta(): Promise<LocalPdfMeta[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCS, 'readonly');
    const store = tx.objectStore(STORE_DOCS);
    const results: LocalPdfMeta[] = [];
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const { data: _omit, ...meta } = cursor.value as LocalPdfDoc;
        results.push(meta);
        cursor.continue();
      } else {
        results.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(results);
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

export async function toggleStarDoc(id: string): Promise<boolean> {
  const doc = await getLocalDoc(id);
  if (!doc) return false;
  doc.starred = !doc.starred;
  await saveLocalDoc(doc);
  return doc.starred;
}

export async function deleteLocalDoc(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCS, 'readwrite');
    tx.objectStore(STORE_DOCS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllLocalDocs(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCS, 'readwrite');
    tx.objectStore(STORE_DOCS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveSignature(sig: SavedSignature): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SIGNATURES, 'readwrite');
    tx.objectStore(STORE_SIGNATURES).put(sig);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listSignatures(): Promise<SavedSignature[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SIGNATURES, 'readonly');
    const req = tx.objectStore(STORE_SIGNATURES).getAll();
    req.onsuccess = () => {
      const list = (req.result as SavedSignature[]) ?? [];
      list.sort((a, b) => b.createdAt - a.createdAt);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteSignature(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SIGNATURES, 'readwrite');
    tx.objectStore(STORE_SIGNATURES).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getLocalStorageUsage(): Promise<{
  docsBytes: number;
  quotaBytes: number;
  usedTotalBytes: number;
}> {
  const docs = await listLocalDocsMeta();
  const docsBytes = docs.reduce((acc, d) => acc + (d.size || 0), 0);
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      return {
        docsBytes,
        quotaBytes: est.quota ?? 500 * 1024 * 1024,
        usedTotalBytes: est.usage ?? docsBytes,
      };
    } catch {
      // Fallback
    }
  }
  return {
    docsBytes,
    quotaBytes: 500 * 1024 * 1024,
    usedTotalBytes: docsBytes,
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, exp);
  return `${val >= 10 || exp === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[exp]}`;
}

export function formatRelativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Hace un momento';
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Hace ${days} d`;
  return new Date(ts).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

export function downloadUint8Array(data: Uint8Array, filename: string, mime = 'application/pdf'): void {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  downloadBlob(new Blob([copy], { type: mime }), filename);
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
