import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeScannerState, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Camera, Loader2, ScanLine, KeyRound, BookOpen, CheckCircle2, AlertCircle, X } from 'lucide-react';
import type { Book } from '../types';
import { lookupByIsbn, lookupFromScan, BookLookupError } from '../lib/books';
import { cleanIsbn, isValidIsbn } from '../lib/isbn';
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
  | { kind: 'error'; message: string };

const SCANNER_ID = 'qr-reader';

export function Scanner({ lang, onBook }: ScannerProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [manualIsbn, setManualIsbn] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // Guard against concurrent lookups from rapid camera triggers — html5-qrcode
  // can fire the success callback multiple times for the same code in quick
  // succession.
  const lookupAbortRef = useRef<AbortController | null>(null);
  const handledPayloadRef = useRef<string | null>(null);

  const stopCamera = useCallback(async () => {
    const s = scannerRef.current;
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
        setState({
          kind: 'error',
          message:
            code === 'invalid'
              ? t(lang, 'scan.error.invalid')
              : code === 'not-found'
                ? t(lang, 'scan.error.notfound')
                : err.message,
        });
      }
    },
    [lang, onBook, stopCamera],
  );

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
      });
      scannerRef.current = instance;

      // Prefer the rear camera explicitly — using { facingMode: { exact: 'environment' } }
      // can fail on desktop or front-only devices, so we use `ideal` semantics.
      await instance.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (w, h) => {
            const min = Math.min(w, h);
            const size = Math.floor(min * 0.7);
            return { width: size, height: Math.floor(size * 0.7) };
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
        setState({
          kind: 'error',
          message: err.code === 'not-found' ? t(lang, 'scan.error.notfound') : err.message,
        });
      }
    },
    [lang, manualIsbn, onBook],
  );

  const reset = () => setState({ kind: 'idle' });

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <header>
        <h2 className="text-2xl font-bold text-white">{t(lang, 'scan.title')}</h2>
        <p className="mt-1 text-sm text-slate-400">{t(lang, 'scan.subtitle')}</p>
      </header>

      <div className="card relative overflow-hidden">
        <div
          id={SCANNER_ID}
          className="aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black/60"
        />
        {state.kind === 'scanning' && (
          <div className="pointer-events-none absolute inset-5 flex items-center justify-center">
            <div className="relative h-48 w-[80%] rounded-2xl border-2 border-accent-400/70 shadow-[0_0_0_4000px_rgba(0,0,0,0.35)]">
              <div className="absolute inset-x-0 top-0 h-0.5 animate-scan-line bg-accent-400 shadow-[0_0_20px_2px_rgba(167,139,250,0.9)]" />
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 rounded-full bg-accent-500/90 px-3 py-1 text-xs font-semibold text-white shadow-lg">
                <ScanLine className="me-1 inline h-3.5 w-3.5" /> Aim at barcode
              </div>
            </div>
          </div>
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
            <p className="text-xs text-slate-500">{state.payload}</p>
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
            <button onClick={reset} className="btn-ghost mt-2">
              <X className="h-4 w-4" /> {t(lang, 'common.close')}
            </button>
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
          <button onClick={() => void startCamera()} className="btn-primary flex-1">
            <Camera className="h-5 w-5" />
            {t(lang, 'scan.start')}
          </button>
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
    </div>
  );
}
