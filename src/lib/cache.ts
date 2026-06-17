// Persistent barcode → Book cache. Lets non-ISBN POS barcodes (Israeli publisher
// SKUs that no public DB indexes) auto-resolve on second scan after the user has
// matched them once via the title-search or cover-OCR fallback.
import type { Book } from '../types';

const KEY = 'librarai.barcode-cache.v1';

type CacheMap = Record<string, Book>;

function read(): CacheMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as CacheMap) : {};
  } catch {
    return {};
  }
}

function write(m: CacheMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    // quota — ignore
  }
}

export function getCachedBarcode(barcode: string): Book | null {
  if (!barcode) return null;
  const m = read();
  return m[barcode] ?? null;
}

export function setCachedBarcode(barcode: string, book: Book): void {
  if (!barcode) return;
  const m = read();
  m[barcode] = book;
  write(m);
}

export function clearCachedBarcode(barcode: string): void {
  const m = read();
  if (m[barcode]) {
    delete m[barcode];
    write(m);
  }
}
