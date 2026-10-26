import type { InitiativeReadinessDecision, ReadinessRequirementResult } from "@/lib/backlog/initiative-readiness/types";
import type { SweepEvaluation } from "./acceptance-sweep-run";
import type { RetainedSmallCheck } from "@/lib/runtime-coordination/small-acceptance-binding";

/**
 * Legacy objective mappings validate the reviewer packet at write time but do
 * not persist its revision binding. Execution evidence has no typed revision
 * binding either. Neither can discharge post-deployment acceptance. Keep this
 * gap in the existing owed snapshot; never fabricate a receipt or dispatch the
 * same exhausted mapping again. BI-E3B918C2 tracks the missing evidence contract.
 */
export function retainedAcceptanceWithoutBinding(
  decision: InitiativeReadinessDecision, excludedAgentIds: string[], smallCheck?: RetainedSmallCheck,
): SweepEvaluation {
  const small = decision.shapeDecision?.effective === "small";
  const requirement: ReadinessRequirementResult = {
    code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: small ? smallCheck?.state ?? "missing" : "missing",
    accountableRole: small ? "delivery-coordinator" : "acceptance-reviewer",
    evidenceRefs: small ? smallCheck?.evidenceRefs ?? [] : [], evidenceLane: small && smallCheck?.state !== "missing" && smallCheck ? "gate-receipt" : "none", unreadEvidenceRefs: [],
    nextAction: small
      ? "Delivery remains done. Record a fresh final-acceptance runtime check on this Workroom with the exact canonical closure backlogActivityId; the server binds its actual served revision. Failed checks need repair, never a deployment-only PASS."
      : "Delivery remains done. Independent acceptance is unresolved: the stored evidence does not bind its reviewer and applicable deployed revision. Reconcile the acceptance binding under BI-E3B918C2; do not repeat an exhausted review or treat deployment as PASS.",
  };
  const keep = (row: ReadinessRequirementResult) => row.code !== requirement.code;
  const independent: InitiativeReadinessDecision = {
    ...decision, satisfied: [...decision.satisfied.filter(keep), ...(requirement.state === "pass" ? [requirement] : [])],
    blockers: decision.blockers.filter(keep), unmet: [...decision.unmet.filter(keep), ...(requirement.state === "pass" ? [] : [requirement])],
    verdict: decision.blockers.filter(keep).length ? "denied" : decision.unmet.filter(keep).length || requirement.state !== "pass" ? "input-required" : "allowed",
  };
  const owed = [...independent.blockers, ...independent.unmet].map(({code,state,accountableRole,nextAction}) => ({code,state,accountableRole,nextAction}));
  return { decision: independent, owed, owner: null, closable: independent.verdict === "allowed", excludedAgentIds,
    unroutable: owed.map(row => ({code: row.code, accountableRole: row.accountableRole,
      reason: "unresolved", nextAction: row.nextAction })),
  };
}
