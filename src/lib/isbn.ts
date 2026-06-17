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
  if (!/^\d{13}$/.test(s)) return false;
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
 * Books sometimes encode ISBNs directly, sometimes as URLs containing the ISBN.
 */
export function extractIsbn(payload: string): string | null {
  // Direct match: 10 or 13 digits, possibly with X for ISBN-10
  const direct = payload.match(/(?:97[89])?\d{9}[\dX]/i);
  if (direct) {
    const candidate = cleanIsbn(direct[0]);
    if (isValidIsbn(candidate)) return candidate;
  }
  // Try a stripped version
  const stripped = cleanIsbn(payload);
  if (isValidIsbn(stripped)) return stripped;
  return null;
}

// Hebrew Unicode block: U+0590–U+05FF
const HEBREW_RE = /[֐-׿]/;
export function containsHebrew(s: string | undefined | null): boolean {
  if (!s) return false;
  return HEBREW_RE.test(s);
}
