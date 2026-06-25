// EP-REMOTE-ACTION · P1 — pure planning for the proposal→RemoteAction seam.
//
// Spec: docs/superpowers/specs/2026-06-25-convergent-remote-action-execution-design.md.
// Turns a customer-APPROVED FederatedRemediationProposal's actions into the
// RemoteAction rows the customer's estate will (eventually) execute. Pure + tested;
// the DB orchestrator (remote-action-execution) wraps it.
//
// Two invariants live here:
//   1. Consent RE-CHECK — every action is re-evaluated against the CURRENT band,
//      never the decision frozen at proposal time (the band may have narrowed).
//   2. Per-action approval — read-only/auto-approve actions reach `approved`;
//      anything mutating reaches `proposed` and waits for an explicit per-action
//      customer approval. Approving "fix this incident" never blanket-authorizes a
//      reboot. (spec §4)

import {
  evaluateRemediationAuthority,
  REMEDIATION_RISK_CLASSES,
  type AuthorityBand,
  type RemediationRiskClass,
} from "./remediation-authority";

/** Map an A4 diagnosis verb onto the convergent RemoteAction.actionType vocabulary. */
export function mapToRemoteActionType(a4ActionType: string): string {
  const t = a4ActionType.toLowerCase();
  if (t.startsWith("collect") || t.includes("diagnostic") || t.includes("snapshot") || t.includes("usage")) {
    return "diagnostics.collect";
  }
  if (t.includes("restart-service") || t === "service.restart") return "service.restart";
  if (t.includes("restart-interface")) return "interface.restart";
  if (t.includes("rotate-cert") || t.includes("certificate")) return "cert.rotate";
  if (t.includes("patch") || t.includes("apply")) return "patch.apply";
  if (t.includes("reboot")) return "reboot";
  return a4ActionType; // faithful passthrough; riskClass still governs.
}

/** Coerce an untrusted stored riskClass; unknown ⇒ "high" (fail-safe: never auto). */
function coerceRiskClass(value: unknown): RemediationRiskClass {
  return (REMEDIATION_RISK_CLASSES as readonly string[]).includes(value as string)
    ? (value as RemediationRiskClass)
    : "high";
}

export interface StoredProposalAction {
  actionType: string;
  parameters?: Record<string, unknown>;
  riskClass: RemediationRiskClass | string;
  rationale?: string;
}

export interface PlannedRemoteAction {
  /** The mapped RemoteAction.actionType. */
  actionType: string;
  /** The original A4 verb, kept for audit. */
  sourceActionType: string;
  riskClass: RemediationRiskClass;
  parameters: Record<string, unknown>;
  /** approved (auto class) | proposed (mutating — awaits per-action approval). */
  approvalState: "approved" | "proposed";
  rationale: string;
}

export interface RemoteActionPlan {
  toMaterialize: PlannedRemoteAction[];
  refused: Array<{ actionType: string; riskClass: RemediationRiskClass; reason: string }>;
  summary: string;
}

/**
 * Plan the RemoteActions a customer-approved proposal materializes. Re-checks each
 * action against the CURRENT band; `refuse` actions are withheld (never
 * materialized). Pure — the caller persists the result and stamps the proposal's
 * executionEvidenceRef.
 */
export function planRemoteActionsForProposal(
  actions: StoredProposalAction[],
  band: AuthorityBand,
): RemoteActionPlan {
  const toMaterialize: PlannedRemoteAction[] = [];
  const refused: RemoteActionPlan["refused"] = [];

  for (const a of actions) {
    const riskClass = coerceRiskClass(a.riskClass);
    const decision = evaluateRemediationAuthority(riskClass, band); // RE-CHECK, not the frozen decision
    if (decision === "refuse") {
      refused.push({ actionType: a.actionType, riskClass, reason: "band-refused-at-execution" });
      continue;
    }
    toMaterialize.push({
      actionType: mapToRemoteActionType(a.actionType),
      sourceActionType: a.actionType,
      riskClass,
      parameters: a.parameters ?? {},
      approvalState: decision === "auto-approve" ? "approved" : "proposed",
      rationale: a.rationale ?? "",
    });
  }

  const approvedCount = toMaterialize.filter((a) => a.approvalState === "approved").length;
  const pendingCount = toMaterialize.length - approvedCount;
  const summary =
    `${toMaterialize.length} action(s): ${approvedCount} approved (read-only), ` +
    `${pendingCount} awaiting per-action approval, ${refused.length} refused. ` +
    `Dispatch deferred — Edge action channel (P2) not yet available.`;

  return { toMaterialize, refused, summary };
}
