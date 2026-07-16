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
  if (!content || !content.includes("dpf-decision")) {
    return { cleanedContent: content, decision: null };
  }

  const match = content.match(DECISION_SENTINEL_RE);
  if (!match) return { cleanedContent: content, decision: null };

  const cleanedContent = content.replace(DECISION_SENTINEL_RE, "").trim();

  let decision: CoworkerDecision | null = null;
  try {
    decision = normalizeDecision(JSON.parse(match[1]!));
  } catch {
    decision = null; // malformed JSON → strip sentinel, degrade to prose
  }

  return { cleanedContent, decision };
}

/**
 * Serialize a decision back into the sentinel string. Used by tests and any
 * future server-side emitter. Kept single-line so the content sanitizer's
 * blank-line collapse never touches it.
 */
export function formatDecisionSentinel(decision: CoworkerDecision): string {
  return `<!--dpf-decision:${JSON.stringify(decision)}-->`;
}
