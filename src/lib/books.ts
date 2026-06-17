import type { Book } from '../types';
import { cleanIsbn, containsHebrew, extractIsbn, isIsraeliIsbn, isValidIsbn } from './isbn';
import { loadSettings } from './storage';

const GOOGLE = 'https://www.googleapis.com/books/v1/volumes';
const OPEN_LIBRARY = 'https://openlibrary.org';
const NLI = 'https://api.nli.org.il/openlibrary/search';

interface GoogleVolume {
  id: string;
  volumeInfo: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    pageCount?: number;
    categories?: string[];
    language?: string;
    imageLinks?: {
      smallThumbnail?: string;
      thumbnail?: string;
      small?: string;
      medium?: string;
      large?: string;
    };
    previewLink?: string;
    averageRating?: number;
    ratingsCount?: number;
    industryIdentifiers?: { type: string; identifier: string }[];
  };
}

export class BookLookupError extends Error {
  constructor(message: string, public readonly code: 'not-found' | 'network' | 'invalid') {
    super(message);
  }
}

function upgradeThumbnail(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.replace('http://', 'https://').replace('&edge=curl', '').replace('zoom=1', 'zoom=2');
}

function yearFromDate(d?: string): number | undefined {
  if (!d) return undefined;
  const m = d.match(/^(\d{4})/);
  return m ? Number(m[1]) : undefined;
}

function googleVolumeToBook(v: GoogleVolume, source: Book['source']): Book {
  const info = v.volumeInfo ?? {};
  const isbns = info.industryIdentifiers ?? [];
  const isbn13 = isbns.find((i) => i.type === 'ISBN_13')?.identifier;
  const isbn10 = isbns.find((i) => i.type === 'ISBN_10')?.identifier;
  const title = info.title ?? 'Untitled';
  const hebrew = info.language === 'he' || containsHebrew(title) || containsHebrew(info.subtitle);
  const israeli = (isbn13 && isIsraeliIsbn(isbn13)) || (isbn10 && isIsraeliIsbn(isbn10)) || hebrew;

  return {
    id: v.id || isbn13 || isbn10 || crypto.randomUUID(),
    isbn13: isbn13 ? cleanIsbn(isbn13) : undefined,
    isbn10: isbn10 ? cleanIsbn(isbn10) : undefined,
    title,
    subtitle: info.subtitle,
    authors: info.authors ?? [],
    publisher: info.publisher,
    publishedDate: info.publishedDate,
    publishedYear: yearFromDate(info.publishedDate),
    description: info.description,
    pageCount: info.pageCount,
    categories: info.categories ?? [],
    language: info.language ?? (hebrew ? 'he' : 'en'),
    thumbnail: upgradeThumbnail(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail),
    previewLink: info.previewLink,
    averageRating: info.averageRating,
    ratingsCount: info.ratingsCount,
    isHebrew: !!hebrew,
    isIsraeliPublisher: !!israeli,
    addedAt: new Date().toISOString(),
    status: 'to-read',
    source,
  };
}

async function fetchGoogleByIsbn(isbn: string, signal?: AbortSignal): Promise<Book | null> {
  // Add langRestrict to bias toward Hebrew metadata when the ISBN is Israeli — gives
  // better Hebrew titles than the English-leaning default.
  const israeli = isIsraeliIsbn(isbn);
  const params = new URLSearchParams({
    q: `isbn:${isbn}`,
    maxResults: '1',
    ...(israeli ? { langRestrict: 'he' } : {}),
  });
  const res = await fetch(`${GOOGLE}?${params.toString()}`, { signal });
  if (!res.ok) throw new BookLookupError('Google Books request failed', 'network');
  const data = (await res.json()) as { items?: GoogleVolume[] };
  if (!data.items?.length) {
    // Retry without langRestrict in case Hebrew metadata is missing.
    if (israeli) {
      const retry = await fetch(`${GOOGLE}?q=isbn:${isbn}&maxResults=1`, { signal });
      if (!retry.ok) return null;
      const d2 = (await retry.json()) as { items?: GoogleVolume[] };
      if (!d2.items?.length) return null;
      return googleVolumeToBook(d2.items[0], 'isbn');
    }
    return null;
  }
  return googleVolumeToBook(data.items[0], 'isbn');
}

async function fetchGoogleByQuery(
  q: string,
  opts: { lang?: string; signal?: AbortSignal } = {},
): Promise<Book[]> {
  const params = new URLSearchParams({ q, maxResults: '12' });
  if (opts.lang) params.set('langRestrict', opts.lang);
  const res = await fetch(`${GOOGLE}?${params.toString()}`, { signal: opts.signal });
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: GoogleVolume[] };
  return (data.items ?? []).map((v) => googleVolumeToBook(v, 'manual'));
}

interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  publisher?: string[];
  first_publish_year?: number;
  language?: string[];
  number_of_pages_median?: number;
  subject?: string[];
  cover_i?: number;
  isbn?: string[];
}

async function fetchOpenLibraryByIsbn(isbn: string, signal?: AbortSignal): Promise<Book | null> {
  const res = await fetch(`${OPEN_LIBRARY}/search.json?isbn=${isbn}`, { signal });
  if (!res.ok) return null;
  const data = (await res.json()) as { docs?: OpenLibraryDoc[] };
  const doc = data.docs?.[0];
  if (!doc) return null;
  const hebrew =
    doc.language?.includes('heb') ||
    containsHebrew(doc.title) ||
    (doc.author_name?.some((a) => containsHebrew(a)) ?? false);
  const isbn13 = doc.isbn?.find((i) => i.length === 13) ?? (isbn.length === 13 ? isbn : undefined);
  const isbn10 = doc.isbn?.find((i) => i.length === 10) ?? (isbn.length === 10 ? isbn : undefined);
  return {
    id: isbn13 || isbn10 || crypto.randomUUID(),
    isbn13,
    isbn10,
    title: doc.title ?? 'Untitled',
    authors: doc.author_name ?? [],
    publisher: doc.publisher?.[0],
    publishedYear: doc.first_publish_year,
    pageCount: doc.number_of_pages_median,
    categories: (doc.subject ?? []).slice(0, 5),
    language: hebrew ? 'he' : doc.language?.[0] ?? 'en',
    thumbnail: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : undefined,
    isHebrew: hebrew,
    isIsraeliPublisher: isIsraeliIsbn(isbn) || hebrew,
    addedAt: new Date().toISOString(),
    status: 'to-read',
    source: 'isbn',
  };
}

interface NliRecord {
  // The NLI Open Library API returns MARC-flavoured records. Field names vary by
  // endpoint version; we try several common keys so the parser survives upstream tweaks.
  title?: string | string[];
  creator?: string | string[];
  author?: string | string[];
  publisher?: string | string[];
  date?: string | string[];
  language?: string | string[];
  isbn?: string | string[];
  thumbnail?: string;
  '@title'?: string;
  '@creator'?: string;
  [key: string]: unknown;
}

function pickFirst(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length) return typeof v[0] === 'string' ? v[0] : undefined;
  return undefined;
}

function pickAll(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

function nliRecordToBook(rec: NliRecord, fallbackIsbn: string): Book | null {
  const title =
    pickFirst(rec.title) ?? pickFirst(rec['@title']) ?? pickFirst((rec as Record<string, unknown>).Title);
  if (!title) return null;
  const authors = pickAll(rec.creator).concat(pickAll(rec.author));
  const publisher = pickFirst(rec.publisher);
  const date = pickFirst(rec.date);
  const lang = pickFirst(rec.language);
  const isbn13 = pickAll(rec.isbn).find((s) => /^\d{13}$/.test(s)) ?? (fallbackIsbn.length === 13 ? fallbackIsbn : undefined);
  const isbn10 = pickAll(rec.isbn).find((s) => /^\d{9}[\dX]$/i.test(s)) ?? (fallbackIsbn.length === 10 ? fallbackIsbn : undefined);
  const hebrew = lang === 'heb' || lang === 'he' || containsHebrew(title) || authors.some((a) => containsHebrew(a));
  const israeli = (isbn13 && isIsraeliIsbn(isbn13)) || (isbn10 && isIsraeliIsbn(isbn10)) || hebrew;

  return {
    id: isbn13 || isbn10 || `nli-${fallbackIsbn}`,
    isbn13,
    isbn10,
    title,
    authors,
    publisher,
    publishedDate: date,
    publishedYear: yearFromDate(date),
    categories: [],
    language: hebrew ? 'he' : lang ?? 'en',
    thumbnail: rec.thumbnail,
    isHebrew: !!hebrew,
    isIsraeliPublisher: !!israeli,
    addedAt: new Date().toISOString(),
    status: 'to-read',
    source: 'isbn',
  };
}

async function fetchNliByIsbn(isbn: string, signal?: AbortSignal): Promise<Book | null> {
  const apiKey = loadSettings().nliApiKey?.trim();
  if (!apiKey) return null;
  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      query: `any,contains,${isbn}`,
      output_format: 'json',
      material_type: 'books',
    });
    const res = await fetch(`${NLI}?${params.toString()}`, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    // Best-effort: the JSON envelope shape isn't tightly documented. Walk likely
    // arrays and try to parse the first record that contains a title.
    const recordArrays = collectRecordArrays(data);
    for (const arr of recordArrays) {
      for (const rec of arr) {
        const book = nliRecordToBook(rec, isbn);
        if (book) return book;
      }
    }
    return null;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return null;
  }
}

function collectRecordArrays(data: unknown): NliRecord[][] {
  const out: NliRecord[][] = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      if (node.length && typeof node[0] === 'object' && node[0]) {
        out.push(node as NliRecord[]);
      }
      for (const child of node) visit(child);
    } else if (typeof node === 'object') {
      for (const v of Object.values(node as Record<string, unknown>)) visit(v);
    }
  };
  visit(data);
  return out;
}

/**
 * Look up a book by ISBN. For Israeli ISBNs with an NLI key configured, NLI is tried
 * first (best Hebrew metadata). Otherwise Google Books, then Open Library, with a
 * not-found at the end so the caller can show a search fallback.
 */
export async function lookupByIsbn(isbn: string, signal?: AbortSignal): Promise<Book> {
  const clean = cleanIsbn(isbn);
  if (!isValidIsbn(clean)) throw new BookLookupError('Invalid ISBN', 'invalid');
  if (isIsraeliIsbn(clean)) {
    try {
      const n = await fetchNliByIsbn(clean, signal);
      if (n) return n;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
    }
  }
  try {
    const g = await fetchGoogleByIsbn(clean, signal);
    if (g) return g;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    // fall through to Open Library
  }
  try {
    const o = await fetchOpenLibraryByIsbn(clean, signal);
    if (o) return o;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
  }
  throw new BookLookupError('Book not found', 'not-found');
}

interface WorkerHit {
  title?: string;
  authors?: string[];
  publisher?: string;
  source?: string;
  sourceUrl?: string;
  thumbnail?: string;
}

async function fetchFromWorker(barcode: string, signal?: AbortSignal): Promise<Book | null> {
  const workerUrl = loadSettings().lookupWorkerUrl?.trim();
  if (!workerUrl) return null;
  const base = workerUrl.replace(/\/+$/, '');
  if (!/^\d{6,14}$/.test(barcode)) return null;
  try {
    const res = await fetch(`${base}/lookup?barcode=${encodeURIComponent(barcode)}`, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as WorkerHit;
    if (!data.title) return null;
    // Enrich the rough title/author with Google Books for clean metadata + cover art.
    const author = data.authors?.[0];
    const enrichQuery = author
      ? `intitle:"${data.title}" inauthor:"${author}"`
      : `intitle:"${data.title}"`;
    try {
      const enriched = await fetchGoogleByQuery(enrichQuery, { lang: 'he', signal });
      if (enriched.length) return { ...enriched[0], source: 'qr' };
    } catch {
      // Google Books failed — fall through to a stub built from worker data.
    }
    // No Google Books match; assemble a minimal Book from what the worker found.
    return {
      id: `worker-${barcode}`,
      title: data.title,
      authors: data.authors ?? [],
      publisher: data.publisher,
      categories: [],
      language: 'he',
      thumbnail: data.thumbnail,
      isHebrew: containsHebrew(data.title),
      isIsraeliPublisher: true,
      addedAt: new Date().toISOString(),
      status: 'to-read',
      source: 'qr',
    };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return null;
  }
}

/**
 * Resolve any raw scanner payload (QR or barcode) into a Book.
 */
export async function lookupFromScan(payload: string, signal?: AbortSignal): Promise<Book> {
  const direct = extractIsbn(payload);
  if (direct) {
    const b = await lookupByIsbn(direct, signal);
    return { ...b, source: 'qr' };
  }
  // Maybe the QR is a URL — extract the ISBN-like substring from the URL.
  try {
    const u = new URL(payload);
    const fromUrl = extractIsbn(u.pathname + ' ' + u.search);
    if (fromUrl) {
      const b = await lookupByIsbn(fromUrl, signal);
      return { ...b, source: 'qr' };
    }
  } catch {
    // not a URL
  }
  // Non-ISBN numeric barcodes (Israeli publisher SKUs and similar) → try the
  // user's Cloudflare Worker if configured.
  const fromWorker = await fetchFromWorker(payload, signal);
  if (fromWorker) return fromWorker;
  // Last resort: search Google Books with the raw payload (e.g. QR contains book title)
  const results = await fetchGoogleByQuery(payload, { signal });
  if (results.length) return { ...results[0], source: 'qr' };
  throw new BookLookupError('Could not resolve scanned code', 'not-found');
}

export async function searchBooks(
  query: string,
  opts: { lang?: string; signal?: AbortSignal } = {},
): Promise<Book[]> {
  if (!query.trim()) return [];
  // Auto-bias toward Hebrew metadata when the query itself contains Hebrew characters —
  // produces noticeably better hits for Israeli book titles.
  const lang = opts.lang ?? (containsHebrew(query) ? 'he' : undefined);
  return fetchGoogleByQuery(query, { lang, signal: opts.signal });
}
