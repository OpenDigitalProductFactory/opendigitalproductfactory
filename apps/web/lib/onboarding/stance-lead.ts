// Splitting a stance into the sentence that carries the decision and the rest.
//
// Shared by the confirmation cards (client) and the stance list (server), so
// both shorten the same way (BI-7728C3B7). Kept out of the "use client"
// component deliberately: the server page must be able to shorten text without
// pulling a client bundle in to do it.

/**
 * A stance shorter than this needs no split — collapsing a single sentence
 * would hide nothing and cost a click.
 */
const LEAD_SPLIT_THRESHOLD = 160;

export function splitStanceLead(stance: string): { lead: string; rest: string } {
  const trimmed = stance.trim();
  if (trimmed.length <= LEAD_SPLIT_THRESHOLD) return { lead: trimmed, rest: "" };
  const match = trimmed.match(/^(.*?[.!?])\s+(.*)$/s);
  if (!match) return { lead: trimmed, rest: "" };
  return { lead: match[1]!.trim(), rest: match[2]!.trim() };
}

/**
 * The lead alone, for a summary row.
 *
 * The stance list clamps its abstract to two lines with CSS, which hides the
 * text visually while leaving every word in the DOM — so a reader sees two
 * lines and the page still weighs the whole paragraph. Shortening here makes
 * what is measured match what is shown; the full stance is one click away on
 * its own page.
 */
export function stanceLead(stance: string): string {
  return splitStanceLead(stance).lead;
}
