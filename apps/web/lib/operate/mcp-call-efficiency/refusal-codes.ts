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
// The classification stays deliberately CONSERVATIVE: a code counts as governed
// only when it is classified here. An unknown code counts as a failure, so a
// genuinely broken tool is never silently excused by a gap. The cost of being
// wrong runs one way — a missed finding is re-detected on the next scan, while a
// wrongly-excused fault goes unreported.
//
// BI-AF9E4906: this used to be a `ReadonlySet<string>`, which was correct for its
// purpose and structurally unable to stay current — nothing told its author when a
// new code appeared, and it labelled `approval_required` (a WAIT on a person) and
// `branch_occupied` (a settled REFUSAL) identically. Both are fixed by classifying
// through the canonical disposition instead of by membership:
//
//   * the governed-execute seam's own rejections are DERIVED from
//     `GOVERNED_REJECTION_DISPOSITION`, which is already total over
//     `GovernedExecuteRejection` — so a new rejection is classified here the
//     moment it is classified there, and cannot go stale;
//   * the remaining codes are tool-level error strings that never pass through
//     that seam, so they carry their own total map keyed by a closed union.
//     Adding one without deciding what kind of answer it is does not compile.

import { GOVERNED_REJECTION_DISPOSITION } from "@/lib/govern/authority/governed-rejection-disposition";
import type { OutcomeDisposition } from "@/lib/shared/outcome-disposition";

/**
 * Governed outcomes that are reported as tool errors but never reach the
 * governed-execute seam, so they are absent from `GovernedExecuteRejection`.
 */
export type ToolLevelGovernedCode =
  | "initiative_not_ready"
  | "gate_evidence_blocked"
  | "traceability-incomplete"
  | "plan-artifact-invalid"
  | "insufficient_token_scope"
  | "AUTHORIZATION_DENIED"
  | "branch_occupied"
  | "scope_conflict"
  | "nonprod_lease_not_owner"
  | "lease_terminal"
  | "idempotency_conflict";

/**
 * What kind of answer each tool-level governed code is — total by construction.
 */
const TOOL_LEVEL_GOVERNED_DISPOSITION: Record<ToolLevelGovernedCode, OutcomeDisposition> = {
  // The caller holds the missing input and may supply it, bounded. Readiness
  // refusals name exactly what to record, so they are shapeable, not settled.
  initiative_not_ready: "awaiting-input",
  gate_evidence_blocked: "awaiting-input",
  "traceability-incomplete": "awaiting-input",
  "plan-artifact-invalid": "awaiting-input",

  // Settled no. Nothing the caller supplies changes the answer on this call.
  insufficient_token_scope: "refused",
  AUTHORIZATION_DENIED: "refused",
  branch_occupied: "refused",
  scope_conflict: "refused",
  nonprod_lease_not_owner: "refused",
  lease_terminal: "refused",

  // The work already exists; the duplicate call is answered, not denied.
  idempotency_conflict: "proceed",
};

/**
 * Every governed code and what kind of answer it is.
 *
 * The seam's rejections come from the single home that already classifies them,
 * so the two cannot drift apart.
 */
export const GOVERNED_CODE_DISPOSITION: Readonly<Record<string, OutcomeDisposition>> = {
  ...GOVERNED_REJECTION_DISPOSITION,
  ...TOOL_LEVEL_GOVERNED_DISPOSITION,
};

/** Retained for callers that only need "governed or fault". */
export const GOVERNED_REFUSAL_CODES: ReadonlySet<string> = new Set(
  Object.keys(GOVERNED_CODE_DISPOSITION),
);

/**
 * What kind of answer a failed ToolExecution carried, or null when the code is
 * unclassified — which stays a fault, deliberately.
 *
 * Callers that must tell a wait from a refusal read this rather than the boolean:
 * `awaiting-person` must not be retried, `awaiting-input` may be retried once the
 * named input exists, and `inconclusive` re-runs unchanged.
 */
export function governedRefusalDisposition(result: unknown): OutcomeDisposition | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const code = (result as { error?: unknown }).error;
  if (typeof code !== "string") return null;
  return GOVERNED_CODE_DISPOSITION[code] ?? null;
}

/**
 * Whether a failed ToolExecution was a governed outcome rather than a fault.
 *
 * Reads the tool's own error code out of its result payload. A result with no
 * code cannot be shown to be governed, so it stays a failure.
 */
export function isGovernedRefusal(result: unknown): boolean {
  return governedRefusalDisposition(result) !== null;
}
