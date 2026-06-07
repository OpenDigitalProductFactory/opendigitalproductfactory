/**
 * Standardization helpers for master-data match decisions (MDM spec §3).
 *
 * Normalize names, domains, emails, and phone numbers to a comparable form
 * BEFORE scoring duplicate candidates. Pure functions — no DB, no I/O.
 */

const LEGAL_SUFFIXES =
  /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|s\.?a|s\.?a\.?s|b\.?v|pty|group|holdings)\b/g;

/** Combining diacritical marks (U+0300–U+036F), stripped after NFKD normalization. */
const DIACRITICS = /[̀-ͯ]/g;

/** Lowercase, strip diacritics, drop legal suffixes/punctuation, collapse whitespace. */
export function standardizeName(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,'"`()\-_/]/g, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reduce a URL or domain to a bare host: drop scheme, www, path, query. */
export function standardizeDomain(value: string | null | undefined): string {
  if (!value) return "";
  let v = value.trim().toLowerCase();
  v = v.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  v = (v.split("/")[0] ?? "").split("?")[0] ?? "";
  return v.trim();
}

/** Trim + lowercase an email for comparison. */
export function standardizeEmail(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().toLowerCase();
}

/** Reduce a phone number to digits with an optional leading +, normalizing 00 → +. */
export function standardizePhone(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/[^\d+]/g, "");
  return digits.replace(/^00/, "+");
}

/**
 * Dice coefficient on character bigrams — a fast 0..1 string similarity that is
 * forgiving of typos/word-order without an external dependency.
 */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 0 : 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = (s: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      map.set(bg, (map.get(bg) ?? 0) + 1);
    }
    return map;
  };

  const aMap = bigrams(a);
  const bMap = bigrams(b);
  let intersection = 0;
  for (const [bg, count] of aMap) {
    const other = bMap.get(bg) ?? 0;
    intersection += Math.min(count, other);
  }
  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}
