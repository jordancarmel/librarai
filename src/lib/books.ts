import type { Book } from '../types';
import { cleanIsbn, containsHebrew, extractIsbn, isIsraeliIsbn, isValidIsbn } from './isbn';

const GOOGLE = 'https://www.googleapis.com/books/v1/volumes';
const OPEN_LIBRARY = 'https://openlibrary.org';

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

async function fetchGoogleByQuery(q: string, signal?: AbortSignal): Promise<Book[]> {
  const res = await fetch(`${GOOGLE}?q=${encodeURIComponent(q)}&maxResults=10`, { signal });
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

/**
 * Look up a book by ISBN. Tries Google Books first (best Hebrew metadata), falls back
 * to Open Library, and finally returns a sparse Book stub if nothing else works so
 * users can still add the book and edit the details themselves.
 */
export async function lookupByIsbn(isbn: string, signal?: AbortSignal): Promise<Book> {
  const clean = cleanIsbn(isbn);
  if (!isValidIsbn(clean)) throw new BookLookupError('Invalid ISBN', 'invalid');
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
  // Last resort: search Google Books with the raw payload (e.g. QR contains book title)
  const results = await fetchGoogleByQuery(payload, signal);
  if (results.length) return { ...results[0], source: 'qr' };
  throw new BookLookupError('Could not resolve scanned code', 'not-found');
}

export async function searchBooks(query: string, signal?: AbortSignal): Promise<Book[]> {
  if (!query.trim()) return [];
  return fetchGoogleByQuery(query, signal);
}
