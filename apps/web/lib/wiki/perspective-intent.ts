// Coworker perspective routing — WWMD vs WWWD intent detection.
// BI-F5179C9E. Relates to EP-WWMD-MCP slice C3 (WWMD-vs-WWWD routing rules)
// and EP-COWORKER-RT (persona/grant audit).
//
// When an employee asks a coworker "what would Mark think about this?" the
// question carries two implicit signals the generic wiki recall path misses:
//
//   1. A *perspective*: "what would/does Mark…" wants Mark's personal platform
//      doctrine (WWMD — his stance/heuristic corpus). "what would *we*…" wants
//      the organization's collective doctrine (WWWD — the org perspective
//      profile + decision-perspective feature).
//   2. A *deictic referent*: "this" / "that" / "it" only resolves against the
//      page the employee is currently viewing. Embedding the bare pronoun
//      pollutes retrieval, which is why the coworker fell back to
//      "'this' isn't specific".
//
// This module is pure (no I/O): it classifies the message, enriches the
// retrieval query with the current page topic, names the page-kinds to bias
// retrieval toward, and produces a short prompt hint that tells the coworker
// how to answer in the detected perspective. The caller (agent-coworker
// recall assembly) wires it into `recallWikiContext`.

export type WikiPerspective = "wwmd" | "wwwd";

export type PerspectiveClassification = {
  /** Detected perspective, or null when the message isn't a WWMD/WWWD question. */
  perspective: WikiPerspective | null;
  /**
   * True when the message leans on a deictic pronoun (this/that/it/here…) that
   * needs the current page as referent. Drives query enrichment.
   */
  needsPageContext: boolean;
};

// "What Would Mark Do" — the founder's personal platform/product doctrine.
// Named-person intent is the more specific signal, so WWMD is tested first.
const WWMD_PATTERNS: RegExp[] = [
  /\bwwmd\b/i,
  /\bwhat\s+(?:would|does|did|do|might|should)\s+mark\b/i,
  /\bwould\s+mark\b/i,
  /\bmark['’]s\s+(?:take|view|stance|position|opinion|call|thinking|preference|read|instinct)\b/i,
  /\bwhat\s+(?:is|was)\s+mark['’]s\b/i,
  /\bask\s+mark\b/i,
];

// "What Would We Do" — the organization's collective operating doctrine.
const WWWD_PATTERNS: RegExp[] = [
  /\bwwwd\b/i,
  /\bwhat\s+(?:would|should|do|did)\s+we\b/i,
  /\bwould\s+we\b/i,
  /\bshould\s+we\b/i,
  /\bour\s+(?:take|view|stance|position|opinion|call|policy|approach)\b/i,
  /\bhow\s+should\s+we\b/i,
];

// Deictic tokens that only resolve against the current page.
const DEICTIC_PATTERN =
  /\b(this|that|these|those|it|here|the\s+(?:page|above|current\s+\w+))\b/i;

/**
 * Classify a free-text employee message for perspective intent.
 *
 * WWMD wins over WWWD when both match (a message that names Mark is asking for
 * his view specifically). Returns `perspective: null` for ordinary questions —
 * the caller then takes the unchanged generic-recall path.
 */
export function classifyPerspective(message: string): PerspectiveClassification {
  const text = message ?? "";
  const needsPageContext = DEICTIC_PATTERN.test(text);

  if (WWMD_PATTERNS.some((re) => re.test(text))) {
    return { perspective: "wwmd", needsPageContext };
  }
  if (WWWD_PATTERNS.some((re) => re.test(text))) {
    return { perspective: "wwwd", needsPageContext };
  }
  return { perspective: null, needsPageContext };
}

/**
 * Page-kinds to bias wiki retrieval toward per perspective. The caller passes
 * these to `recallWikiContext` as a *soft* preference (preferred-first with a
 * general top-up), so a sparse corpus never yields a worse answer than today.
 *
 * WWMD favours Mark's recorded opinions (stance/heuristic) and resolved calls
 * (decision). WWWD additionally pulls governance principles, which is where the
 * organization's collective doctrine accretes.
 */
export const PERSPECTIVE_PAGE_KINDS: Record<WikiPerspective, string[]> = {
  wwmd: ["stance", "heuristic", "decision"],
  wwwd: ["stance", "heuristic", "principle", "decision"],
};

/**
 * Derive a short topic string for the page the employee is viewing, used to
 * resolve deictic pronouns in the retrieval query. Prefers the first
 * meaningful line of the page-data block; falls back to a humanised route
 * segment. Returns null when neither yields anything usable.
 */
export function extractPageTopic(
  routeData: string | null | undefined,
  routeContext: string | null | undefined,
): string | null {
  if (routeData) {
    const firstLine = routeData
      .split("\n")
      .map((l) =>
        l
          .replace(/-{2,}\s*PAGE DATA\s*-{2,}/i, "")
          .replace(/^[-*#\s]+/, "")
          .trim(),
      )
      .find((l) => l.length > 0);
    if (firstLine) {
      return firstLine.slice(0, 120);
    }
  }

  if (routeContext) {
    const segment = routeContext
      .split(/[?#]/)[0]
      .split("/")
      .filter(Boolean)
      .pop();
    if (segment) {
      const humanised = segment
        .replace(/[-_]+/g, " ")
        .replace(/\[(.+?)\]/g, "$1")
        .trim();
      if (humanised) return humanised.slice(0, 120);
    }
  }

  return null;
}

/**
 * Build the retrieval query. When the message uses a deictic pronoun and we
 * have a page topic, lead with the topic so the embedding is anchored to what
 * the employee is actually looking at, while preserving the original phrasing
 * so the perspective semantics ("mark think") still contribute. Otherwise the
 * message is returned unchanged.
 */
export function buildPerspectiveQuery(
  message: string,
  pageTopic: string | null,
): string {
  if (pageTopic && DEICTIC_PATTERN.test(message ?? "")) {
    return `${pageTopic}. ${message}`;
  }
  return message;
}

/**
 * A short prompt block telling the coworker how to answer in the detected
 * perspective. Injected into the wiki-context slot so it lands even when
 * retrieval returned nothing — that empty-retrieval case is exactly the
 * "I don't have enough evidence" dead-end we're fixing: the coworker should
 * still attribute correctly and lean on PAGE DATA / offer to capture the gap,
 * not fabricate.
 */
export function buildPerspectiveHint(
  perspective: WikiPerspective,
  pageTopic: string | null,
): string {
  const topicClause = pageTopic ? ` The page in front of the employee is about: ${pageTopic}.` : "";

  if (perspective === "wwmd") {
    return [
      "PERSPECTIVE — WHAT WOULD MARK DO (WWMD):",
      "The employee is asking for Mark Bodman's personal platform/product doctrine — his recorded positions, not your own opinion.",
      "Ground the answer in the stance and heuristic wiki context above (his views) and the PAGE DATA below to resolve what \"this\" refers to." +
        topicClause,
      "Attribute clearly (\"Mark's position is…\"). If the wiki context doesn't cover this specific topic, say so plainly, summarise the closest recorded view, and offer to capture his stance — never invent his opinion.",
    ].join(" ");
  }

  return [
    "PERSPECTIVE — WHAT WOULD WE DO (WWWD):",
    "The employee is asking for the organization's collective call, not Mark's personal opinion.",
    "Answer from the organization's operating principles in the wiki context above and the PAGE DATA below." +
      topicClause,
    "Note: the organization's WWWD corpus is still seeded from the platform doctrine, so where org-specific guidance is absent the answer currently follows Mark's platform doctrine — say so rather than implying a settled collective position.",
    "When this is a genuine decision among options, frame it as a collective decision to be routed through the decision-perspective flow rather than asserting a single answer as fact.",
  ].join(" ");
}
