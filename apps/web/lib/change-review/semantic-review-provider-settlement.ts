import { isRecord } from "@/lib/shared/coerce";
import { providerLedgerSettled } from "../inference/provider-settlement";
import { isSemanticReviewCapacityReason } from "./semantic-review-recovery-policy";
import { readRoutingEligibility } from "../inference/routing-exclusion-buckets";
import { restoreSemanticReviewCheckpoint } from "./semantic-change-review";
type Node = { taskNodeId: string; status?: string; requestContract?: unknown; outputSnapshot?: unknown };

/** Completed verdicts are reused. Inconclusive checkpoints may dispatch again and owe settlement. */
export function semanticNodeNeedsSettlement(node: Node): boolean {
  const output = isRecord(node.outputSnapshot) ? node.outputSnapshot : {};
  if (output.providerSettlement !== undefined) return true;
  if (node.status === "completed") {
    const contract = isRecord(node.requestContract) ? node.requestContract : {};
    const decision = restoreSemanticReviewCheckpoint(output.result, String(contract.agentId ?? "change-reviewer")).decision;
    return decision !== "pass" && decision !== "fail";
  }
  return true; // Every noncompleted original may have started effects, even with lost output.
}

/** Native persisted node proof only; client summaries and failed status are not settlement. */
export function semanticNodeProviderSettled(node: Node, requestDigest: string): boolean {
  const contract = isRecord(node.requestContract) ? node.requestContract : {};
  const output = isRecord(node.outputSnapshot) ? node.outputSnapshot : {};
  if (!/^[a-f0-9]{64}$/.test(requestDigest) || contract.requestDigest !== requestDigest
    || output.requestDigest !== requestDigest || typeof contract.generation !== "string" || !contract.generation) return false;
  if (output.providerSettlement !== undefined) return providerLedgerSettled(output.providerSettlement, { taskNodeId: node.taskNodeId,
    requestDigest, generation: contract.generation });
  // These existing typed server checkpoints attest a refusal before routing or dispatch.
  if (!["completed","superseded"].includes(node.status ?? "") || output.providerOutcome !== "not-dispatched") return false;
  const result = isRecord(output.result) ? output.result : {};
  if (result.decision !== "inconclusive" || !Array.isArray(result.issues) || result.issues.length !== 0) return false;
  const capacity = isRecord(output.capacityDeferral) ? output.capacityDeferral : {};
  if (result.inconclusiveReason === "review-capacity-deferred" && capacity.schemaVersion === 1
    && capacity.requestDigest === requestDigest && capacity.generation === contract.generation
    && isSemanticReviewCapacityReason(capacity.reason)) return true;
  return result.inconclusiveReason === "review-endpoint-ineligible" && Array.isArray(output.routingEligibility)
    && output.routingEligibility.length > 0 && output.routingEligibility.length <= 5
    && output.routingEligibility.every(value => readRoutingEligibility(value) !== null);
}
