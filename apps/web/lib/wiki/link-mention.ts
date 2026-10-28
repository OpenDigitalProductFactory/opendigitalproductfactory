// BI-4EAFF7AC: find where a wiki page body names another page without linking
// to it, and wrap that mention as a link.
//
// Shared by the backlinks reader (which lists unlinked mentions) and the overlay
// editor (which pre-wraps the mention when a person picks "Link it"), so both
// agree on what counts as a mention. A mention is a whole-word occurrence of the
// target's title or last slug segment in prose: text inside fenced code, inline
// code, or an existing `[[link]]` is never a mention.

const WORD_CHAR = "[\\p{L}\\p{N}_-]";

/** The phrases that name a page: its last slug segment and its title, longest first. */
export function mentionTerms(page: { title: string; slug: string }): string[] {
  const segment = page.slug.split("/").pop() ?? page.slug;
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of [segment, page.title]) {
    const term = raw.trim();
    if (term.length < 3 || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    terms.push(term);
  }
  return terms.sort((a, b) => b.length - a.length);
}

/** Same-length copy of the body with code and existing links blanked to spaces. */
function maskNonProse(body: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  let fence: string | null = null;
  const lines = body.split("\n").map((line) => {
    const opener = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === null && opener) {
      fence = opener;
      return blank(line);
    }
    if (fence !== null) {
      if (line.trim().startsWith(fence)) fence = null;
      return blank(line);
    }
    return line;
  });
  return lines
    .join("\n")
    .replace(/`[^`\n]*`/g, blank)
    .replace(/\[\[[^\]\n]*\]\]/g, blank);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The earliest whole-word mention of any term in prose, with the author's own spelling. */
export function findMention(body: string, terms: string[]): { index: number; text: string } | null {
  const masked = maskNonProse(body);
  let best: { index: number; text: string } | null = null;
  for (const term of terms) {
    const pattern = new RegExp(`(?<!${WORD_CHAR})${escapeRegExp(term)}(?!${WORD_CHAR})`, "iu");
    const match = pattern.exec(masked);
    if (match && (best === null || match.index < best.index)) {
      best = { index: match.index, text: body.slice(match.index, match.index + match[0].length) };
    }
  }
  return best;
}

/** Wrap the first plain mention as `[[slug|text]]`, or null when there is none. */
export function wrapFirstMention(body: string, slug: string, terms: string[]): string | null {
  const mention = findMention(body, terms);
  if (!mention) return null;
  const end = mention.index + mention.text.length;
  return `${body.slice(0, mention.index)}[[${slug}|${mention.text}]]${body.slice(end)}`;
}

/**
 * What the overlay editor opens with when a person picks "Link it": the body
 * with the first mention wrapped, a notice saying nothing is saved yet, and a
 * revision summary. When the mention is gone, the body is left as it was.
 */
export function prepareLinkMention(
  body: string,
  target: { slug: string; title: string },
): { body: string; notice: string; changeSummary: string | undefined } {
  const wrapped = wrapFirstMention(body, target.slug, mentionTerms(target));
  if (wrapped === null) {
    return { body, notice: `No plain mention of "${target.title}" is left on this page to link.`, changeSummary: undefined };
  }
  return {
    body: wrapped,
    notice: `A link to "${target.title}" has been added to the first mention below. Review it, then save. Nothing has changed yet.`,
    changeSummary: `Link the mention of ${target.title}`,
  };
}
