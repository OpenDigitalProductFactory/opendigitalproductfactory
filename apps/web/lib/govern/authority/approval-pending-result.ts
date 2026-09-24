// apps/web/lib/govern/authority/approval-pending-result.ts
//
// How a call parked on a human decision is described to the coworker that made
// it. Lives beside the authority gate that produces the wait rather than inside
// the 800-line execute seam, which the module-size ratchet rightly refused to
// let grow further.

// Type-only, so this does not create a runtime cycle with the execute seam.
import type { GovernedExecuteResult } from "@/lib/mcp-governed-execute";

/**
 * A call parked on a human decision, worded so the model can tell it apart from
 * a refusal (BI-7561687F).
 *
 * `rejectionResult` renders every gate outcome as "<tool> rejected: ...", and a
 * coworker reading that about an approval gate cannot distinguish "a person has
 * not answered yet" from "this tool is not available to me". On the reference
 * install it consistently drew the second conclusion and proposed tech debt to
 * add tools that already exist: five pending proposals asked for
 * record_initiative_evidence and get_backlog_item, the former having 139
 * successful executions at the time. A fabricated finding is worse than
 * silence — it looks like signal and survives review.
 *
 * So this says three things the old message did not: the call is waiting, on
 * what, and that the capability is present. The last clause also removes the
 * incentive to retry, which is what turned one decision into fifty-five cards.
 *
 * `error` stays "approval_required" — callers and the run-verdict classifier
 * (BI-4F64C5D3) key on it, and this is a wording contract, not a control-flow
 * change.
 */
export function approvalPendingResult(
  toolName: string,
  detail: string,
  data: Record<string, unknown> | undefined,
): GovernedExecuteResult {
  const envelopeId = typeof data?.["envelopeId"] === "string" ? data["envelopeId"] : null;
  const expiresAt = typeof data?.["expiresAt"] === "string" ? data["expiresAt"] : null;
  const message = [
    `${toolName} is waiting for a person to approve it.`,
    envelopeId ? `Approval request ${envelopeId}${expiresAt ? `, which expires ${expiresAt}` : ""}.` : null,
    detail,
    `${toolName} is available to you — this is not a missing tool or a denied grant,`,
    "and calling it again will not advance it. Report that the work is awaiting approval.",
    "Once a person approves, the same call runs once; calling it again afterwards returns that recorded outcome.",
  ].filter(Boolean).join(" ");
  return {
    success: false,
    error: "approval_required",
    message,
    // The wording above is what a model reads; this is what code reads. Before
    // §10 the distinction existed only in the prose, so anything downstream that
    // branched on `success` — the scheduler's run verdict, the call-efficiency
    // scan, the operations map — had to re-derive "this is a wait" from an error
    // string, and each did it differently.
    disposition: "awaiting-person",
    governance: { rejected: "approval_required" },
  };
}


/**
 * BI-12E5DD91 — the identical call already ran once on a person's approval
 * (the platform ran it, or an earlier retry did). Return that recorded outcome
 * so a retry neither runs the action twice nor puts a second card in front of
 * the person.
 */
export function settledApprovalResult(
  toolName: string,
  settled: { envelopeId: string; result: unknown },
): GovernedExecuteResult {
  const recorded = settled.result && typeof settled.result === "object"
    ? settled.result as Record<string, unknown>
    : {};
  return {
    success: true,
    message: `${toolName} already ran once after a person approved it (approval request ${settled.envelopeId}). `
      + `This is its recorded outcome; it was not run again.`
      + (typeof recorded["message"] === "string" ? ` ${recorded["message"]}` : ""),
    ...(recorded["data"] !== undefined ? { data: recorded["data"] as GovernedExecuteResult["data"] } : {}),
    ...(typeof recorded["entityId"] === "string" ? { entityId: recorded["entityId"] } : {}),
    governance: { approvalReplayOf: settled.envelopeId },
  } as GovernedExecuteResult;
}
