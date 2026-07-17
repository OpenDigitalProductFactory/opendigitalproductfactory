// apps/web/lib/tak/evidence-requirement.ts
//
// Evidence-integrity gate (EP-E431FC8A · BI-B5C358B1). The non-negotiable
// invariant (INV-1): for a turn whose answer depends on LIVE operational state,
// zero successful authoritative tool executions must NEVER produce a factual
// operational answer. The runtime must obtain evidence or explicitly say it
// could not verify.
//
// This module is PURE (no I/O, no next-auth) so it unit-tests in isolation. The
// agentic loop calls `classifyEvidenceRequirement` once per turn and, at answer
// assembly, `enforceEvidenceIntegrity` as a terminal fail-safe.
//
// Phase-1 classifier is a deliberately conservative HEURISTIC seeded from route
// metadata (a route that declares `domainTools` is backed by authoritative
// live-state tools) plus a live-state question cue. Phase 2 (the IntentClassifier)
// replaces the heuristic; the enforcement guard is permanent.

/** What the user is shown when a live-data answer could not be tool-verified. */
export const INV5_UNVERIFIED_MESSAGE =
  "I couldn't verify this against live data just now — I don't want to guess at " +
  "operational numbers that might be wrong. Ask me again and I'll pull the current " +
  "figures directly, or check the relevant workspace view.";

/** Minimum length for a reply to count as a substantive (potentially-misleading)
 *  operational answer. Below this it is a terse acknowledgement, not a claim. */
export const SUBSTANTIVE_REPLY_MIN_CHARS = 80;

/**
 * Words that signal a question about CURRENT operational state — the class of
 * answer that must be backed by a live tool call, not the model's memory. Kept
 * deliberately small and high-precision for Phase 1.
 */
const LIVE_STATE_CUES: readonly RegExp[] = [
  /\bresolved\b/i,
  /\bstatus\b/i,
  /\bhow many\b/i,
  /\bhow much\b/i,
  /\bcount\b/i,
  /\bcurrent(ly)?\b/i,
  /\b(still )?(open|pending|outstanding|in[- ]progress|blocked|overdue|done|closed|completed)\b/i,
  /\bany (new|updates?|changes?)\b/i,
  /\bwhat('?s| is| are)\b.*\b(left|remaining|happening|going on)\b/i,
  /\blatest\b/i,
  /\bright now\b/i,
];

export interface EvidenceRequirement {
  required: boolean;
  /** Short label for observability / audit (e.g. the route prefix). */
  taskClass: string | null;
}

/**
 * Decide whether this turn's answer depends on live operational state and must be
 * tool-backed. Phase-1 heuristic: TRUE when the route exposes authoritative
 * domain tools AND the user message reads like a live-state question. Both cues
 * are required to keep false positives off ordinary conversational turns.
 */
export function classifyEvidenceRequirement(params: {
  routeContext?: string | null;
  /** The authoritative live-state tools the route declares (route domainTools). */
  domainTools?: readonly string[];
  message: string;
}): EvidenceRequirement {
  const domainTools = params.domainTools ?? [];
  const message = (params.message ?? "").trim();
  if (domainTools.length === 0 || message.length === 0) {
    return { required: false, taskClass: null };
  }
  const looksLikeLiveStateQuestion =
    message.includes("?") || LIVE_STATE_CUES.some((re) => re.test(message));
  return {
    required: looksLikeLiveStateQuestion,
    taskClass: looksLikeLiveStateQuestion ? (params.routeContext ?? "route") : null,
  };
}

export interface EvidenceIntegrityDecision {
  /** The content to actually return to the user (possibly the INV-5 message). */
  content: string;
  /** True when the model's factual prose was blocked and replaced. */
  blocked: boolean;
}

/**
 * Terminal fail-safe (INV-1/INV-5). If the turn was evidence-required and NO
 * authoritative tool executed successfully, a substantive factual answer is
 * unverifiable — replace it with the explicit could-not-verify message rather
 * than let the model's guess reach the user. Non-substantive replies (short
 * acknowledgements, clarifying questions) pass through unchanged, as do turns
 * that DID run an authoritative tool or were never evidence-required.
 *
 * Pure and deterministic; the recovery RETRY (forced tool_choice, local-pinned)
 * happens in the loop BEFORE this guard — this is the last line that guarantees
 * no fabrication even if recovery also produced no tool call.
 */
export function enforceEvidenceIntegrity(params: {
  required: boolean;
  authoritativeToolExecutions: number;
  content: string;
}): EvidenceIntegrityDecision {
  const content = params.content ?? "";
  if (!params.required) return { content, blocked: false };
  if (params.authoritativeToolExecutions > 0) return { content, blocked: false };
  // Evidence required, zero authoritative tools ran. Only block a SUBSTANTIVE
  // reply — a short "let me check" or a clarifying question is not a false claim.
  const trimmed = content.trim();
  const isSubstantive = trimmed.length >= SUBSTANTIVE_REPLY_MIN_CHARS && !trimmed.endsWith("?");
  if (!isSubstantive) return { content, blocked: false };
  return { content: INV5_UNVERIFIED_MESSAGE, blocked: true };
}
