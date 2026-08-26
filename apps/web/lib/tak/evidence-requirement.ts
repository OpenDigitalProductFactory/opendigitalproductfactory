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

import { classifyTaskClass } from "./intent-taxonomy";

/** What the user is shown when a live-data answer could not be tool-verified. */
export const INV5_UNVERIFIED_MESSAGE =
  "I couldn't verify this against live data just now — I don't want to guess at " +
  "operational numbers that might be wrong. Ask me again and I'll pull the current " +
  "figures directly, or check the relevant workspace view.";

/** Label for the quarantined draft wherever an operator surface renders it. */
export const INV5_WITHHELD_HEADING = "Unverified draft (no tool evidence — do not act on it as fact):";

/**
 * BI-0C0669B5. The guard returned ONLY INV5_UNVERIFIED_MESSAGE, so the turn's
 * real content was discarded outright. On 2026-08-26 that deleted a reviewer's
 * ~5,100-character explanation of why it was declining to record a governance
 * decision; the reasoning survived only as a truncated container-log line, so
 * nobody could tell a blocked gate from a legitimate refusal.
 *
 * The fix deliberately does NOT put the draft back in the reply. BI-B5C358B1
 * established that a fabricated operational figure must never reach the reader,
 * and a labelled fabrication is still a fabrication in front of someone
 * skimming. So the user-facing content is unchanged, and the withheld text is
 * carried alongside for the caller to persist as an internal artifact.
 */

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
  /** The matched task class (e.g. "backlog-status"), or a route label / null. */
  taskClass: string | null;
  /** The authoritative live-state tools that verify this class, when known. A
   *  turn is tool-verified iff one of these ran successfully; absent → any
   *  non-meta tool counts (Phase-1 behavior). */
  authoritativeToolNames?: readonly string[];
}

/**
 * Decide whether this turn's answer depends on live operational state and must be
 * tool-backed. Phase 2 (BI-DF3092F4) consults the data-driven task-class taxonomy
 * first; for routes the taxonomy does not yet cover it falls back to the Phase-1
 * heuristic (a route that declares domain tools + a live-state question). Both
 * paths require a live-state cue so ordinary conversational turns are never gated.
 */
export function classifyEvidenceRequirement(params: {
  routeContext?: string | null;
  /** The authoritative live-state tools the route declares (route domainTools). */
  domainTools?: readonly string[];
  message: string;
}): EvidenceRequirement {
  const message = (params.message ?? "").trim();
  if (message.length === 0) return { required: false, taskClass: null };

  // Phase 2: data-driven task-class classification.
  const tc = classifyTaskClass({ routeContext: params.routeContext, message });
  if (tc) {
    return { required: true, taskClass: tc.taskClass, authoritativeToolNames: tc.authoritativeToolNames };
  }

  // Phase-1 fallback for uncovered routes: route declares domain tools + question.
  const domainTools = params.domainTools ?? [];
  if (domainTools.length === 0) return { required: false, taskClass: null };
  const looksLikeLiveStateQuestion =
    message.includes("?") || LIVE_STATE_CUES.some((re) => re.test(message));
  return {
    required: looksLikeLiveStateQuestion,
    taskClass: looksLikeLiveStateQuestion ? (params.routeContext ?? "route") : null,
    authoritativeToolNames: looksLikeLiveStateQuestion ? domainTools : undefined,
  };
}

export interface EvidenceIntegrityDecision {
  /** The content to actually return to the user (possibly the INV-5 message). */
  content: string;
  /** True when the model's factual prose was blocked and replaced. */
  blocked: boolean;
  /** The blocked draft, preserved for the caller to persist as an internal
   *  artifact. Never rendered to the reader — see BI-0C0669B5. */
  withheldContent?: string;
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
  return { content: INV5_UNVERIFIED_MESSAGE, blocked: true, withheldContent: trimmed };
}

/** The nudge that pushes a model toward fetching live data before it answers. */
export const EVIDENCE_RECOVERY_NUDGE =
  "That question is about the CURRENT state of live operational data, which changes over time. " +
  "Do not answer from memory. Call one of your available tools to fetch the real data now, then " +
  "answer using only what the tool returns.";

/** Bounded recovery for an evidence-required turn: pass the answer, nudge once
 *  for a tool, or refuse. Keeps the agentic loop's branch small and testable. */
export type EvidenceRecoveryAction =
  | { kind: "pass" }
  | { kind: "nudge"; nudgeMessage: string }
  | { kind: "refuse"; message: string; withheldContent: string };

/**
 * Decide what the loop should do when an evidence-required turn returns text.
 * `pass` — the answer is verifiable (a tool ran) or not substantive; return it.
 * `nudge` — block the unverifiable answer and ask the model to use a tool
 *   (bounded by `maxRecoveryNudges`, default 1). `refuse` — recovery exhausted;
 *   return the could-not-verify message instead of the model's guess.
 */
export function resolveEvidenceRecovery(params: {
  required: boolean;
  authoritativeToolExecutions: number;
  authoritativeSurfaceEvidence?: boolean;
  content: string;
  recoveryNudgesUsed: number;
  maxRecoveryNudges?: number;
}): EvidenceRecoveryAction {
  const guard = enforceEvidenceIntegrity({
    required: params.required,
    authoritativeToolExecutions:
      params.authoritativeToolExecutions + (params.authoritativeSurfaceEvidence ? 1 : 0),
    content: params.content,
  });
  if (!guard.blocked) return { kind: "pass" };
  if (params.recoveryNudgesUsed < (params.maxRecoveryNudges ?? 1)) {
    return { kind: "nudge", nudgeMessage: EVIDENCE_RECOVERY_NUDGE };
  }
  return { kind: "refuse", message: INV5_UNVERIFIED_MESSAGE, withheldContent: params.content };
}
