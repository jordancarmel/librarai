import type { Book } from '../types';

const KEY = 'librarai.library.v1';
const SETTINGS_KEY = 'librarai.settings.v1';

export interface AppSettings {
  language: 'en' | 'he';
  hasSeenOnboarding: boolean;
  // Optional National Library of Israel API key. When set, NLI is queried first for
  // Israeli ISBNs since its Hebrew metadata is richer than Google Books. Free signup
  // at https://api2.nli.org.il/signup/.
  nliApiKey?: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  hasSeenOnboarding: false,
};

export function loadLibrary(): Book[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Book[];
  } catch {
    return [];
  }
}

export function saveLibrary(books: Book[]) {
  localStorage.setItem(KEY, JSON.stringify(books));
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
