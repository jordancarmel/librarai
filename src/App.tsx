import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { BookMarked, ScanLine, BarChart3, Languages, Loader2 } from 'lucide-react';
import { Library } from './components/Library';
import { BookDetail } from './components/BookDetail';
import { useLibrary } from './lib/useLibrary';
import { loadSettings, saveSettings, type AppSettings } from './lib/storage';
import type { Book } from './types';
import { t, type Lang } from './lib/i18n';

// Charts and the html5-qrcode runtime are heavy — defer until those tabs open.
const Insights = lazy(() => import('./components/Insights').then((m) => ({ default: m.Insights })));
const Scanner = lazy(() => import('./components/Scanner').then((m) => ({ default: m.Scanner })));

const LazyFallback = () => (
  <div className="flex items-center justify-center py-20 text-slate-400">
    <Loader2 className="h-6 w-6 animate-spin" />
  </div>
);

type Tab = 'library' | 'scan' | 'insights';

export default function App() {
  const { books, addBook, removeBook, updateBook } = useLibrary();
  const [tab, setTab] = useState<Tab>(books.length ? 'library' : 'scan');
  const [openBookId, setOpenBookId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  // Persist and sync direction whenever language changes.
  useEffect(() => {
    saveSettings(settings);
    document.documentElement.lang = settings.language;
    document.documentElement.dir = settings.language === 'he' ? 'rtl' : 'ltr';
  }, [settings]);

  const lang: Lang = settings.language;
  const toggleLang = useCallback(
    () => setSettings((s) => ({ ...s, language: s.language === 'en' ? 'he' : 'en' })),
    [],
  );

  const handleScanned = useCallback(
    (book: Book) => {
      addBook(book);
    },
    [addBook],
  );

  const openBook = openBookId ? books.find((b) => b.id === openBookId) ?? null : null;

  const tabs: { key: Tab; icon: React.ReactNode; label: string }[] = [
    { key: 'library', icon: <BookMarked className="h-5 w-5" />, label: t(lang, 'tab.library') },
    { key: 'scan', icon: <ScanLine className="h-5 w-5" />, label: t(lang, 'tab.scan') },
    { key: 'insights', icon: <BarChart3 className="h-5 w-5" />, label: t(lang, 'tab.insights') },
  ];

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col">
      <header className="safe-top sticky top-0 z-30 flex items-center justify-between bg-ink-950/70 px-5 pb-3 pt-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent-500 to-indigo-600 shadow-lg shadow-indigo-900/40">
            <BookMarked className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight text-white">{t(lang, 'app.name')}</h1>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">
              Scan · Collect · Discover
            </p>
          </div>
        </div>
        <button
          onClick={toggleLang}
          className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/10 active:scale-95"
        >
          <Languages className="h-3.5 w-3.5" />
          {t(lang, 'lang.switch')}
        </button>
      </header>

      <main className="flex-1 px-5 pb-28 pt-2">
        {tab === 'library' && (
          <Library
            books={books}
            lang={lang}
            onOpen={(b) => setOpenBookId(b.id)}
            onGoScan={() => setTab('scan')}
          />
        )}
        {tab === 'scan' && (
          <Suspense fallback={<LazyFallback />}>
            <Scanner lang={lang} onBook={handleScanned} />
          </Suspense>
        )}
        {tab === 'insights' && (
          <Suspense fallback={<LazyFallback />}>
            <Insights books={books} lang={lang} />
          </Suspense>
        )}
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 mx-auto max-w-2xl px-3">
        <div className="glass flex items-center justify-around rounded-full p-1.5 shadow-2xl shadow-black/60">
          {tabs.map((t_) => {
            const active = tab === t_.key;
            return (
              <button
                key={t_.key}
                onClick={() => setTab(t_.key)}
                className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-full px-2 py-2 text-[11px] font-medium transition ${
                  active ? 'text-white' : 'text-slate-400'
                }`}
              >
                {active && (
                  <span className="absolute inset-0 rounded-full bg-gradient-to-br from-accent-500 to-indigo-600 shadow-lg shadow-indigo-900/40" />
                )}
                <span className="relative">{t_.icon}</span>
                <span className="relative">{t_.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {openBook && (
        <BookDetail
          book={openBook}
          lang={lang}
          onClose={() => setOpenBookId(null)}
          onUpdate={updateBook}
          onRemove={removeBook}
        />
      )}
    </div>
  );
}
