// apps/web/lib/owner-first/ux-audit.ts
//
// Owner-first UX checks (BI-3BCAF95F acceptance: "Add UX checks for word count,
// link/button count, small controls, repeated generic decision labels, repeated
// Technical detail, and owner-first next-action presence").
//
// The live UX audit measured the domain pages with exactly these signals — 818
// words, 56 links/buttons, 34 small controls, "Make this business decision?" ×29,
// "Technical detail" ×32. This module turns those signals into pure functions that
// run against rendered HTML, so a test (or a future route sweep) can assert a
// surface stays owner-first instead of drifting back into a subsystem dashboard.
//
// The functions operate on an HTML string (e.g. renderToStaticMarkup output). They
// are deliberately markup-shaped, not DOM-dependent, so they run anywhere.

/** The generic, non-owner decision labels the audit flagged as overload. */
export const GENERIC_DECISION_LABELS = [
  "Make this business decision?",
  "Review this decision",
  "Approve this bill?",
  "Send this message?",
] as const;

/** Phrase that, when repeated, signals builder detail leaking onto an owner surface. */
export const TECHNICAL_DETAIL_PHRASE = "Technical detail";

/** Structural marker a compliant owner-first summary stamps on its next-action control. */
export const OWNER_FIRST_NEXT_ACTION_ATTR = "data-owner-first-next-action";

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|nbsp|#x27|#39);/g, (m) => ENTITY_MAP[m] ?? m);
}

/** Strip tags and collapse whitespace to the visible text of a markup string. */
export function visibleText(html: string): string {
  const withoutTags = html.replace(/<[^>]*>/g, " ");
  return decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
}

/**
 * Elements that flow INSIDE a phrase rather than starting a new one. Everything
 * not listed here — headings, cells, list items, buttons, paragraphs, divs,
 * `<br>` — ends the current utterance.
 *
 * `<a>` is inline on purpose: "read the <a>setup guide</a> first" is one
 * sentence, and treating every anchor as a boundary would shred real body copy.
 * A nav link still lands in its own utterance because the markup wraps it in a
 * list item or a div.
 */
const INLINE_ELEMENTS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "dfn", "em", "i",
  "kbd", "mark", "q", "rp", "rt", "ruby", "s", "samp", "small", "span",
  "strong", "sub", "sup", "time", "u", "var", "wbr",
]);

// A character HTML text can never contain, so splitting on it cannot cut a word.
const UTTERANCE_BREAK = "\u0000";

const NAMED_TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;

/**
 * The surface's visible text split into UTTERANCES — one heading, one table
 * cell, one button label, one nav item, one paragraph each.
 *
 * `visibleText` deliberately flattens all of that into a single space-joined
 * string, which is right for counting words and wrong for anything that needs
 * sentence boundaries: a UI carries its boundaries in its ELEMENTS, not in full
 * stops (BI-0ED0F6B3). Pair this with `analyzeUiReadability`.
 */
export function visibleUtterances(html: string): string[] {
  const marked = String(html).replace(NAMED_TAG_RE, (_m, name: string) =>
    INLINE_ELEMENTS.has(name.toLowerCase()) ? " " : UTTERANCE_BREAK,
  );
  // Comments, doctypes and anything else tag-shaped but unnamed: drop as before.
  return decodeEntities(marked.replace(/<[^>]*>/g, " "))
    .split(UTTERANCE_BREAK)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0);
}

/** Visible word count. */
export function countWords(html: string): number {
  const text = visibleText(html);
  if (text.length === 0) return 0;
  return text.split(/\s+/).length;
}

/** Every interactive control — anchors and buttons. */
export function countControls(html: string): number {
  return (html.match(/<a\b/gi)?.length ?? 0) + (html.match(/<button\b/gi)?.length ?? 0);
}

// A "small control" is a link/button whose type scale is below a comfortable tap
// label. The audit flagged text-[9px]/text-[10px] controls; those are hard to read
// and hard to hit. We match a control open-tag whose class list carries a tiny
// text token.
const SMALL_TEXT_TOKENS = ["text-[9px]", "text-[10px]", "text-[11px]"];

/** Controls rendered at a sub-legible type scale. */
export function countSmallControls(html: string): number {
  const controlTags = html.match(/<(?:a|button)\b[^>]*>/gi) ?? [];
  return controlTags.filter((tag) => SMALL_TEXT_TOKENS.some((tok) => tag.includes(tok))).length;
}

/** How many times a phrase appears in the visible text (case-sensitive). */
export function countPhrase(html: string, phrase: string): number {
  if (phrase.length === 0) return 0;
  const text = visibleText(html);
  let count = 0;
  let idx = text.indexOf(phrase);
  while (idx !== -1) {
    count += 1;
    idx = text.indexOf(phrase, idx + phrase.length);
  }
  return count;
}

/** Total occurrences of any generic (non-owner) decision label. */
export function countGenericDecisionLabels(html: string): number {
  return GENERIC_DECISION_LABELS.reduce((sum, label) => sum + countPhrase(html, label), 0);
}

/** Occurrences of the "Technical detail" phrase. */
export function countTechnicalDetail(html: string): number {
  return countPhrase(html, TECHNICAL_DETAIL_PHRASE);
}

/** True when the markup carries at least one stamped owner-first next action. */
export function hasOwnerFirstNextAction(html: string): boolean {
  return html.includes(OWNER_FIRST_NEXT_ACTION_ATTR);
}

export type OwnerFirstMetrics = {
  wordCount: number;
  controlCount: number;
  smallControlCount: number;
  genericDecisionLabelCount: number;
  technicalDetailCount: number;
  hasOwnerFirstNextAction: boolean;
};

/** Measure a markup string against every owner-first signal at once. */
export function measureOwnerFirst(html: string): OwnerFirstMetrics {
  return {
    wordCount: countWords(html),
    controlCount: countControls(html),
    smallControlCount: countSmallControls(html),
    genericDecisionLabelCount: countGenericDecisionLabels(html),
    technicalDetailCount: countTechnicalDetail(html),
    hasOwnerFirstNextAction: hasOwnerFirstNextAction(html),
  };
}

export type OwnerFirstThresholds = {
  maxWords: number;
  maxControls: number;
  maxSmallControls: number;
  maxGenericDecisionLabels: number;
  maxTechnicalDetail: number;
  requireOwnerFirstNextAction: boolean;
};

/** Sensible defaults for an owner-first SUMMARY band (not a whole page). The band
 *  leads the page; the professional detail behind it is not measured here. */
export const OWNER_FIRST_SUMMARY_THRESHOLDS: OwnerFirstThresholds = {
  maxWords: 160,
  maxControls: 12,
  maxSmallControls: 0,
  maxGenericDecisionLabels: 0,
  maxTechnicalDetail: 0,
  requireOwnerFirstNextAction: true,
};

export type OwnerFirstFinding = {
  check: string;
  ok: boolean;
  detail: string;
};

/** Evaluate metrics against thresholds; returns one finding per check. */
export function evaluateOwnerFirst(
  metrics: OwnerFirstMetrics,
  thresholds: OwnerFirstThresholds,
): OwnerFirstFinding[] {
  return [
    {
      check: "word-count",
      ok: metrics.wordCount <= thresholds.maxWords,
      detail: `${metrics.wordCount} words (max ${thresholds.maxWords})`,
    },
    {
      check: "control-count",
      ok: metrics.controlCount <= thresholds.maxControls,
      detail: `${metrics.controlCount} links/buttons (max ${thresholds.maxControls})`,
    },
    {
      check: "small-controls",
      ok: metrics.smallControlCount <= thresholds.maxSmallControls,
      detail: `${metrics.smallControlCount} sub-legible controls (max ${thresholds.maxSmallControls})`,
    },
    {
      check: "generic-decision-labels",
      ok: metrics.genericDecisionLabelCount <= thresholds.maxGenericDecisionLabels,
      detail: `${metrics.genericDecisionLabelCount} generic decision labels (max ${thresholds.maxGenericDecisionLabels})`,
    },
    {
      check: "repeated-technical-detail",
      ok: metrics.technicalDetailCount <= thresholds.maxTechnicalDetail,
      detail: `"${TECHNICAL_DETAIL_PHRASE}" ×${metrics.technicalDetailCount} (max ${thresholds.maxTechnicalDetail})`,
    },
    {
      check: "owner-first-next-action",
      ok: thresholds.requireOwnerFirstNextAction ? metrics.hasOwnerFirstNextAction : true,
      detail: metrics.hasOwnerFirstNextAction
        ? "owner-first next action present"
        : "no owner-first next action found",
    },
  ];
}

/** Convenience: audit a markup string end-to-end. `ok` is true iff every check passes. */
export function auditOwnerFirst(
  html: string,
  thresholds: OwnerFirstThresholds = OWNER_FIRST_SUMMARY_THRESHOLDS,
): { ok: boolean; metrics: OwnerFirstMetrics; findings: OwnerFirstFinding[] } {
  const metrics = measureOwnerFirst(html);
  const findings = evaluateOwnerFirst(metrics, thresholds);
  return { ok: findings.every((f) => f.ok), metrics, findings };
}
