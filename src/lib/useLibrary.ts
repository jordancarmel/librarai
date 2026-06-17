import { useCallback, useEffect, useState } from 'react';
import type { Book, ReadingStatus } from '../types';
import { loadLibrary, saveLibrary } from './storage';

export function useLibrary() {
  const [books, setBooks] = useState<Book[]>(() => loadLibrary());

  useEffect(() => {
    saveLibrary(books);
  }, [books]);

  const addBook = useCallback((book: Book) => {
    setBooks((prev) => {
      // Dedup by ISBN13 or by id
      const existing = prev.find(
        (b) =>
          (book.isbn13 && b.isbn13 === book.isbn13) ||
          (book.isbn10 && b.isbn10 === book.isbn10) ||
          b.id === book.id,
      );
      if (existing) {
        return prev.map((b) => (b.id === existing.id ? { ...existing, ...book, id: existing.id, addedAt: existing.addedAt } : b));
      }
      return [book, ...prev];
    });
  }, []);

  const removeBook = useCallback((id: string) => {
    setBooks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const updateBook = useCallback((id: string, patch: Partial<Book>) => {
    setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const setStatus = useCallback((id: string, status: ReadingStatus) => {
    setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, status } : b)));
  }, []);

  const setRating = useCallback((id: string, rating: number | undefined) => {
    setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, rating } : b)));
  }, []);

  const findByIsbn = useCallback(
    (isbn: string) => {
      const clean = isbn.replace(/[-\s]/g, '');
      return books.find((b) => b.isbn13 === clean || b.isbn10 === clean);
    },
    [books],
  );

  return { books, addBook, removeBook, updateBook, setStatus, setRating, findByIsbn };
}
