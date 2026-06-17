// ISBN utilities — validation, format detection, Israeli prefix detection.

export function cleanIsbn(raw: string): string {
  return raw.replace(/[-\s]/g, '').toUpperCase();
}

export function isValidIsbn10(s: string): boolean {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (i + 1) * Number(s[i]);
  const check = s[9] === 'X' ? 10 : Number(s[9]);
  sum += 10 * check;
  return sum % 11 === 0;
}

export function isValidIsbn13(s: string): boolean {
  // Real ISBN-13s always start with 978 or 979 (Bookland EAN). Without that
  // guard, every valid EAN-13 product code (e.g. Israeli publisher SKUs printed
  // on book backs) would pass checksum and lead to dead-end lookups.
  if (!/^97[89]\d{10}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const d = Number(s[i]);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return sum % 10 === 0;
}

export function isValidIsbn(s: string): boolean {
  const c = cleanIsbn(s);
  return isValidIsbn10(c) || isValidIsbn13(c);
}

// Israel's ISBN registration group is "965" (also "978-965" in ISBN-13).
export function isIsraeliIsbn(s: string): boolean {
  const c = cleanIsbn(s);
  if (c.length === 13) return c.startsWith('978965');
  if (c.length === 10) return c.startsWith('965');
  return false;
}

/**
 * Extract any ISBN-like string from a free-form QR payload.
 * Slides a window across the digits so that a valid ISBN substring is found even
 * if the payload includes a URL, a leading UPC-A zero, or surrounding noise.
 */
export function extractIsbn(payload: string): string | null {
  const digits = payload.replace(/[^0-9Xx]/g, '').toUpperCase();
  for (let i = 0; i + 13 <= digits.length; i++) {
    const w = digits.slice(i, i + 13);
    if (isValidIsbn13(w)) return w;
  }
  for (let i = 0; i + 10 <= digits.length; i++) {
    const w = digits.slice(i, i + 10);
    if (isValidIsbn10(w)) return w;
  }
  return null;
}

// Hebrew Unicode block: U+0590–U+05FF
const HEBREW_RE = /[֐-׿]/;
export function containsHebrew(s: string | undefined | null): boolean {
  if (!s) return false;
  return HEBREW_RE.test(s);
}
