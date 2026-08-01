// Universal Grid & Workbooks — Find & Replace (EP-GRID-WORKBOOKS,
// visual-refinement spec S5: Excel-grade cell interactions).
//
// Excel's Ctrl+F / Ctrl+H over the grid. Pure geometry + string ops so the whole
// thing is unit-testable: the Grid owns the search bar, the highlight class, the
// scroll-to-match, and routes each replacement through the validated `persistCell`.
//
// Matching is done against the *searchable text* of a cell (whatever the user
// sees), so Find spans every field type. Replace only rewrites cells whose stored
// value is a string (text / url / email / phone / select) — replacing inside a
// number or date's rendered form would corrupt the typed value, and Excel itself
// scopes replace to the cell's text content.

/** A matched cell, addressed by row/col indices into the *displayed* order. */
export interface FindMatch {
  row: number;
  col: number;
}

export interface FindOptions {
  /** Case-sensitive match (default: false — case-insensitive, like Excel). */
  matchCase?: boolean;
  /** Match only when the whole cell equals the query (default: false — substring). */
  wholeCell?: boolean;
}

/** UI state for the in-grid find/replace bar. */
export interface FindUiState {
  mode: "find" | "replace";
  query: string;
  replacement: string;
  matchCase: boolean;
  wholeCell: boolean;
}

/** True if `text` matches `query` under the given options. Empty query never matches. */
export function textMatches(text: string, query: string, opts: FindOptions = {}): boolean {
  if (query === "") return false;
  const t = opts.matchCase ? text : text.toLowerCase();
  const q = opts.matchCase ? query : query.toLowerCase();
  return opts.wholeCell ? t === q : t.includes(q);
}

/**
 * All matching cells in row-major (top-to-bottom, left-to-right) order — the order
 * Excel's Find Next walks. `getText(row, col)` returns a cell's searchable text.
 */
export function findMatches(
  maxRow: number,
  maxCol: number,
  getText: (row: number, col: number) => string,
  query: string,
  opts: FindOptions = {},
): FindMatch[] {
  const matches: FindMatch[] = [];
  if (query === "") return matches;
  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c <= maxCol; c++) {
      if (textMatches(getText(r, c), query, opts)) matches.push({ row: r, col: c });
    }
  }
  return matches;
}

/** Step the active-match index by `dir` (+1 next, -1 prev) with wraparound. -1 if none. */
export function stepMatch(index: number, total: number, dir: 1 | -1): number {
  if (total <= 0) return -1;
  return (((index + dir) % total) + total) % total;
}

/** Escape a string for use as a literal inside a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** How many times `query` occurs in `value` under the options (whole-cell → 0 or 1). */
export function countOccurrences(value: string, query: string, opts: FindOptions = {}): number {
  if (query === "") return 0;
  if (opts.wholeCell) return textMatches(value, query, opts) ? 1 : 0;
  const re = new RegExp(escapeRegExp(query), opts.matchCase ? "g" : "gi");
  const m = value.match(re);
  return m ? m.length : 0;
}

/**
 * Replace occurrences of `query` with `replacement` in `value`. Whole-cell replaces
 * the entire value (when it matches); otherwise every occurrence is replaced. Returns
 * the original string unchanged when there is no match, so callers can skip no-op writes.
 */
export function replaceInText(
  value: string,
  query: string,
  replacement: string,
  opts: FindOptions = {},
): string {
  if (query === "") return value;
  if (opts.wholeCell) {
    return textMatches(value, query, opts) ? replacement : value;
  }
  const re = new RegExp(escapeRegExp(query), opts.matchCase ? "g" : "gi");
  return value.replace(re, replacement);
}
