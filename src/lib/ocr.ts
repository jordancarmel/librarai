// Cover-OCR pipeline using Tesseract.js. Hebrew + English trained data is loaded
// lazily from the Tesseract CDN on first use (~10–15 MB, cached by the browser).
// Returns ranked text candidates suitable for plugging into searchBooks().

import type { Worker } from 'tesseract.js';
import { containsHebrew } from './isbn';

let workerPromise: Promise<Worker> | null = null;

export interface OcrProgress {
  status: string;
  progress: number; // 0..1
}

async function getWorker(onProgress?: (p: OcrProgress) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      // 'heb' first so the trainer biases toward Hebrew layout on RTL covers;
      // 'eng' is kept around for English subtitles and author transliterations.
      return createWorker(['heb', 'eng'], 1, {
        logger: onProgress
          ? (m) => onProgress({ status: m.status, progress: m.progress ?? 0 })
          : undefined,
      });
    })();
  }
  return workerPromise;
}

export async function terminateOcrWorker() {
  if (!workerPromise) return;
  try {
    const w = await workerPromise;
    await w.terminate();
  } catch {
    // ignore
  } finally {
    workerPromise = null;
  }
}

/**
 * Capture a still frame from a live <video> element to a Canvas. The Canvas is
 * returned at the video's native resolution so OCR has the most pixels possible.
 */
export function snapshotVideo(video: HTMLVideoElement): HTMLCanvasElement {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.drawImage(video, 0, 0, w, h);
  return canvas;
}

interface RankedLine {
  text: string;
  score: number;
}

/**
 * Run OCR and return a small list of ranked title-candidate strings. The ranking
 * favours: long Hebrew runs, large detected font height (when Tesseract exposes
 * bbox), and lines that aren't all-numeric / all-punctuation.
 */
export async function ocrTitleCandidates(
  canvas: HTMLCanvasElement,
  onProgress?: (p: OcrProgress) => void,
): Promise<string[]> {
  const worker = await getWorker(onProgress);
  const result = await worker.recognize(canvas);
  const data = result.data;

  const candidates: RankedLine[] = [];
  // Tesseract.js v7 emits a per-line array on data.lines with bbox + text.
  const lines = (data as unknown as { lines?: { text?: string; bbox?: { x0: number; y0: number; x1: number; y1: number } }[] }).lines ?? [];
  for (const line of lines) {
    const raw = (line.text ?? '').trim();
    if (!raw) continue;
    if (raw.length < 2) continue;
    // Discard noise: lines with no alphabetic chars
    if (!/[A-Za-zא-ת]/.test(raw)) continue;
    const bbox = line.bbox;
    const height = bbox ? Math.max(0, bbox.y1 - bbox.y0) : 0;
    // Score: heavier weight to taller text (likely title/author), Hebrew presence,
    // and length within a reasonable title range.
    const lengthScore = Math.min(raw.length, 60) / 60;
    const heightScore = height ? Math.min(height, 200) / 200 : 0.2;
    const hebrewScore = containsHebrew(raw) ? 0.3 : 0;
    candidates.push({
      text: raw.replace(/\s+/g, ' '),
      score: heightScore * 2 + lengthScore + hebrewScore,
    });
  }

  // Fallback: if line parsing yielded nothing useful, split the full text by lines.
  if (candidates.length === 0 && data.text) {
    for (const raw of data.text.split(/\r?\n/)) {
      const trimmed = raw.trim();
      if (trimmed.length < 3) continue;
      if (!/[A-Za-zא-ת]/.test(trimmed)) continue;
      candidates.push({ text: trimmed, score: containsHebrew(trimmed) ? 0.5 : 0.3 });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  // Top 4 lines is plenty to feed into a search — covers the title, the author,
  // and one or two backup runs.
  return candidates.slice(0, 4).map((c) => c.text);
}
