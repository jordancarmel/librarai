// Librarai book-lookup Worker.
//
// Resolves Israeli publisher SKUs (12-digit barcodes that aren't ISBNs and aren't
// indexed by Google Books / Open Library / NLI) by doing what a human would: web
// search the barcode, find the first Israeli bookstore product page, and lift the
// title and author out of the page's metadata.
//
// Endpoint: GET /lookup?barcode=009900026462
// Response: { title, authors, publisher?, source, sourceUrl } or { matches: [...] }

interface SerpResult {
  url: string;
  title: string;
}

interface BookData {
  title?: string;
  authors?: string[];
  publisher?: string;
  source?: string;
  sourceUrl?: string;
  thumbnail?: string;
}

// Israeli bookstore / library hostnames that index by publisher SKU. Ordered by
// observed reliability — Dani Books has been the most consistent on weird SKUs.
const BOOKSTORE_HOSTS = [
  'danibooks.co.il',
  'booknet.co.il',
  'mitos.co.il',
  'robinson.co.il',
  'steimatzky.co.il',
  'tzomet-sfarim.co.il',
  'e-vrit.co.il',
  'simania.co.il',
  'getbooks.co.il',
  'sefer-li.net',
];

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    const url = new URL(req.url);
    if (url.pathname === '/lookup') {
      const barcode = url.searchParams.get('barcode')?.trim() ?? '';
      if (!/^\d{6,14}$/.test(barcode)) {
        return json({ error: 'barcode must be 6-14 digits' }, 400);
      }
      return handleLookup(barcode);
    }
    if (url.pathname === '/' || url.pathname === '') {
      return json(
        {
          ok: true,
          service: 'librarai-lookup',
          usage: 'GET /lookup?barcode=<digits>',
        },
        200,
      );
    }
    return json({ error: 'not found' }, 404);
  },
};

async function handleLookup(barcode: string): Promise<Response> {
  let serp: SerpResult[] = [];
  try {
    serp = await searchDdg(barcode);
  } catch (e) {
    return json({ error: 'search failed', detail: (e as Error).message }, 502);
  }

  if (serp.length === 0) {
    return json({ barcode, matches: [], note: 'no web results' }, 200);
  }

  // Pick the best bookstore result. Fall back to any result if no bookstore match.
  const storeResult =
    serp.find((r) => BOOKSTORE_HOSTS.some((h) => r.url.includes(h))) ?? serp[0];

  const fromSerpTitle = parseFromSerpTitle(storeResult.title);
  let fromPage: BookData = {};
  try {
    fromPage = await extractFromProductPage(storeResult.url);
  } catch {
    // best-effort; SERP title is the floor
  }

  const merged: BookData = {
    title: pickBest(fromPage.title, fromSerpTitle.title),
    authors: dedupe([
      ...(fromPage.authors ?? []),
      ...(fromSerpTitle.authors ?? []),
    ]),
    publisher: fromPage.publisher,
    thumbnail: fromPage.thumbnail,
    source: hostnameOf(storeResult.url),
    sourceUrl: storeResult.url,
  };

  if (!merged.title) {
    return json(
      {
        barcode,
        matches: serp.slice(0, 5),
        note: 'parsing failed; returning raw results',
      },
      200,
    );
  }

  return json({ barcode, ...merged }, 200);
}

async function searchDdg(query: string): Promise<SerpResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'he,en;q=0.9',
    },
    cf: { cacheTtl: 60 * 60 * 24, cacheEverything: true },
  } as RequestInit);
  if (!res.ok) throw new Error(`DDG returned ${res.status}`);
  const html = await res.text();
  return parseDdgResults(html);
}

function parseDdgResults(html: string): SerpResult[] {
  const out: SerpResult[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]+?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let href = decodeEntities(m[1]);
    // DDG wraps target URLs: //duckduckgo.com/l/?uddg=<encoded URL>&rut=...
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        href = decodeURIComponent(uddg[1]);
      } catch {
        // bad encoding — skip
        continue;
      }
    }
    if (href.startsWith('//')) href = 'https:' + href;
    const title = decodeEntities(stripHtml(m[2])).replace(/\s+/g, ' ').trim();
    if (href.startsWith('http') && title) out.push({ url: href, title });
  }
  return out;
}

async function extractFromProductPage(url: string): Promise<BookData> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'he,en;q=0.9',
    },
    cf: { cacheTtl: 60 * 60 * 24 * 7, cacheEverything: true },
    redirect: 'follow',
  } as RequestInit);
  if (!res.ok) return {};
  const html = await res.text();

  const result: BookData = {};

  // 1) Open Graph meta tags — most reliable
  const og = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, 'i'))?.[1];

  const ogTitle = og('title');
  const ogImage = og('image');
  if (ogImage) result.thumbnail = decodeEntities(ogImage);

  // 2) <title> tag fallback
  let pageTitle: string | undefined;
  if (ogTitle) pageTitle = decodeEntities(ogTitle);
  else {
    const t = html.match(/<title>([\s\S]+?)<\/title>/i);
    if (t) pageTitle = decodeEntities(stripHtml(t[1])).trim();
  }

  // 3) JSON-LD structured data (most reliable when present)
  const jsonLdParsed = extractJsonLd(html);
  if (jsonLdParsed) {
    if (jsonLdParsed.name) result.title = jsonLdParsed.name;
    if (jsonLdParsed.author) {
      const authors = Array.isArray(jsonLdParsed.author)
        ? jsonLdParsed.author.map((a: { name?: string } | string) =>
            typeof a === 'string' ? a : a.name,
          ).filter(Boolean) as string[]
        : typeof jsonLdParsed.author === 'string'
          ? [jsonLdParsed.author]
          : jsonLdParsed.author.name
            ? [jsonLdParsed.author.name]
            : [];
      if (authors.length) result.authors = authors;
    }
    if (jsonLdParsed.publisher) {
      result.publisher =
        typeof jsonLdParsed.publisher === 'string'
          ? jsonLdParsed.publisher
          : jsonLdParsed.publisher.name;
    }
    if (jsonLdParsed.image && !result.thumbnail) {
      result.thumbnail =
        typeof jsonLdParsed.image === 'string'
          ? jsonLdParsed.image
          : Array.isArray(jsonLdParsed.image)
            ? jsonLdParsed.image[0]
            : undefined;
    }
  }

  // 4) Site-specific extraction as fallback
  const fromSite = extractSiteSpecific(html, url);
  if (!result.title) result.title = fromSite.title ?? parseFromSerpTitle(pageTitle ?? '').title;
  if (!result.authors?.length) result.authors = fromSite.authors;
  if (!result.publisher) result.publisher = fromSite.publisher;

  return result;
}

function extractJsonLd(html: string): {
  name?: string;
  author?: unknown;
  publisher?: { name?: string } | string;
  image?: string | string[];
} | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]+?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim());
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        const type = node['@type'];
        if (type === 'Book' || type === 'Product') return node;
        // Sometimes @graph wraps nodes
        if (node['@graph']) {
          for (const sub of node['@graph']) {
            const t = sub['@type'];
            if (t === 'Book' || t === 'Product') return sub;
          }
        }
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return null;
}

function extractSiteSpecific(html: string, sourceUrl: string): BookData {
  const r: BookData = {};
  // Generic h1 capture
  const h1 = html.match(/<h1[^>]*>([\s\S]+?)<\/h1>/i);
  if (h1) {
    const text = decodeEntities(stripHtml(h1[1])).trim();
    if (text.length > 0 && text.length < 200) r.title = text;
  }

  // Hebrew "author: X" patterns common on Israeli bookstore pages
  const authorPatterns = [
    /(?:סופר|מחבר|מאת)\s*[:״"]\s*([֐-׿\s'"״-]+?)(?:<|\n|מק"ט|הוצאה|מתאר)/i,
    /author[^:]*[:>]\s*([֐-׿A-Za-z\s,.\-]+?)<\//i,
  ];
  for (const re of authorPatterns) {
    const m = html.match(re);
    if (m) {
      const a = m[1].replace(/\s+/g, ' ').trim();
      if (a && a.length < 80) {
        r.authors = [a];
        break;
      }
    }
  }

  const publisherPatterns = [
    /הוצא[הת][^:]*?\s*[:״"]\s*([֐-׿\s]+?)(?:<|\n)/i,
    /publisher[^:]*[:>]\s*([֐-׿A-Za-z\s,.\-]+?)<\//i,
  ];
  for (const re of publisherPatterns) {
    const m = html.match(re);
    if (m) {
      const p = m[1].replace(/\s+/g, ' ').trim();
      if (p && p.length < 80) {
        r.publisher = p;
        break;
      }
    }
  }

  void sourceUrl;
  return r;
}

function parseFromSerpTitle(raw: string): { title: string; authors: string[] } {
  if (!raw) return { title: '', authors: [] };
  // Common SERP title shapes observed on Israeli bookstore SERPs:
  // "<Bookstore> | <category> | <Book> - <Author> <Bookstore>"
  // "<Book> - <Author> | <Bookstore>"
  // "<Book>, <Author> | <Bookstore>"
  let cleaned = raw;
  // Strip known bookstore tokens from anywhere in the title.
  const noiseTokens = [
    'דני ספרים',
    'חנות ספרים',
    'בוקנט',
    'מיתוס',
    'סטימצקי',
    'צומת ספרים',
    'סימניה',
    'GetBooks',
    'getbooks',
    'Steimatzky',
    'הוצאת ספרים',
  ];
  for (const tok of noiseTokens) {
    cleaned = cleaned.split(tok).filter(Boolean).join(' ').trim();
  }
  // Split on common separators
  const parts = cleaned
    .split(/[–—\-|]/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length >= 2) {
    return { title: parts[0], authors: [parts[1]] };
  }
  return { title: parts[0] ?? cleaned, authors: [] };
}

function pickBest<T extends string | undefined>(a: T, b: T): T {
  if (a && b) return (a.length >= b.length ? a : b) as T;
  return (a || b) as T;
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const k = s.trim();
    if (!k) continue;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

function hostnameOf(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
  });
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
