// apps/web/lib/govern/authority/governed-rejection-disposition.ts
//
// What kind of answer each governed rejection is. Lives beside the authority
// gate rather than inside the execute seam, which the module-size ratchet
// rightly refused to let grow further — the same reason approval-pending-result
// was split out next door.

import type { GovernedExecuteRejection } from "@/lib/mcp-governed-execute";
import type { OutcomeDisposition } from "@/lib/shared/outcome-disposition";

/**
 * What kind of answer each rejection is (§10 of the unified delivery surfaces
 * spec). Exhaustive `Record` keyed by the union, exactly as
 * `GATE_DENIAL_CONTRACT` is: adding a rejection reason without deciding what it
 * MEANS does not compile. §9 of that spec directed this for "every gate
 * requirement and definition — now and for those built later"; this is the
 * governed-execute chokepoint, which every tool call passes through.
 *
 * Five of these thirteen are not refusals, and all thirteen used to render as
 * "<tool> rejected: …". That is why a coworker handed a pending approval
 * concluded the tool did not exist and proposed building it.
 */
export const GOVERNED_REJECTION_DISPOSITION: Record<
  GovernedExecuteRejection,
  OutcomeDisposition
> = {
  // Settled no. The caller asked for something it may not have, or that is not
  // there. Retrying is pointless and a person has nothing to rule on.
  unknown_tool: "refused",
  forbidden_capability: "refused",
  forbidden_grant: "refused",
  hook_denied: "refused",
  authority_denied: "refused",
  alignment_denied: "refused",
  alignment_bypass_forbidden: "refused",
  precondition_denied: "refused",

  // Parked on a human. Never retried — re-asking polls a person, which is how
  // 55 copies of one proposal accumulated.
  approval_required: "awaiting-person",
  alignment_escalation_required: "awaiting-person",
  precondition_escalation_required: "awaiting-person",

  // No answer was reached, and the caller's request is not in question. The
  // authority evidence could not be written, or the receipt could not be
  // reserved — infrastructure, so the call re-runs unchanged rather than
  // counting against the caller (AGENTS.md §4). The MCP route already treats
  // authority_evidence_unavailable as HTTP 503 rather than a 4xx, which is this
  // same judgement made at the transport layer.
  authority_evidence_unavailable: "inconclusive",
  receipt_reservation_failed: "inconclusive",
};


/**
 * How a rejection is worded to the model.
 *
 * "Rejected" is a claim about the CALLER, and only a settled no earns it. An
 * inconclusive outcome says the check itself could not run — that is not a
 * verdict against the request, and wording it as one is what taught coworkers to
 * read a governed platform as a broken one, then file work to replace tools that
 * already existed.
 *
 * `error` and `success` are deliberately untouched by this: callers and the
 * scheduled-run verdict classifier key on them, so the disposition adds a signal
 * rather than moving one.
 */
export function rejectionMessage(
  toolName: string,
  detail: string,
  disposition: OutcomeDisposition,
): string {
  return disposition === "inconclusive"
    ? `${toolName} could not be checked: ${detail} This is not a refusal — the check itself was unavailable, and the call can be retried unchanged.`
    : `${toolName} rejected: ${detail}`;
}
