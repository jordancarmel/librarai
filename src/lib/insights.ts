import type { Book, BreakdownItem, LibraryStats } from '../types';

export function computeStats(books: Book[]): LibraryStats {
  if (!books.length) {
    return {
      total: 0,
      read: 0,
      reading: 0,
      toRead: 0,
      totalPages: 0,
      hebrewCount: 0,
      israeliCount: 0,
      uniqueAuthors: 0,
      uniqueLanguages: 0,
    };
  }
  const authors = new Set<string>();
  const languages = new Set<string>();
  let read = 0,
    reading = 0,
    toRead = 0,
    pages = 0,
    hebrew = 0,
    israeli = 0,
    ratingSum = 0,
    rated = 0;
  for (const b of books) {
    b.authors.forEach((a) => authors.add(a));
    if (b.language) languages.add(b.language);
    if (b.status === 'read') read++;
    else if (b.status === 'reading') reading++;
    else toRead++;
    pages += b.pageCount ?? 0;
    if (b.isHebrew) hebrew++;
    if (b.isIsraeliPublisher) israeli++;
    if (b.rating) {
      ratingSum += b.rating;
      rated++;
    }
  }
  return {
    total: books.length,
    read,
    reading,
    toRead,
    totalPages: pages,
    hebrewCount: hebrew,
    israeliCount: israeli,
    uniqueAuthors: authors.size,
    uniqueLanguages: languages.size,
    avgRating: rated ? Math.round((ratingSum / rated) * 10) / 10 : undefined,
  };
}

function topN(map: Map<string, number>, n = 6): BreakdownItem[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

export function breakdownAuthors(books: Book[]) {
  const m = new Map<string, number>();
  for (const b of books) for (const a of b.authors) m.set(a, (m.get(a) ?? 0) + 1);
  return topN(m, 6);
}

export function breakdownCategories(books: Book[]) {
  const m = new Map<string, number>();
  for (const b of books) {
    for (const raw of b.categories) {
      // Google often returns "Fiction / Thrillers / Suspense" — keep the leaf.
      const leaf = raw.split('/').pop()?.trim() || raw;
      m.set(leaf, (m.get(leaf) ?? 0) + 1);
    }
  }
  return topN(m, 6);
}

export function breakdownLanguages(books: Book[]) {
  const m = new Map<string, number>();
  for (const b of books) m.set(b.language || 'unknown', (m.get(b.language || 'unknown') ?? 0) + 1);
  return topN(m, 6);
}

export function breakdownDecades(books: Book[]) {
  const m = new Map<string, number>();
  for (const b of books) {
    if (!b.publishedYear) continue;
    const dec = `${Math.floor(b.publishedYear / 10) * 10}s`;
    m.set(dec, (m.get(dec) ?? 0) + 1);
  }
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, count }));
}

export interface Insight {
  title: string;
  body: string;
  tone: 'good' | 'info' | 'warn';
}

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  he: 'Hebrew',
  ar: 'Arabic',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ru: 'Russian',
  it: 'Italian',
  pt: 'Portuguese',
  ja: 'Japanese',
  zh: 'Chinese',
};

export function langName(code: string): string {
  return LANG_NAMES[code] ?? code.toUpperCase();
}

/**
 * Generate a handful of natural-language insights about the library — favored
 * authors, gaps, reading momentum, Israeli-content share. Deterministic and
 * runs entirely client-side, so it works offline.
 */
export function generateInsights(books: Book[]): Insight[] {
  if (!books.length) return [];
  const insights: Insight[] = [];
  const stats = computeStats(books);

  // Reading momentum
  const completion = stats.total ? Math.round((stats.read / stats.total) * 100) : 0;
  if (stats.total >= 3) {
    if (completion >= 60) {
      insights.push({
        title: 'You finish what you start',
        body: `You've read ${stats.read} of ${stats.total} books in your library — a ${completion}% completion rate. Keep going!`,
        tone: 'good',
      });
    } else if (stats.toRead > stats.read * 3 && stats.total >= 5) {
      insights.push({
        title: 'Your TBR is growing fast',
        body: `${stats.toRead} unread books vs. ${stats.read} finished. Consider a "no new books" week to catch up.`,
        tone: 'warn',
      });
    }
  }

  // Favorite author
  const topAuthor = breakdownAuthors(books)[0];
  if (topAuthor && topAuthor.count >= 2) {
    insights.push({
      title: `${topAuthor.label} is your favorite`,
      body: `You've collected ${topAuthor.count} of their books — more than any other author.`,
      tone: 'info',
    });
  }

  // Favorite genre
  const topCat = breakdownCategories(books)[0];
  if (topCat && topCat.count >= 2) {
    const share = Math.round((topCat.count / stats.total) * 100);
    insights.push({
      title: `${topCat.label} dominates your shelves`,
      body: `${share}% of your library falls under ${topCat.label}. Want a recommendation from another genre?`,
      tone: 'info',
    });
  }

  // Hebrew / Israeli share
  if (stats.hebrewCount > 0 || stats.israeliCount > 0) {
    const share = Math.round((Math.max(stats.hebrewCount, stats.israeliCount) / stats.total) * 100);
    insights.push({
      title: 'Local bookshelf',
      body: `${Math.max(stats.hebrewCount, stats.israeliCount)} Israeli or Hebrew title${
        Math.max(stats.hebrewCount, stats.israeliCount) === 1 ? '' : 's'
      } — that's ${share}% of your collection.`,
      tone: 'good',
    });
  }

  // Era diversity
  const decades = breakdownDecades(books);
  if (decades.length >= 4) {
    insights.push({
      title: 'You read across eras',
      body: `Your library spans ${decades.length} decades — from ${decades[0].label} to ${
        decades[decades.length - 1].label
      }.`,
      tone: 'info',
    });
  } else if (decades.length === 1 && stats.total >= 4) {
    insights.push({
      title: `Stuck in the ${decades[0].label}`,
      body: 'Every dated book in your library comes from the same decade. Try a classic or a 2020s release for variety.',
      tone: 'warn',
    });
  }

  // Language diversity
  if (stats.uniqueLanguages >= 3) {
    insights.push({
      title: 'Multilingual reader',
      body: `You collect books in ${stats.uniqueLanguages} languages. Impressive range.`,
      tone: 'good',
    });
  }

  // Page volume
  if (stats.totalPages > 0) {
    insights.push({
      title: 'On your shelves',
      body: `${stats.totalPages.toLocaleString()} pages in total — roughly ${Math.round(
        stats.totalPages / 250,
      )} books' worth of reading time at average pace.`,
      tone: 'info',
    });
  }

  return insights.slice(0, 6);
}
