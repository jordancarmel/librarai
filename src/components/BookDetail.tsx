import { useEffect, useState } from 'react';
import { X, Trash2, Star, ExternalLink } from 'lucide-react';
import type { Book, ReadingStatus } from '../types';
import { BookCover } from './BookCover';
import { t, type Lang } from '../lib/i18n';
import { langName } from '../lib/insights';
import { containsHebrew } from '../lib/isbn';

interface BookDetailProps {
  book: Book;
  lang: Lang;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<Book>) => void;
  onRemove: (id: string) => void;
}

export function BookDetail({ book, lang, onClose, onUpdate, onRemove }: BookDetailProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [notes, setNotes] = useState(book.notes ?? '');

  useEffect(() => {
    setNotes(book.notes ?? '');
  }, [book.id, book.notes]);

  // Persist notes on a short debounce so users don't lose input when closing the sheet.
  useEffect(() => {
    const id = setTimeout(() => {
      if (notes !== (book.notes ?? '')) onUpdate(book.id, { notes });
    }, 400);
    return () => clearTimeout(id);
  }, [notes, book.id, book.notes, onUpdate]);

  const statuses: { key: ReadingStatus; label: string; color: string }[] = [
    { key: 'to-read', label: t(lang, 'book.status.toRead'), color: 'bg-slate-600' },
    { key: 'reading', label: t(lang, 'book.status.reading'), color: 'bg-amber-500' },
    { key: 'read', label: t(lang, 'book.status.read'), color: 'bg-emerald-500' },
  ];

  const titleDir = book.isHebrew || containsHebrew(book.title) ? 'rtl' : 'ltr';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-ink-900 shadow-2xl shadow-black/80 ring-1 ring-white/10 animate-slide-up sm:mb-8 sm:max-w-lg sm:rounded-3xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between bg-ink-900/90 px-4 py-3 backdrop-blur">
          <button onClick={onClose} className="rounded-full bg-white/5 p-2 text-slate-300 ring-1 ring-white/10">
            <X className="h-4 w-4" />
          </button>
          <span className="text-xs uppercase tracking-widest text-slate-500">{t(lang, 'app.name')}</span>
          <button
            onClick={() => setConfirmRemove(true)}
            className="rounded-full bg-rose-500/10 p-2 text-rose-300 ring-1 ring-rose-400/30"
            aria-label={t(lang, 'book.remove')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pb-8">
          <div className="flex gap-4">
            <div className="h-44 w-28 shrink-0 overflow-hidden rounded-xl shadow-2xl shadow-black/60 ring-1 ring-white/10">
              <BookCover book={book} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-white" dir={titleDir}>
                {book.title}
              </h2>
              {book.subtitle && (
                <p className="mt-0.5 text-sm text-slate-400" dir={titleDir}>
                  {book.subtitle}
                </p>
              )}
              {book.authors.length > 0 && (
                <p
                  className="mt-2 text-sm text-slate-300"
                  dir={containsHebrew(book.authors.join(' ')) ? 'rtl' : 'ltr'}
                >
                  {t(lang, 'book.author')} {book.authors.join(', ')}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {book.isIsraeliPublisher && <span className="pill">🇮🇱 Israeli</span>}
                {book.language && <span className="pill">{langName(book.language)}</span>}
                {book.pageCount && (
                  <span className="pill">
                    {book.pageCount} {t(lang, 'book.pages')}
                  </span>
                )}
                {book.publishedYear && <span className="pill">{book.publishedYear}</span>}
              </div>
            </div>
          </div>

          <section className="mt-6">
            <div className="flex gap-2">
              {statuses.map((s) => (
                <button
                  key={s.key}
                  onClick={() => onUpdate(book.id, { status: s.key })}
                  className={`flex-1 rounded-2xl px-3 py-2.5 text-sm font-medium transition ${
                    book.status === s.key
                      ? `${s.color} text-white shadow-lg`
                      : 'bg-white/5 text-slate-300 ring-1 ring-white/10'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </section>

          <section className="mt-6">
            <h3 className="mb-2 text-sm font-medium text-slate-400">{t(lang, 'book.rate')}</h3>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => {
                const active = (book.rating ?? 0) >= n;
                return (
                  <button
                    key={n}
                    onClick={() => onUpdate(book.id, { rating: book.rating === n ? undefined : n })}
                    aria-label={`Rate ${n}`}
                    className="p-1"
                  >
                    <Star
                      className={`h-7 w-7 transition ${
                        active ? 'fill-amber-400 text-amber-400' : 'text-slate-600'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </section>

          {book.description && (
            <section className="mt-6">
              <h3 className="mb-2 text-sm font-medium text-slate-400">About</h3>
              <p
                className="text-sm leading-relaxed text-slate-300"
                dir={containsHebrew(book.description) ? 'rtl' : 'ltr'}
              >
                {book.description.replace(/<[^>]+>/g, '')}
              </p>
            </section>
          )}

          <section className="mt-6">
            <h3 className="mb-2 text-sm font-medium text-slate-400">{t(lang, 'book.notes')}</h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t(lang, 'book.notes.placeholder')}
              rows={4}
              className="w-full resize-none rounded-2xl bg-white/5 px-4 py-3 text-sm text-white ring-1 ring-inset ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-accent-500"
            />
          </section>

          <section className="mt-6 space-y-1.5 text-xs text-slate-400">
            {book.publisher && (
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">{t(lang, 'book.publisher')}</span>
                <span dir={containsHebrew(book.publisher) ? 'rtl' : 'ltr'}>{book.publisher}</span>
              </div>
            )}
            {book.publishedDate && (
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">{t(lang, 'book.published')}</span>
                <span>{book.publishedDate}</span>
              </div>
            )}
            {book.isbn13 && (
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">ISBN-13</span>
                <span dir="ltr">{book.isbn13}</span>
              </div>
            )}
            {book.categories.length > 0 && (
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Categories</span>
                <span className="text-right">{book.categories.join(', ')}</span>
              </div>
            )}
          </section>

          {book.previewLink && (
            <a
              href={book.previewLink}
              target="_blank"
              rel="noreferrer noopener"
              className="btn-ghost mt-6 w-full"
            >
              <ExternalLink className="h-4 w-4" />
              {t(lang, 'book.preview')}
            </a>
          )}
        </div>

        {confirmRemove && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink-950/90 p-6 backdrop-blur">
            <div className="w-full max-w-sm rounded-2xl bg-ink-800 p-5 ring-1 ring-white/10">
              <p className="text-base font-medium text-white">{t(lang, 'book.remove')}?</p>
              <p className="mt-1 line-clamp-2 text-sm text-slate-400" dir={titleDir}>
                {book.title}
              </p>
              <div className="mt-4 flex gap-2">
                <button onClick={() => setConfirmRemove(false)} className="btn-ghost flex-1">
                  {t(lang, 'common.cancel')}
                </button>
                <button
                  onClick={() => {
                    onRemove(book.id);
                    onClose();
                  }}
                  className="flex-1 rounded-2xl bg-rose-500 px-4 py-2.5 font-semibold text-white shadow-lg shadow-rose-900/40 active:scale-[0.98]"
                >
                  {t(lang, 'common.confirm')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
