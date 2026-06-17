import { useMemo, useState } from 'react';
import { Search, BookMarked, Sparkles } from 'lucide-react';
import type { Book, ReadingStatus } from '../types';
import { BookCover } from './BookCover';
import { t, type Lang } from '../lib/i18n';
import { containsHebrew } from '../lib/isbn';

type Filter = 'all' | ReadingStatus | 'hebrew';

interface LibraryProps {
  books: Book[];
  lang: Lang;
  onOpen: (book: Book) => void;
  onGoScan: () => void;
}

export function Library({ books, lang, onOpen, onGoScan }: LibraryProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    let list = books;
    if (filter !== 'all') {
      if (filter === 'hebrew') list = list.filter((b) => b.isHebrew || containsHebrew(b.title));
      else list = list.filter((b) => b.status === filter);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.authors.some((a) => a.toLowerCase().includes(q)) ||
          b.categories.some((c) => c.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [books, filter, query]);

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: t(lang, 'library.filter.all') },
    { key: 'reading', label: t(lang, 'library.filter.reading') },
    { key: 'to-read', label: t(lang, 'library.filter.toRead') },
    { key: 'read', label: t(lang, 'library.filter.read') },
    { key: 'hebrew', label: t(lang, 'library.filter.hebrew') },
  ];

  if (!books.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-5 px-6 py-20 text-center animate-fade-in">
        <div className="relative">
          <span className="absolute inset-0 rounded-full bg-accent-500/30 animate-pulse-ring" />
          <div className="relative grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-accent-500 to-indigo-700 shadow-2xl shadow-indigo-900/50">
            <BookMarked className="h-10 w-10 text-white" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-white">{t(lang, 'library.empty.title')}</h2>
        <p className="max-w-xs text-sm text-slate-400">{t(lang, 'library.empty.body')}</p>
        <button onClick={onGoScan} className="btn-primary">
          <Sparkles className="h-4 w-4" />
          {t(lang, 'library.empty.cta')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">{t(lang, 'tab.library')}</h2>
          <p className="text-sm text-slate-400">
            {books.length} {t(lang, books.length === 1 ? 'library.count.one' : 'library.count')}
          </p>
        </div>
      </header>

      <div className="relative">
        <Search className="absolute top-1/2 ms-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, 'library.search')}
          className="w-full rounded-2xl bg-white/5 py-3 ps-10 pe-4 text-sm text-white ring-1 ring-inset ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-accent-500"
        />
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [-ms-overflow-style:'none'] [scrollbar-width:none]">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
              filter === f.key
                ? 'bg-accent-500 text-white ring-accent-400 shadow-lg shadow-accent-900/40'
                : 'bg-white/5 text-slate-300 ring-white/10'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="px-2 py-8 text-center text-sm text-slate-500">No matches.</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {filtered.map((b) => (
            <button
              key={b.id}
              onClick={() => onOpen(b)}
              className="group flex flex-col gap-1.5 text-left transition active:scale-95"
            >
              <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl shadow-lg shadow-black/60 ring-1 ring-white/5">
                <BookCover book={b} />
                {b.status === 'read' && (
                  <span className="absolute top-1.5 right-1.5 rounded-full bg-emerald-500/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                    ✓
                  </span>
                )}
                {b.status === 'reading' && (
                  <span className="absolute top-1.5 right-1.5 rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                    •
                  </span>
                )}
              </div>
              <p
                className="line-clamp-2 text-[11px] font-medium leading-tight text-slate-200"
                dir={b.isHebrew ? 'rtl' : 'ltr'}
              >
                {b.title}
              </p>
              {b.authors[0] && (
                <p
                  className="line-clamp-1 text-[10px] text-slate-500"
                  dir={containsHebrew(b.authors[0]) ? 'rtl' : 'ltr'}
                >
                  {b.authors[0]}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
