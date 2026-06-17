import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeScannerState, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import {
  Camera,
  Loader2,
  ScanLine,
  KeyRound,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  X,
  Search,
  Plus,
  ZoomIn,
} from 'lucide-react';
import type { Book } from '../types';
import { BookCover } from './BookCover';
import { lookupByIsbn, lookupFromScan, searchBooks, BookLookupError } from '../lib/books';
import { cleanIsbn, containsHebrew, isValidIsbn } from '../lib/isbn';
import { t, type Lang } from '../lib/i18n';

interface ScannerProps {
  lang: Lang;
  onBook: (book: Book) => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'looking-up'; payload: string }
  | { kind: 'success'; book: Book }
  | { kind: 'error'; message: string }
  | { kind: 'search'; payload?: string };

interface ZoomCap {
  min: number;
  max: number;
  step: number;
  current: number;
}

const SCANNER_ID = 'qr-reader';

export function Scanner({ lang, onBook }: ScannerProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [manualIsbn, setManualIsbn] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Book[]>([]);
  const [searching, setSearching] = useState(false);
  const [zoom, setZoom] = useState<ZoomCap | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const handledPayloadRef = useRef<string | null>(null);

  const stopCamera = useCallback(async () => {
    const s = scannerRef.current;
    setZoom(null);
    if (!s) return;
    try {
      if (s.getState() === Html5QrcodeScannerState.SCANNING) {
        await s.stop();
      }
      await s.clear();
    } catch {
      // ignore
    }
  }, []);

  const openSearch = useCallback((payload?: string) => {
    setSearchResults([]);
    // Pre-fill the search box only if the failed payload has letters — pure numeric
    // codes (barcodes) make terrible search queries.
    setSearchQuery(payload && /[A-Za-z֐-׿]/.test(payload) ? payload : '');
    setState({ kind: 'search', payload });
  }, []);

  const handlePayload = useCallback(
    async (payload: string) => {
      if (handledPayloadRef.current === payload) return;
      handledPayloadRef.current = payload;
      lookupAbortRef.current?.abort();
      const ac = new AbortController();
      lookupAbortRef.current = ac;
      setState({ kind: 'looking-up', payload });
      await stopCamera();
      try {
        const book = await lookupFromScan(payload, ac.signal);
        onBook(book);
        setState({ kind: 'success', book });
      } catch (e) {
        const err = e as BookLookupError | Error;
        if (err.name === 'AbortError') return;
        const code = (err as BookLookupError).code;
        if (code === 'not-found') {
          openSearch(payload);
          return;
        }
        setState({
          kind: 'error',
          message: code === 'invalid' ? t(lang, 'scan.error.invalid') : err.message,
        });
      }
    },
    [lang, onBook, openSearch, stopCamera],
  );

  const applyZoom = useCallback((value: number) => {
    const s = scannerRef.current;
    if (!s) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const caps = (s as any).getRunningTrackCameraCapabilities?.();
      const zoomFeature = caps?.zoomFeature?.();
      if (zoomFeature?.isSupported?.()) {
        zoomFeature.apply(value);
        setZoom((prev) => (prev ? { ...prev, current: value } : prev));
      }
    } catch {
      // ignore
    }
  }, []);

  const startCamera = useCallback(async () => {
    handledPayloadRef.current = null;
    setState({ kind: 'scanning' });

    // Browsers require a secure context (HTTPS or localhost) for getUserMedia.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setState({ kind: 'error', message: t(lang, 'scan.error.https') });
      return;
    }

    try {
      const instance = new Html5Qrcode(SCANNER_ID, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
        ],
        verbose: false,
        // Native BarcodeDetector on Chromium-based browsers — drastically better
        // decode rate and works alongside the camera's own autofocus pipeline.
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      });
      scannerRef.current = instance;

      // Request continuous autofocus via advanced MediaTrackConstraints.
      // Android Chrome/Firefox honour this; iOS Safari ignores it but already
      // does continuous AF by default.
      const cameraConfig = {
        facingMode: { ideal: 'environment' },
        advanced: [{ focusMode: 'continuous' }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      await instance.start(
        cameraConfig,
        {
          fps: 15,
          // Wider, shorter viewfinder optimised for 1D barcodes rather than QR squares.
          qrbox: (vw, vh) => {
            const w = Math.floor(Math.min(vw, vh) * 0.85);
            const h = Math.max(110, Math.floor(w * 0.55));
            return { width: w, height: h };
          },
          aspectRatio: window.innerHeight / window.innerWidth > 1.4 ? 1.7777 : 1.3333,
        },
        (decoded) => {
          void handlePayload(decoded);
        },
        () => {
          // ignore per-frame decode failures — they fire constantly
        },
      );

      // Re-apply autofocus after start; some browsers only honour it on a live track.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (instance as any).applyVideoConstraints({
          advanced: [{ focusMode: 'continuous' }],
        });
      } catch {
        // unsupported — fine
      }

      // Detect zoom capability and expose a slider so the user can frame the barcode
      // tightly without crossing the lens minimum focus distance.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const caps = (instance as any).getRunningTrackCameraCapabilities?.();
        const zoomFeature = caps?.zoomFeature?.();
        if (zoomFeature?.isSupported?.()) {
          const min = Number(zoomFeature.min?.() ?? 1);
          const max = Number(zoomFeature.max?.() ?? 1);
          const step = Number(zoomFeature.step?.() || 0.1);
          const current = Number(zoomFeature.value?.() ?? min);
          if (max > min) setZoom({ min, max, step: step || 0.1, current });
        }
      } catch {
        // unsupported — no zoom UI
      }
    } catch (e) {
      const err = e as Error;
      const msg = /permission|denied|NotAllowed/i.test(err.message)
        ? t(lang, 'scan.error.camera')
        : err.message || t(lang, 'scan.error.camera');
      setState({ kind: 'error', message: msg });
    }
  }, [handlePayload, lang]);

  useEffect(() => {
    return () => {
      void stopCamera();
      lookupAbortRef.current?.abort();
      searchAbortRef.current?.abort();
    };
  }, [stopCamera]);

  const handleManualSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const isbn = cleanIsbn(manualIsbn);
      if (!isValidIsbn(isbn)) {
        setState({ kind: 'error', message: t(lang, 'scan.error.invalid') });
        return;
      }
      setState({ kind: 'looking-up', payload: isbn });
      try {
        const book = await lookupByIsbn(isbn);
        onBook(book);
        setState({ kind: 'success', book });
        setManualIsbn('');
      } catch (e) {
        const err = e as BookLookupError;
        if (err.code === 'not-found') {
          openSearch(isbn);
          return;
        }
        setState({ kind: 'error', message: err.message });
      }
    },
    [lang, manualIsbn, onBook, openSearch],
  );

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    searchAbortRef.current?.abort();
    const ac = new AbortController();
    searchAbortRef.current = ac;
    setSearching(true);
    try {
      const results = await searchBooks(q, {
        lang: containsHebrew(q) ? 'he' : undefined,
        signal: ac.signal,
      });
      setSearchResults(results);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const reset = useCallback(() => {
    setState({ kind: 'idle' });
    setSearchQuery('');
    setSearchResults([]);
  }, []);

  const onPickResult = useCallback(
    (book: Book) => {
      const tagged: Book = { ...book, source: 'manual' };
      onBook(tagged);
      setState({ kind: 'success', book: tagged });
    },
    [onBook],
  );

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <header>
        <h2 className="text-2xl font-bold text-white">{t(lang, 'scan.title')}</h2>
        <p className="mt-1 text-sm text-slate-400">{t(lang, 'scan.subtitle')}</p>
      </header>

      {state.kind === 'search' ? (
        <SearchFallback
          lang={lang}
          payload={state.payload}
          query={searchQuery}
          setQuery={setSearchQuery}
          results={searchResults}
          searching={searching}
          onSubmit={() => void runSearch(searchQuery)}
          onPick={onPickResult}
          onCancel={reset}
        />
      ) : (
        <>
          <div className="card relative overflow-hidden">
            <div
              id={SCANNER_ID}
              className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black/60"
            />
            {state.kind === 'scanning' && (
              <>
                <div className="pointer-events-none absolute inset-5 flex items-center justify-center">
                  <div className="relative h-40 w-[85%] rounded-2xl border-2 border-accent-400/70 shadow-[0_0_0_4000px_rgba(0,0,0,0.35)]">
                    <div className="absolute inset-x-0 top-0 h-0.5 animate-scan-line bg-accent-400 shadow-[0_0_20px_2px_rgba(167,139,250,0.9)]" />
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 rounded-full bg-accent-500/90 px-3 py-1 text-xs font-semibold text-white shadow-lg">
                      <ScanLine className="me-1 inline h-3.5 w-3.5" /> Aim at barcode
                    </div>
                  </div>
                </div>
                {zoom && (
                  <div className="absolute inset-x-5 bottom-3 flex items-center gap-3 rounded-full bg-black/55 px-3 py-2 backdrop-blur">
                    <ZoomIn className="h-4 w-4 text-white/90" />
                    <input
                      type="range"
                      min={zoom.min}
                      max={zoom.max}
                      step={zoom.step}
                      value={zoom.current}
                      onChange={(e) => applyZoom(Number(e.target.value))}
                      className="flex-1 accent-accent-500"
                      aria-label={t(lang, 'scan.zoom')}
                      dir="ltr"
                    />
                    <span className="w-10 text-end text-xs font-medium text-white/90 tabular-nums" dir="ltr">
                      {zoom.current.toFixed(1)}×
                    </span>
                  </div>
                )}
              </>
            )}
            {state.kind === 'idle' && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-300">
                <Camera className="h-10 w-10 opacity-70" />
                <p className="text-sm">{t(lang, 'scan.tip')}</p>
              </div>
            )}
            {state.kind === 'looking-up' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-900/85 backdrop-blur">
                <Loader2 className="h-10 w-10 animate-spin text-accent-400" />
                <p className="text-slate-200">{t(lang, 'scan.searching')}</p>
                <p className="text-xs text-slate-500" dir="ltr">
                  {state.payload}
                </p>
              </div>
            )}
            {state.kind === 'success' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-emerald-950/85 backdrop-blur p-6 text-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-400" />
                <p className="text-lg font-semibold text-white">{t(lang, 'scan.added')}</p>
                <p className="line-clamp-2 text-sm text-emerald-200">{state.book.title}</p>
                <button onClick={reset} className="btn-ghost mt-2">
                  <ScanLine className="h-4 w-4" /> {t(lang, 'scan.start')}
                </button>
              </div>
            )}
            {state.kind === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-rose-950/85 backdrop-blur p-6 text-center">
                <AlertCircle className="h-12 w-12 text-rose-400" />
                <p className="text-sm font-medium text-rose-100">{state.message}</p>
                <div className="flex gap-2">
                  <button onClick={() => openSearch()} className="btn-ghost">
                    <Search className="h-4 w-4" /> {t(lang, 'scan.search.byTitle')}
                  </button>
                  <button onClick={reset} className="btn-ghost">
                    <X className="h-4 w-4" /> {t(lang, 'common.close')}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {state.kind === 'scanning' ? (
              <button onClick={() => void stopCamera().then(reset)} className="btn-ghost flex-1">
                <X className="h-4 w-4" />
                {t(lang, 'scan.stop')}
              </button>
            ) : (
              <>
                <button onClick={() => void startCamera()} className="btn-primary flex-1">
                  <Camera className="h-5 w-5" />
                  {t(lang, 'scan.start')}
                </button>
                <button onClick={() => openSearch()} className="btn-ghost px-4" aria-label={t(lang, 'scan.search.byTitle')}>
                  <Search className="h-5 w-5" />
                </button>
              </>
            )}
          </div>

          <div className="card">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
              <KeyRound className="h-4 w-4" />
              {t(lang, 'scan.manual')}
            </div>
            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <input
                value={manualIsbn}
                onChange={(e) => setManualIsbn(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                placeholder={t(lang, 'scan.manual.placeholder')}
                className="flex-1 rounded-2xl bg-white/5 px-4 py-3 text-base text-white ring-1 ring-inset ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-accent-500"
                dir="ltr"
              />
              <button type="submit" className="btn-primary px-4">
                <BookOpen className="h-4 w-4" />
                {t(lang, 'scan.manual.submit')}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

interface SearchFallbackProps {
  lang: Lang;
  payload?: string;
  query: string;
  setQuery: (q: string) => void;
  results: Book[];
  searching: boolean;
  onSubmit: () => void;
  onPick: (b: Book) => void;
  onCancel: () => void;
}

function SearchFallback({
  lang,
  payload,
  query,
  setQuery,
  results,
  searching,
  onSubmit,
  onPick,
  onCancel,
}: SearchFallbackProps) {
  return (
    <div className="card flex flex-col gap-3 animate-fade-in">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{t(lang, 'scan.fallback.title')}</p>
          {payload && (
            <p className="mt-0.5 break-all text-xs text-slate-500" dir="ltr">
              {payload}
            </p>
          )}
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            {t(lang, 'scan.fallback.hint')}
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="flex gap-2"
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, 'scan.search.placeholder')}
          className="flex-1 rounded-2xl bg-white/5 px-4 py-3 text-base text-white ring-1 ring-inset ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-accent-500"
        />
        <button
          type="submit"
          disabled={!query.trim() || searching}
          className="btn-primary px-4 disabled:opacity-50"
        >
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {t(lang, 'scan.search.button')}
        </button>
      </form>

      {searching && (
        <div className="flex items-center justify-center py-6 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {!searching && results.length === 0 && query && (
        <p className="py-3 text-center text-sm text-slate-500">{t(lang, 'scan.search.empty')}</p>
      )}

      {results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.slice(0, 8).map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => onPick(b)}
                className="flex w-full items-stretch gap-3 rounded-2xl bg-white/5 p-3 text-start ring-1 ring-white/10 transition hover:bg-white/10 active:scale-[0.99]"
                dir={b.isHebrew ? 'rtl' : 'ltr'}
              >
                <div className="h-20 w-14 shrink-0 overflow-hidden rounded-md">
                  <BookCover book={b} rounded="rounded-md" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-semibold text-white">{b.title}</p>
                  {b.authors.length > 0 && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">
                      {b.authors.join(', ')}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                    {b.publishedYear && <span>{b.publishedYear}</span>}
                    {b.publisher && <span className="line-clamp-1">· {b.publisher}</span>}
                  </div>
                </div>
                <div className="flex items-center self-center">
                  <Plus className="h-5 w-5 text-accent-400" />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button onClick={onCancel} className="btn-ghost mt-1">
        <X className="h-4 w-4" /> {t(lang, 'scan.tryAgain')}
      </button>
    </div>
  );
}
