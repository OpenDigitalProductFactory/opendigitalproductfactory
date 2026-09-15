// apps/web/lib/shared/outcome-disposition.ts
//
// What kind of answer an outcome is — §10 of the unified delivery surfaces spec
// (docs/superpowers/specs/2026-09-15-third-state-is-typed-addendum-design.md).
//
// A delivery plane has two kinds of outcome. A VERDICT is an answer: proceed, or
// refuse. A NON-VERDICT is the absence of one: a person has not ruled yet, an
// input the caller holds is missing, or the check determined nothing.
//
// `action-result.ts` next door is a two-case union (an ok branch and an error
// branch), and `ToolResult` has `success: boolean`. So every subsystem that needed to
// say "not yet" invented its own way, and there are at least eight of them
// (gate denials, coworker authority, host admission, scheduled-run tools,
// semantic review, initiative readiness, the worktree probe, the call-efficiency
// refusal set). Each is internally sound. None of them agree, and two park the
// SAME event on opposite success flags: an AgentActionProposal succeeds with
// data.status "proposed", a CoworkerActionEnvelope fails with error
// "approval_required".
//
// The cost is measured, not theorised. 183 proposals since 2026-08-26, none
// approved, including 55 copies of one run_hive_scout_ingest — a retry loop, not
// daily runs. 425 tool failures carrying "approval_required". ~4,900 of ~5,700
// failed ToolExecutions over seven days were governed refusals rather than
// faults. Coworkers proposed building tools that already existed, because a wait
// worded as a rejection reads as a missing capability.
//
// This module is the shared vocabulary those eight map onto. It does NOT replace
// them: a subsystem keeps its own domain names and declares a total mapping.
//
// Pure types + pure functions, no imports, so anything may depend on it.

/** The canonical dispositions. Closed, ordered verdict → non-verdict → verdict. */
export const OUTCOME_DISPOSITIONS = [
  "proceed",
  "awaiting-person",
  "awaiting-input",
  "inconclusive",
  "refused",
] as const;

export type OutcomeDisposition = (typeof OUTCOME_DISPOSITIONS)[number];

/**
 * How a caller should respond. Exhaustive by construction: adding a disposition
 * without deciding its retry posture does not compile.
 *
 * The three non-verdicts are kept apart because they route differently, and
 * collapsing them is how a coworker burns a turn:
 *
 *   never       re-asking polls a human. That is how 55 copies of one proposal
 *               accumulated. Report the wait; do not retry it.
 *   bounded     the caller holds the missing input. Retry within the shaping
 *               budget (GATE_SHAPING_DEFAULT), and a retry that changes nothing
 *               is refused upstream already.
 *   same-input  nothing was determined, so the input is not in question — the
 *               check re-runs unchanged. AGENTS.md §4: infrastructure failure is
 *               recorded as inconclusive and re-runs on the same SHA, never as a
 *               FAIL against the diff.
 *   none        a verdict. There is nothing to retry.
 */
export type RetryPosture = "never" | "bounded" | "same-input" | "none";

export const RETRY_POSTURE: Record<OutcomeDisposition, RetryPosture> = {
  proceed: "none",
  "awaiting-person": "never",
  "awaiting-input": "bounded",
  inconclusive: "same-input",
  refused: "none",
};

/** An answer was reached: `proceed` or `refused`. */
export function isVerdict(disposition: OutcomeDisposition): boolean {
  return disposition === "proceed" || disposition === "refused";
}

/**
 * No answer was reached. These are the states that must never be persisted or
 * handed on as a verdict — §10 rule 5. A boundary may narrow a disposition; it
 * may not map a non-verdict onto one. `inconclusive → "failed"` is the shape the
 * rule exists to forbid.
 */
export function isNonVerdict(disposition: OutcomeDisposition): boolean {
  return !isVerdict(disposition);
}

/**
 * Whether an outcome should be counted against a tool, a gate or a coworker.
 *
 * Only `refused` and `proceed` are the system's answers about the CALLER. A
 * non-verdict is a statement about the state of the world — a pending human, a
 * missing input, an unavailable check — and counting it as a failure is what
 * filed backlog items for tools that already existed.
 */
export function countsAsFailure(disposition: OutcomeDisposition): boolean {
  return disposition === "refused";
}

export function isOutcomeDisposition(value: unknown): value is OutcomeDisposition {
  return (
    typeof value === "string" &&
    (OUTCOME_DISPOSITIONS as readonly string[]).includes(value)
  );
}
