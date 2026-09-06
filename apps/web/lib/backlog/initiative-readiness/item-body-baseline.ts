/**
 * The item body as the objective baseline for small and medium work
 * (design §4: "acceptance criteria in the item body, minted as the baseline by
 * triage — baseline from item, not from spec").
 *
 * A medium item does not earn a spec; its acceptance criteria live in the
 * backlog item body. This reads them so OBJECTIVE_BASELINE_REQUIRED can be
 * satisfied without a spec-approval receipt. It recognises two honest forms
 * and nothing looser:
 *
 *   - a heading whose text contains "acceptance" followed by list items;
 *   - list items that start with `AC-<id>` or `AC:` / `Acceptance:`.
 *
 * Prose that merely mentions acceptance is not a criterion.
 */

export type ItemBodyAcceptance = {
  criteria: string[];
  /** 1-based line numbers, so a reviewer can cite what was read. */
  anchors: number[];
};

const HEADING = /^\s{0,3}#{1,6}\s+.*acceptance/i;
const NEXT_HEADING = /^\s{0,3}#{1,6}\s+/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/;
const MARKED_BULLET = /^\s*(?:[-*+]|\d+[.)])\s+\*{0,2}(?:AC-[A-Z0-9-]+|Acceptance|AC)\b\*{0,2}\s*[:—-]?\s*(.+)$/i;

export function parseItemBodyAcceptance(body: string | null | undefined): ItemBodyAcceptance {
  const criteria: string[] = [];
  const anchors: number[] = [];
  if (!body) return { criteria, anchors };
  const lines = body.split(/\r?\n/);
  let inAcceptanceSection = false;
  for (const [index, line] of lines.entries()) {
    if (HEADING.test(line)) { inAcceptanceSection = true; continue; }
    if (inAcceptanceSection && NEXT_HEADING.test(line)) inAcceptanceSection = false;
    const marked = line.match(MARKED_BULLET);
    if (marked?.[1]?.trim()) {
      criteria.push(marked[1].trim());
      anchors.push(index + 1);
      continue;
    }
    if (inAcceptanceSection) {
      const bullet = line.match(BULLET);
      if (bullet?.[1]?.trim()) {
        criteria.push(bullet[1].trim());
        anchors.push(index + 1);
      }
    }
  }
  return { criteria, anchors };
}

/** "pass" when the body carries at least one acceptance criterion. */
export function itemBodyBaselineState(body: string | null | undefined): "pass" | "missing" {
  return parseItemBodyAcceptance(body).criteria.length > 0 ? "pass" : "missing";
}
