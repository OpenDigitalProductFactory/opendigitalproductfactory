// Coworker button-decision carrier (EP-COWORKER-INTERACTIVITY, BI-3237B5D6).
// Spec: docs/superpowers/specs/2026-07-16-coworker-button-decision-interface.md
//
// P1 carrier: the coworker emits a machine-readable decision as an HTML-comment
// sentinel at the very end of its message, e.g.
//   <!--dpf-decision:{"prompt":"Where should I start?","options":[
//     {"label":"Fix the render first","recommended":true},
//     {"label":"Prioritize the CLI saturation"}]}-->
// This module extracts + validates it and returns the human-visible content with
// the sentinel stripped. The sentinel rides inside AgentMessage.content (already
// persisted + refetched), so P1 needs no schema migration. The blessed decision
// vocabulary is AttentionActionKind (lib/attention/types.ts) — kept in sync via
// DECISION_OPTION_KINDS below. P2 promotes this to a typed AgentMessage.decision
// column (tracked follow-up); this parser stays the single validation seam.

/** Decision-option kinds — the SAME vocabulary as AttentionActionKind
 *  (lib/attention/types.ts). Kept as a runtime list here for validation; keep
 *  the two in sync. Drives button styling; semantics are advisory in P1. */
export const DECISION_OPTION_KINDS = [
  "approve",
  "reject",
  "request-changes",
  "answer",
  "open-in-context",
  "dismiss",
  "snooze",
] as const;

export type DecisionOptionKind = (typeof DECISION_OPTION_KINDS)[number];

const OPTION_KIND_SET = new Set<string>(DECISION_OPTION_KINDS);

/** Max options rendered as buttons — beyond this, the coworker should be asking
 *  a genuinely open question, so we cap and let the free-text input carry it. */
export const MAX_DECISION_OPTIONS = 6;

export type CoworkerDecisionOption = {
  /** Stable id (slug of label + index); echoed for keys/analytics. */
  id: string;
  /** Button text. */
  label: string;
  /** What gets submitted as the user's reply when clicked. Defaults to label. */
  value: string;
  /** Styling/semantic hint from the shared vocabulary. Defaults to "answer". */
  kind: DecisionOptionKind;
  /** At most one option is recommended → rendered as the primary button. */
  recommended?: boolean;
};

export type CoworkerDecision = {
  /** The question, e.g. "Where should I start?". Optional for the degenerate
   *  proceed-case (a single "Go" button needs no restated prompt). */
  prompt?: string;
  options: CoworkerDecisionOption[];
  /** Whether the free-text input remains an "Other…" escape hatch. Default true
   *  — buttons are the default, never a cage. */
  freeTextAllowed: boolean;
};

// Non-greedy JSON capture between the sentinel markers. `[\s\S]` so it spans
// newlines even though the coworker is instructed to keep it on one line.
const DECISION_SENTINEL_RE = /<!--\s*dpf-decision:\s*(\{[\s\S]*?\})\s*-->/;

function slugify(label: string, index: number): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base ? `${base}-${index}` : `option-${index}`;
}

function normalizeOption(raw: unknown, index: number): CoworkerDecisionOption | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;

  const label = typeof rec.label === "string" ? rec.label.replace(/\s+/g, " ").trim() : "";
  if (!label) return null;

  const value =
    typeof rec.value === "string" && rec.value.trim() ? rec.value.trim() : label;

  const kind: DecisionOptionKind =
    typeof rec.kind === "string" && OPTION_KIND_SET.has(rec.kind)
      ? (rec.kind as DecisionOptionKind)
      : "answer";

  const option: CoworkerDecisionOption = {
    id: typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : slugify(label, index),
    label,
    value,
    kind,
  };
  if (rec.recommended === true) option.recommended = true;
  return option;
}

/**
 * Normalize an arbitrary parsed value into a valid CoworkerDecision, or null.
 * Enforces: ≥1 valid option, ≤MAX_DECISION_OPTIONS, at most one `recommended`
 * (first wins), deduped labels, freeTextAllowed defaulting to true.
 */
export function normalizeDecision(input: unknown): CoworkerDecision | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const rec = input as Record<string, unknown>;

  if (!Array.isArray(rec.options)) return null;

  const seenLabels = new Set<string>();
  const options: CoworkerDecisionOption[] = [];
  let recommendedTaken = false;

  for (const raw of rec.options) {
    if (options.length >= MAX_DECISION_OPTIONS) break;
    const option = normalizeOption(raw, options.length);
    if (!option) continue;
    const dedupeKey = option.label.toLowerCase();
    if (seenLabels.has(dedupeKey)) continue;
    seenLabels.add(dedupeKey);
    if (option.recommended) {
      if (recommendedTaken) {
        delete option.recommended; // only the first recommended stays primary
      } else {
        recommendedTaken = true;
      }
    }
    options.push(option);
  }

  if (options.length === 0) return null;

  const decision: CoworkerDecision = {
    options,
    freeTextAllowed: rec.freeTextAllowed !== false, // default true
  };
  const prompt =
    typeof rec.prompt === "string" ? rec.prompt.replace(/\s+/g, " ").trim() : "";
  if (prompt) decision.prompt = prompt;
  return decision;
}

/**
 * Extract a decision sentinel from coworker message content.
 *
 * Returns the human-visible content with the sentinel stripped, plus the parsed
 * decision (or null when absent/malformed). Malformed sentinels are still
 * stripped so no raw `<!--dpf-decision:…-->` ever reaches the transcript. Pure +
 * side-effect free — safe to call at render time on every message.
 */
export function parseDecisionFromContent(content: string): {
  cleanedContent: string;
  decision: CoworkerDecision | null;
} {
  if (!content) return { cleanedContent: content, decision: null };

  // 1. Prefer an explicit sentinel when present.
  if (content.includes("dpf-decision")) {
    const match = content.match(DECISION_SENTINEL_RE);
    if (match) {
      const cleanedContent = content.replace(DECISION_SENTINEL_RE, "").trim();
      let decision: CoworkerDecision | null = null;
      try {
        decision = normalizeDecision(JSON.parse(match[1]!));
      } catch {
        decision = null; // malformed JSON → strip sentinel, then try prose below
      }
      // A malformed sentinel is still stripped; fall back to prose on the cleaned text.
      return { cleanedContent, decision: decision ?? deriveDecisionFromProse(cleanedContent) };
    }
  }

  // 2. No sentinel — recover buttons from a clear prose choice (content unchanged).
  return { cleanedContent: content, decision: deriveDecisionFromProse(content) };
}

/**
 * Serialize a decision back into the sentinel string. Used by tests and any
 * future server-side emitter. Kept single-line so the content sanitizer's
 * blank-line collapse never touches it.
 */
export function formatDecisionSentinel(decision: CoworkerDecision): string {
  return `<!--dpf-decision:${JSON.stringify(decision)}-->`;
}

// --- Prose fallback ---------------------------------------------------------
// The coworker is *instructed* to emit a sentinel, but a smaller model does not
// always comply — it sometimes ends on a plain "…A, or B?" question with no
// sentinel (observed live: Haiku 4.5 skipped it on a follow-up turn). This
// deterministic fallback recovers buttons for the highest-confidence case: a
// final question that ENUMERATES alternatives with a "comma-or" (", or ").
//
// The comma-or guard is deliberate. It fires on a real choice
// ("break this into work items, or move to the next priority?") but NOT on a
// noun disjunction ("tagged for reliability or incidents?", which has no comma)
// — a wrong button is worse than no button, so we only act on the strong signal.

// Lead-in phrases that precede the actual options in a choice question. Applied
// to the question head AND to each split clause: a coworker routinely repeats the
// lead-in on the second option ("…, or would you prefer to review the data?"), and
// without stripping it the button reads "Would you prefer to review the data"
// instead of the imperative "Review the data".
const PROSE_LEADIN_RE =
  /^(?:what(?:'s| is) your call|what would you like(?: me to do)?|which would you prefer|would you (?:like me to|prefer(?: to)?|rather)|do you want me to|want me to|should i|shall i|shall we|should we|do you want to|do you want)\b[\s,:—–-]*/i;

const PROSE_OPTION_PREFIX_RE = /^(?:perhaps|maybe|instead|else|or|either)\s+/i;

const PROSE_LABEL_MAX = 56;

/**
 * Upper bound on a single option clause (BI-AE7058FB).
 *
 * This was 90, which rejected how coworkers actually phrase a substantive choice.
 * Observed live on /customer during the EP-UX-AUDITOR portal survey: "…start by
 * analyzing the onboarding journey for your highest-value accounts to surface the
 * most critical friction points, or would you prefer to review the underlying
 * customer data and engagement metrics first?" — a textbook two-option closeout
 * whose first clause is ~117 characters. The 90-cap rejected it, so the whole
 * decision returned null and the human got no buttons at all.
 *
 * The cap is not what protects against a wrong button — the STRUCTURAL guards do:
 * the comma-or must sit inside the FINAL question, there must be 2-3 parts, no
 * clause may contain sentence punctuation, and labels must be distinct. Display
 * length is already handled separately by PROSE_LABEL_MAX truncation. So this
 * bound exists only to reject runaway prose, and 160 leaves real closeouts room
 * while still refusing anything paragraph-sized.
 */
const PROSE_CLAUSE_MAX = 160;

/** Isolate the final sentence when the trimmed content ends with a question. */
function finalQuestion(content: string): string | null {
  const trimmed = content.trim();
  if (!/\?\s*$/.test(trimmed)) return null;
  const body = trimmed.replace(/\?+\s*$/, "");
  // Start of the last sentence = after the last sentence terminator / newline.
  let start = 0;
  for (const m of body.matchAll(/[.!?\n]+\s+/g)) {
    start = m.index! + m[0].length;
  }
  return body.slice(start).trim() || null;
}

/**
 * Derive a decision from a coworker's plain-prose closeout when no sentinel was
 * emitted. Conservative by construction — returns null unless the final question
 * clearly enumerates 2–3 alternatives via a comma-or, each a clean clause.
 */
export function deriveDecisionFromProse(content: string): CoworkerDecision | null {
  if (!content || !/,\s+or\s+/i.test(content)) return null;

  const question = finalQuestion(content);
  // Require the comma-or to live inside the FINAL question, not earlier prose.
  if (!question || !/,\s+or\s+/i.test(question)) return null;

  // Drop a leading lead-in clause: an explicit verb phrase, or a short prefix
  // terminated by an em/en dash or colon (e.g. "What's your call — ").
  let body = question.replace(PROSE_LEADIN_RE, "");
  body = body.replace(/^[^—–:]{0,44}[—–:]\s*/, (m) => (/,\s+or\s+/i.test(m) ? m : ""));
  body = body.replace(PROSE_LEADIN_RE, "").trim();

  const rawParts = body.split(/,\s+or\s+/i);
  if (rawParts.length < 2 || rawParts.length > 3) return null;

  const options: CoworkerDecisionOption[] = [];
  rawParts.forEach((part, index) => {
    const clause = part
      .replace(PROSE_OPTION_PREFIX_RE, "")
      // A repeated lead-in on the second option ("or would you prefer to …")
      // would otherwise become the button text verbatim.
      .replace(PROSE_LEADIN_RE, "")
      .replace(/\s+/g, " ")
      .replace(/[.,;:\s]+$/, "")
      .trim();
    // Guardrails: each option must be a clean, sentence-free clause with letters.
    if (clause.length < 4 || clause.length > PROSE_CLAUSE_MAX) return;
    if (!/[a-z]/i.test(clause)) return;
    if (/[.!?]/.test(clause)) return; // a period/bang means we split across sentences
    const value = clause.charAt(0).toUpperCase() + clause.slice(1);
    const label =
      value.length > PROSE_LABEL_MAX ? `${value.slice(0, PROSE_LABEL_MAX - 1).trimEnd()}…` : value;
    const option: CoworkerDecisionOption = {
      id: slugify(clause, index),
      label,
      value,
      kind: "answer",
    };
    if (index === 0) option.recommended = true;
    options.push(option);
  });

  // All parts must have survived the guards, and labels must be distinct.
  if (options.length !== rawParts.length) return null;
  const labels = new Set(options.map((o) => o.label.toLowerCase()));
  if (labels.size !== options.length) return null;

  const decision: CoworkerDecision = { options, freeTextAllowed: true };
  const prompt = question.replace(/\s+/g, " ").trim();
  if (prompt) decision.prompt = prompt;
  return decision;
}
