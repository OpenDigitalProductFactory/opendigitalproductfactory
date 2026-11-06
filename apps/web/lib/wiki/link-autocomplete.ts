// BI-2F7BE778: the `[[` the author is typing, and the link that replaces it
// (spec 2026-10-14 knowledge-linking §7). Pure text functions, shared by the
// editor and the suggestion route.

/** Characters typed after `[[` before suggestions are fetched (AC-KLE-1). */
export const LINK_QUERY_MIN_LENGTH = 2;

export type OpenLinkQuery = {
  /** Index of the opening `[[`. */
  start: number;
  /** What the author typed between `[[` and the caret. */
  query: string;
};

/**
 * The open `[[…` before `caret`, if the caret sits inside one: no `]]`, no
 * `|` label and no line break between the `[[` and the caret.
 */
export function findOpenLinkQuery(text: string, caret: number): OpenLinkQuery | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("[[");
  if (start < 0) return null;
  const query = before.slice(start + 2);
  if (/[\]|\n[]/.test(query)) return null;
  return { start, query };
}

/** A title written as a label must not close or split the link. */
function safeLabel(title: string): string {
  return title
    .replace(/\|/g, "/")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Replace `text[range.start, range.end)` (the open `[[query`) with
 * `[[slug|title]]`. A `]]` the author already typed right after the caret is
 * absorbed, so it is not doubled. Returns the new text and the caret after
 * the inserted link.
 */
export function insertWikiLink(
  text: string,
  range: { start: number; end: number },
  page: { slug: string; title: string },
): { text: string; caret: number } {
  const link = `[[${page.slug}|${safeLabel(page.title)}]]`;
  const end = text.startsWith("]]", range.end) ? range.end + 2 : range.end;
  return { text: text.slice(0, range.start) + link + text.slice(end), caret: range.start + link.length };
}
