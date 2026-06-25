// EP-GOLDEN-TRIANGLE — leverage the "review" pattern on a coworker turn.
//
// When a coworker's posture sits high on the Quality/effort axis, the compiler
// emits deliberationPattern "review" (or "debate"). For an INTERACTIVE chat turn
// the full deliberation engine is too slow (minutes), so we run a single
// lightweight reviewer pass: a distinct reviewer persona critiques the draft and
// either approves it or returns an improved reply. This module is the pure core —
// resolve the pattern, build the reviewer prompt, interpret the verdict — so it is
// fully testable; the executor (which makes the extra model call) lives in
// lib/tak/coworker-inline-review.ts. See the work-orchestration design note.
import { compileGoldenTrianglePolicy } from "./compile";
import { getEffectivePostureForAgent, type GoldenTrianglePersistenceClient } from "./persistence";

export type CoworkerReviewPattern = "review" | "debate" | "none";

/**
 * Resolve the deliberation pattern the coworker's effective posture calls for
 * (agent → org → platform → Balanced). Returns "none" when no posture, Balanced,
 * or anything below the review rung. Fail-open.
 */
export async function resolveCoworkerReviewPattern(
  agentId: string,
  db?: GoldenTrianglePersistenceClient,
): Promise<CoworkerReviewPattern> {
  try {
    const resolved = await getEffectivePostureForAgent(agentId, null, db);
    if (!resolved) return "none";
    const decoded = compileGoldenTrianglePolicy({
      preference: resolved.preference,
      taskClass: "conversation",
      authorityScope: { kind: "wsid" },
    });
    const p = decoded.orchestrationBudget.deliberationPattern;
    return p === "review" || p === "debate" ? p : "none";
  } catch {
    return "none";
  }
}

/** The sentinel a reviewer returns when the draft needs no change. */
export const REVIEW_APPROVED = "APPROVED";

export const REVIEWER_SYSTEM_PROMPT =
  "You are a senior reviewer checking another AI coworker's draft reply before it is sent to the user. " +
  "Judge it for correctness, completeness, and clarity — you are a second pair of eyes, not the author. " +
  `If the draft is accurate and complete, reply with exactly "${REVIEW_APPROVED}" and nothing else. ` +
  "Otherwise reply with an improved version of the reply only — no preamble, no explanation, just the better reply.";

/** Pure: the reviewer's user-turn content for a given request + draft. */
export function buildReviewerUserPrompt(userRequest: string, draft: string): string {
  return [
    "The user asked:",
    userRequest.trim(),
    "",
    "The draft reply is:",
    draft.trim(),
    "",
    `Review it. Reply "${REVIEW_APPROVED}" if it is already good, otherwise return the improved reply.`,
  ].join("\n");
}

export const DEBATER_SYSTEM_PROMPT =
  "You are running a fast structured debate over another AI coworker's draft reply before it is sent to the user. " +
  "Internally steelman the strongest case FOR the draft and the strongest case AGAINST it, find the decisive tension, " +
  "then decide. You are an adversarial second mind, not the author. " +
  `If the draft still wins the debate, reply with exactly "${REVIEW_APPROVED}" and nothing else. ` +
  "Otherwise reply with the strongest synthesized reply only — no preamble, no 'for/against' notes, just the better reply.";

/** Pure: the debater's user-turn content for a given request + draft. */
export function buildDebaterUserPrompt(userRequest: string, draft: string): string {
  return [
    "The user asked:",
    userRequest.trim(),
    "",
    "The draft reply is:",
    draft.trim(),
    "",
    `Debate it (for vs. against), then reply "${REVIEW_APPROVED}" if it already wins, otherwise return the strongest synthesized reply.`,
  ].join("\n");
}

/** Pure: pick the system + user prompt for a deliberation pattern. */
export function buildDeliberationPrompt(
  pattern: "review" | "debate",
  userRequest: string,
  draft: string,
): { system: string; user: string } {
  return pattern === "debate"
    ? { system: DEBATER_SYSTEM_PROMPT, user: buildDebaterUserPrompt(userRequest, draft) }
    : { system: REVIEWER_SYSTEM_PROMPT, user: buildReviewerUserPrompt(userRequest, draft) };
}

export interface ReviewVerdict {
  content: string;
  revised: boolean;
}

/**
 * Pure: interpret the reviewer's raw output against the draft. Approval (or an
 * empty/blank verdict) keeps the draft; anything else is treated as the revised
 * reply. A revision that is effectively identical to the draft counts as not
 * revised (so callers don't surface a no-op "revised" flag).
 */
export function interpretReviewVerdict(draft: string, reviewerOutput: string | null | undefined): ReviewVerdict {
  const out = (reviewerOutput ?? "").trim();
  if (!out) return { content: draft, revised: false };
  // Approval sentinel — tolerate trailing punctuation/case ("approved.", "Approved").
  if (/^approved\b[.!]?$/i.test(out)) return { content: draft, revised: false };
  if (out === draft.trim()) return { content: draft, revised: false };
  return { content: out, revised: true };
}
