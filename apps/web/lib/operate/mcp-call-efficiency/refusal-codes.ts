// A governed refusal is not a tool failure.
//
// `ToolExecution.success` is false for two entirely different events: a tool that
// broke, and a gate that correctly said no. The call-efficiency scan counted both,
// so a governed gate doing its job read as a misbehaving tool and got filed as a
// `high_failure` finding recommending `fix_instructions` — agent guidance, for a
// tool with nothing wrong with it.
//
// Measured on the live install over seven days (2026-09-02): of ~5,700 failed
// ToolExecutions, roughly 4,900 were governed refusals — `gate_evidence_blocked`
// alone was 4,520 — against ~235 genuine caller defects. Two of the four
// MCP-efficiency backlog items open at the time existed only because of this
// conflation, and each one costs the next agent a pass to discover there is
// nothing to fix.
//
// The classification is deliberately CONSERVATIVE: a code is treated as a refusal
// only when it is listed here. An unknown code counts as a failure, so a genuinely
// broken tool is never silently excused by a gap in this list. The cost of being
// wrong runs one way — a missed finding is re-detected on the next scan, while a
// wrongly-excused fault goes unreported.

/**
 * Error codes where the tool worked and a policy declined the action.
 *
 * Add a code here only when the refusal means "the system correctly said no",
 * never merely "this call did not succeed".
 */
export const GOVERNED_REFUSAL_CODES: ReadonlySet<string> = new Set([
  // Readiness / completion policy declined the transition.
  "initiative_not_ready",
  "gate_evidence_blocked",
  "traceability-incomplete",
  "plan-artifact-invalid",
  // The action needs a human or a higher authority first.
  "approval_required",
  "alignment_escalation_required",
  "insufficient_token_scope",
  "AUTHORIZATION_DENIED",
  // Another holder owns the resource; declining is the correct answer.
  "branch_occupied",
  "scope_conflict",
  "nonprod_lease_not_owner",
  "lease_terminal",
  // The request duplicates work already recorded.
  "idempotency_conflict",
]);

/**
 * Whether a failed ToolExecution was a governed refusal rather than a fault.
 *
 * Reads the tool's own error code out of its result payload. A result with no
 * code cannot be shown to be a refusal, so it stays a failure.
 */
export function isGovernedRefusal(result: unknown): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const code = (result as { error?: unknown }).error;
  return typeof code === "string" && GOVERNED_REFUSAL_CODES.has(code);
}
