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
  Image as ImageIcon,
  Settings as SettingsIcon,
  Sparkles,
  ExternalLink,
  Flashlight,
  Focus,
} from 'lucide-react';
import type { Book } from '../types';
import { BookCover } from './BookCover';
import { lookupByIsbn, lookupFromScan, searchBooks, BookLookupError } from '../lib/books';
import { cleanIsbn, containsHebrew, isValidIsbn } from '../lib/isbn';
import { getCachedBarcode, setCachedBarcode } from '../lib/cache';
import { loadSettings, saveSettings } from '../lib/storage';
import { t, type Lang } from '../lib/i18n';

interface ScannerProps {
  lang: Lang;
  onBook: (book: Book) => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'looking-up'; payload: string }
  | { kind: 'success'; book: Book; fromCache?: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'search'; payload?: string }
  | { kind: 'cover-camera' }
  | { kind: 'cover-ocr'; progress: number; phase: string };

interface ZoomCap {
  min: number;
  max: number;
  step: number;
  current: number;
}

interface FocusReticle {
  x: number; // 0..1 within video
  y: number; // 0..1 within video
  ts: number;
}

const SCANNER_ID = 'qr-reader';
const COVER_VIDEO_ID = 'cover-camera';

export function Scanner({ lang, onBook }: ScannerProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [manualIsbn, setManualIsbn] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Book[]>([]);
  const [searching, setSearching] = useState(false);
  const [zoom, setZoom] = useState<ZoomCap | null>(null);
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean } | null>(null);
  const [reticle, setReticle] = useState<FocusReticle | null>(null);

  // The barcode payload that should be cached when the user picks a search result,
  // so a subsequent scan of the same publisher SKU auto-resolves.
  const pendingCacheBarcodeRef = useRef<string | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const coverStreamRef = useRef<MediaStream | null>(null);
  const coverVideoRef = useRef<HTMLVideoElement | null>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const handledPayloadRef = useRef<string | null>(null);

  const stopCamera = useCallback(async () => {
    const s = scannerRef.current;
    setZoom(null);
    setTorch(null);
    setReticle(null);
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

  const stopCoverCamera = useCallback(() => {
    coverStreamRef.current?.getTracks().forEach((t) => t.stop());
    coverStreamRef.current = null;
    if (coverVideoRef.current) coverVideoRef.current.srcObject = null;
  }, []);

  const openSearch = useCallback((payload?: string, cacheable?: string) => {
    setSearchResults([]);
    setSearchQuery(payload && /[A-Za-z֐-׿]/.test(payload) ? payload : '');
    pendingCacheBarcodeRef.current = cacheable ?? null;
    setState({ kind: 'search', payload });
  }, []);

  const handlePayload = useCallback(
    async (payload: string) => {
      if (handledPayloadRef.current === payload) return;
      handledPayloadRef.current = payload;

      // Fast path: user already matched this barcode in a previous scan.
      const cached = getCachedBarcode(payload);
      if (cached) {
        lookupAbortRef.current?.abort();
        await stopCamera();
        onBook({ ...cached, addedAt: new Date().toISOString(), source: 'qr' });
        setState({ kind: 'success', book: cached, fromCache: true });
        return;
      }

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
          openSearch(payload, payload);
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

  const toggleTorch = useCallback(() => {
    const s = scannerRef.current;
    if (!s) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const caps = (s as any).getRunningTrackCameraCapabilities?.();
      const torchFeature = caps?.torchFeature?.();
      if (torchFeature?.isSupported?.()) {
        const next = !(torch?.on ?? false);
        torchFeature.apply(next);
        setTorch({ supported: true, on: next });
      }
    } catch {
      // ignore
    }
  }, [torch]);

  const focusAt = useCallback((nx: number, ny: number) => {
    const s = scannerRef.current;
    if (!s) return;
    setReticle({ x: nx, y: ny, ts: Date.now() });
    // Try a manual single-shot focus at the tapped point, then revert to continuous.
    // Many Android browsers honour pointsOfInterest; iOS Safari ignores it but
    // a focusMode round-trip alone is sometimes enough to nudge AF.
    const advanced: MediaTrackConstraintSet[] = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { pointsOfInterest: [{ x: nx, y: ny }] } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { focusMode: 'single-shot' } as any,
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s as any).applyVideoConstraints?.({ advanced }).catch(() => undefined);
    window.setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (scannerRef.current as any)?.applyVideoConstraints?.({
        advanced: [{ focusMode: 'continuous' }],
      }).catch(() => undefined);
    }, 900);
  }, []);

  const onScannerTap = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = e.currentTarget;
      const video = container.querySelector('video');
      const rect = (video ?? container).getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      focusAt(nx, ny);
    },
    [focusAt],
  );

  // Hide the focus reticle after 800ms
  useEffect(() => {
    if (!reticle) return;
    const id = window.setTimeout(() => setReticle(null), 800);
    return () => window.clearTimeout(id);
  }, [reticle]);

  const startCamera = useCallback(async () => {
    handledPayloadRef.current = null;
    setState({ kind: 'scanning' });

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
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      });
      scannerRef.current = instance;

      // Keep the initial constraint minimal — html5-qrcode 2.3.8 sometimes
      // surfaces unsupported `advanced` constraints (focusMode, etc.) as a
      // generic "permission denied" even when permission is fine. The focus-mode
      // hint is applied below via applyVideoConstraints once the track is live,
      // which is the path the spec actually treats as best-effort.
      const cameraConfig = { facingMode: 'environment' };

      await instance.start(
        cameraConfig,
        {
          fps: 15,
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
          // ignore per-frame decode failures
        },
      );

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (instance as any).applyVideoConstraints({
          advanced: [{ focusMode: 'continuous' }],
        });
      } catch {
        // unsupported — fine
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const caps = (instance as any).getRunningTrackCameraCapabilities?.();
        const zoomFeature = caps?.zoomFeature?.();
        if (zoomFeature?.isSupported?.()) {
          const min = Number(zoomFeature.min?.() ?? 1);
          const max = Number(zoomFeature.max?.() ?? 1);
          const step = Number(zoomFeature.step?.() || 0.1);
          const current = Number(zoomFeature.value?.() ?? min);
          if (max > min) setZoom({ min, max, step: step || 0.1, current: min });
          // Force zoom back to 1× — digital zoom hurts barcode decode by reducing
          // the effective pixel count of the barcode sent to the decoder.
          if (current > min) {
            try { zoomFeature.apply(min); } catch { /* ignore */ }
          }
        }
        const torchFeature = caps?.torchFeature?.();
        if (torchFeature?.isSupported?.()) {
          setTorch({ supported: true, on: false });
        }
      } catch {
        // unsupported — no zoom/torch UI
      }
    } catch (e) {
      setState({ kind: 'error', message: formatCameraError(e, lang) });
    }
  }, [handlePayload, lang]);

  const startCoverCamera = useCallback(async () => {
    setState({ kind: 'cover-camera' });
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setState({ kind: 'error', message: t(lang, 'scan.error.https') });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          advanced: [{ focusMode: 'continuous' }] as any,
        },
        audio: false,
      });
      coverStreamRef.current = stream;
      const attempt = () => {
        const v = coverVideoRef.current;
        if (!v) {
          setTimeout(attempt, 30);
          return;
        }
        v.srcObject = stream;
        void v.play();
      };
      attempt();
    } catch (e) {
      setState({ kind: 'error', message: formatCameraError(e, lang) });
    }
  }, [lang]);

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

  const captureCover = useCallback(async () => {
    const video = coverVideoRef.current;
    if (!video || video.readyState < 2) return;
    // Lazy-load OCR module (and tesseract.js) only when actually needed.
    const ocr = await import('../lib/ocr');
    const canvas = ocr.snapshotVideo(video);
    stopCoverCamera();
    setState({ kind: 'cover-ocr', progress: 0, phase: 'init' });
    try {
      const candidates = await ocr.ocrTitleCandidates(canvas, (p) => {
        setState((prev) =>
          prev.kind === 'cover-ocr' ? { kind: 'cover-ocr', progress: p.progress, phase: p.status } : prev,
        );
      });
      if (candidates.length === 0) {
        openSearch();
        setSearchQuery('');
        setSearchResults([]);
        setState({ kind: 'search', payload: undefined });
        // Soft error inline:
        setSearching(false);
        setSearchResults([]);
        return;
      }
      // Search with the strongest candidate; if empty, union the next ones.
      let results: Book[] = [];
      for (const q of candidates) {
        searchAbortRef.current?.abort();
        const ac = new AbortController();
        searchAbortRef.current = ac;
        const r = await searchBooks(q, {
          lang: containsHebrew(q) ? 'he' : undefined,
          signal: ac.signal,
        });
        results = mergeResults(results, r);
        if (results.length >= 5) break;
      }
      setSearchQuery(candidates[0]);
      setSearchResults(results);
      setState({ kind: 'search', payload: pendingCacheBarcodeRef.current ?? undefined });
    } catch (e) {
      setState({
        kind: 'error',
        message: (e as Error).message || t(lang, 'scan.cover.notext'),
      });
    }
  }, [lang, openSearch, stopCoverCamera]);

  useEffect(() => {
    return () => {
      void stopCamera();
      stopCoverCamera();
      lookupAbortRef.current?.abort();
      searchAbortRef.current?.abort();
    };
  }, [stopCamera, stopCoverCamera]);

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

  const reset = useCallback(() => {
    pendingCacheBarcodeRef.current = null;
    stopCoverCamera();
    setState({ kind: 'idle' });
    setSearchQuery('');
    setSearchResults([]);
  }, [stopCoverCamera]);

  const onPickResult = useCallback(
    (book: Book) => {
      const cacheBarcode = pendingCacheBarcodeRef.current;
      const tagged: Book = { ...book, source: 'manual' };
      onBook(tagged);
      if (cacheBarcode) {
        setCachedBarcode(cacheBarcode, tagged);
        pendingCacheBarcodeRef.current = null;
      }
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

      {state.kind === 'cover-camera' && (
        <CoverCameraView
          lang={lang}
          videoRef={coverVideoRef}
          onCapture={() => void captureCover()}
          onCancel={() => {
            stopCoverCamera();
            reset();
          }}
        />
      )}

      {state.kind === 'cover-ocr' && (
        <div className="card flex flex-col items-center gap-3 py-8 text-center animate-fade-in">
          <Sparkles className="h-10 w-10 animate-pulse text-accent-400" />
          <p className="text-sm font-medium text-white">{t(lang, 'scan.cover.processing')}</p>
          <p className="text-xs uppercase tracking-wider text-slate-500">{state.phase}</p>
          <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-gradient-to-r from-accent-500 to-indigo-500 transition-[width]"
              style={{ width: `${Math.max(5, Math.round(state.progress * 100))}%` }}
            />
          </div>
        </div>
      )}

      {state.kind === 'search' && (
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
          onCoverScan={() => void startCoverCamera()}
        />
      )}

      {(state.kind === 'idle' ||
        state.kind === 'scanning' ||
        state.kind === 'looking-up' ||
        state.kind === 'success' ||
        state.kind === 'error') && (
        <>
          <div className="card relative overflow-hidden">
            <div
              className="relative"
              onPointerDown={state.kind === 'scanning' ? onScannerTap : undefined}
            >
              <div
                id={SCANNER_ID}
                className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black/60"
              />
              {state.kind === 'scanning' && (
                <>
                  <div className="pointer-events-none absolute inset-5 flex items-center justify-center">
                    <div className="relative h-40 w-[85%] rounded-2xl border-2 border-accent-400/70 shadow-[0_0_0_4000px_rgba(0,0,0,0.35)]">
                      <div className="absolute inset-x-0 top-0 h-0.5 animate-scan-line bg-accent-400 shadow-[0_0_20px_2px_rgba(167,139,250,0.9)]" />
                      <div className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent-500/90 px-3 py-1 text-[11px] font-semibold text-white shadow-lg">
                        <ScanLine className="me-1 inline h-3.5 w-3.5" />
                        {t(lang, 'scan.hint.tapFocus')}
                      </div>
                    </div>
                  </div>
                  {reticle && (
                    <div
                      className="pointer-events-none absolute h-20 w-20 -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${reticle.x * 100}%`, top: `${reticle.y * 100}%` }}
                    >
                      <div className="h-full w-full animate-ping rounded-full border-2 border-accent-300" />
                      <div className="absolute inset-3 rounded-full border border-accent-200/80" />
                    </div>
                  )}
                </>
              )}
            </div>
            {state.kind === 'scanning' && (
              <>
                {torch?.supported && (
                  <button
                    type="button"
                    onClick={toggleTorch}
                    className={`absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full backdrop-blur transition active:scale-95 ${
                      torch.on
                        ? 'bg-amber-300 text-amber-900 shadow-lg shadow-amber-500/50'
                        : 'bg-black/55 text-white/90'
                    }`}
                    aria-label={t(lang, 'scan.torch')}
                  >
                    <Flashlight className="h-5 w-5" />
                  </button>
                )}
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
                    <span
                      className="w-10 text-end text-xs font-medium text-white/90 tabular-nums"
                      dir="ltr"
                    >
                      {zoom.current.toFixed(1)}×
                    </span>
                  </div>
                )}
                <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                  <Focus className="h-3 w-3" />
                  <span>{t(lang, 'scan.hint.distance')}</span>
                </div>
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
                {state.fromCache && (
                  <p className="text-[11px] uppercase tracking-wider text-emerald-300">
                    {t(lang, 'scan.cache.hit')}
                  </p>
                )}
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
                <div className="flex flex-wrap justify-center gap-2">
                  <button onClick={() => void startCoverCamera()} className="btn-ghost">
                    <ImageIcon className="h-4 w-4" /> {t(lang, 'scan.cover.cta')}
                  </button>
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
                <button
                  onClick={() => void startCoverCamera()}
                  className="btn-ghost px-4"
                  aria-label={t(lang, 'scan.cover.cta')}
                  title={t(lang, 'scan.cover.cta')}
                >
                  <ImageIcon className="h-5 w-5" />
                </button>
                <button
                  onClick={() => openSearch()}
                  className="btn-ghost px-4"
                  aria-label={t(lang, 'scan.search.byTitle')}
                  title={t(lang, 'scan.search.byTitle')}
                >
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

          <SettingsPanel lang={lang} />
        </>
      )}
    </div>
  );
}

function formatCameraError(e: unknown, lang: Lang): string {
  // html5-qrcode can throw plain strings, `Error` instances, or DOMException-like
  // objects. Normalise so we can distinguish a real permission denial from a
  // constraint failure (which has different remedies).
  const message =
    typeof e === 'string'
      ? e
      : e && typeof e === 'object'
        ? ((e as { message?: string; name?: string }).message ?? '') ||
          (e as { name?: string }).name ||
          ''
        : '';
  const name = e && typeof e === 'object' ? (e as { name?: string }).name ?? '' : '';
  const haystack = `${name} ${message}`;
  // True permission denials — only NotAllowedError / SecurityError are reliably
  // about user permission. Vague "denied" strings from library wrappers don't
  // count, so we expose them instead of pretending it's permission.
  if (/NotAllowed|SecurityError|PermissionDenied/i.test(haystack)) {
    return t(lang, 'scan.error.camera');
  }
  if (/Overconstrained|NotReadable|NotFound|TrackStart/i.test(haystack)) {
    return `${t(lang, 'scan.error.camera')} (${name || message})`;
  }
  return message || t(lang, 'scan.error.camera');
}

function mergeResults(a: Book[], b: Book[]): Book[] {
  const seen = new Set(a.map((x) => x.id));
  const out = [...a];
  for (const item of b) {
    if (!seen.has(item.id)) {
      out.push(item);
      seen.add(item.id);
    }
  }
  return out;
}

interface CoverCameraProps {
  lang: Lang;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  onCapture: () => void;
  onCancel: () => void;
}

function CoverCameraView({ lang, videoRef, onCapture, onCancel }: CoverCameraProps) {
  return (
    <div className="card relative overflow-hidden animate-fade-in">
      <video
        id={COVER_VIDEO_ID}
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="aspect-[3/4] w-full rounded-2xl bg-black/80 object-cover"
      />
      <div className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-max max-w-[90%] rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur">
        <ImageIcon className="me-1.5 inline h-3.5 w-3.5" />
        {t(lang, 'scan.cover.hint')}
      </div>
      <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-3">
        <button onClick={onCancel} className="btn-ghost px-4" aria-label={t(lang, 'common.close')}>
          <X className="h-5 w-5" />
        </button>
        <button
          onClick={onCapture}
          className="grid h-16 w-16 place-items-center rounded-full bg-white shadow-2xl shadow-black/50 ring-4 ring-white/30 active:scale-95"
          aria-label={t(lang, 'scan.cover.capture')}
        >
          <span className="block h-12 w-12 rounded-full bg-gradient-to-br from-accent-500 to-indigo-600" />
        </button>
        <div className="w-12" />
      </div>
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
  onCoverScan: () => void;
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
  onCoverScan,
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

      <button
        onClick={onCoverScan}
        className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-accent-500/15 to-indigo-500/15 px-4 py-3 text-sm font-medium text-accent-200 ring-1 ring-accent-400/30 transition hover:bg-accent-500/20 active:scale-[0.99]"
      >
        <ImageIcon className="h-4 w-4" />
        {t(lang, 'scan.cover.cta')}
      </button>

      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500">
        <span className="h-px flex-1 bg-white/10" />
        OR
        <span className="h-px flex-1 bg-white/10" />
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

function SettingsPanel({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(() => loadSettings().nliApiKey ?? '');
  const [workerUrl, setWorkerUrl] = useState(() => loadSettings().lookupWorkerUrl ?? '');
  const [savedAt, setSavedAt] = useState(0);

  const save = () => {
    const s = loadSettings();
    saveSettings({
      ...s,
      nliApiKey: key.trim() || undefined,
      lookupWorkerUrl: workerUrl.trim() || undefined,
    });
    setSavedAt(Date.now());
  };

  const justSaved = savedAt && Date.now() - savedAt < 2000;

  return (
    <div className="card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-sm font-medium text-slate-300"
      >
        <span className="flex items-center gap-2">
          <SettingsIcon className="h-4 w-4" />
          {t(lang, 'settings.title')}
        </span>
        <span className="text-xs text-slate-500">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="mt-4 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-slate-300">
              {t(lang, 'settings.worker.label')}
            </label>
            <p className="text-[11px] leading-relaxed text-slate-500">
              {t(lang, 'settings.worker.hint')}
            </p>
            <input
              type="url"
              value={workerUrl}
              onChange={(e) => setWorkerUrl(e.target.value)}
              placeholder={t(lang, 'settings.worker.placeholder')}
              className="rounded-2xl bg-white/5 px-3 py-2 text-sm text-white ring-1 ring-inset ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-accent-500"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-slate-300">
              {t(lang, 'settings.nli.label')}
            </label>
            <p className="text-[11px] leading-relaxed text-slate-500">
              {t(lang, 'settings.nli.hint')}{' '}
              <a
                href="https://api2.nli.org.il/signup/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-300 underline-offset-2 hover:underline"
              >
                {t(lang, 'settings.nli.signup')} <ExternalLink className="inline h-3 w-3" />
              </a>
            </p>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={t(lang, 'settings.nli.placeholder')}
              className="rounded-2xl bg-white/5 px-3 py-2 text-sm text-white ring-1 ring-inset ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-accent-500"
              dir="ltr"
              autoComplete="off"
            />
          </div>

          <button onClick={save} className="btn-primary self-end px-4 text-xs">
            {justSaved ? t(lang, 'settings.saved') : t(lang, 'settings.save')}
          </button>
        </div>
      )}
    </div>
  );
}
