export type ReadingStatus = 'to-read' | 'reading' | 'read';

export interface Book {
  id: string;
  isbn13?: string;
  isbn10?: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publisher?: string;
  publishedYear?: number;
  publishedDate?: string;
  description?: string;
  pageCount?: number;
  categories: string[];
  language: string;
  thumbnail?: string;
  previewLink?: string;
  averageRating?: number;
  ratingsCount?: number;
  isHebrew: boolean;
  isIsraeliPublisher: boolean;
  addedAt: string;
  status: ReadingStatus;
  rating?: number;
  notes?: string;
  source: 'qr' | 'isbn' | 'manual';
}

export interface LibraryStats {
  total: number;
  read: number;
  reading: number;
  toRead: number;
  totalPages: number;
  hebrewCount: number;
  israeliCount: number;
  uniqueAuthors: number;
  uniqueLanguages: number;
  avgRating?: number;
}

export interface BreakdownItem {
  label: string;
  count: number;
}
