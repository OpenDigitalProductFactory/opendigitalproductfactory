// EP-MSP-FEDERATION · A4 + B4 — remediation authority bands (BI-F0314DB4 /
// BI-3C21D4E2). The shared, pure decision logic the managed-services loop uses
// to turn a diagnosis into a *proposal*, gated by an authority band — reused
// verbatim by the in-org loop (A4) and the cross-org consent gate (B4). No
// second approval engine: persistence specializes the existing
// `AgentActionProposal` + `AuthorityBinding` substrate (spec §11.5).
//
// Conservative default (spec §15.4, until the founder sets pilot bands):
// only read-only actions auto-approve; anything that mutates needs a human;
// destructive actions are refused unless a band explicitly raises the ceiling.
// In the cross-org case the human is on the CUSTOMER's side and the customer's
// own runner executes — the MSP never gains standing execute rights.

export const REMEDIATION_RISK_CLASSES = [
  "read-only",
  "low",
  "medium",
  "high",
  "destructive",
] as const;
export type RemediationRiskClass = (typeof REMEDIATION_RISK_CLASSES)[number];

function riskRank(risk: RemediationRiskClass): number {
  return REMEDIATION_RISK_CLASSES.indexOf(risk);
}

export type AuthorityDecision = "auto-approve" | "needs-human-approval" | "refuse";

/**
 * An authority band, resolved from an `AuthorityBinding` (approvalMode +
 * sensitivityCeiling + authorityScope) for a given service agreement. Defaults
 * are deliberately conservative; a band is widened only by explicit agreement.
 */
export interface AuthorityBand {
  /** Highest risk class that may execute with no human in the loop. */
  autoApproveCeiling: RemediationRiskClass;
  /** Highest risk class allowed WITH human approval; above this → refuse. */
  humanApprovalCeiling: RemediationRiskClass;
}

export const CONSERVATIVE_AUTHORITY_BAND: AuthorityBand = {
  autoApproveCeiling: "read-only",
  humanApprovalCeiling: "high",
};

/** Decide how a single remediation action of `risk` is authorized under `band`. */
export function evaluateRemediationAuthority(
  risk: RemediationRiskClass,
  band: AuthorityBand = CONSERVATIVE_AUTHORITY_BAND,
): AuthorityDecision {
  const r = riskRank(risk);
  if (r <= riskRank(band.autoApproveCeiling)) return "auto-approve";
  if (r <= riskRank(band.humanApprovalCeiling)) return "needs-human-approval";
  return "refuse";
}

export interface RemediationActionDraft {
  /** e.g. "restart-service", "apply-patch", "rotate-cert", "collect-diagnostics". */
  actionType: string;
  parameters: Record<string, unknown>;
  riskClass: RemediationRiskClass;
  rationale: string;
}

export interface RemediationProposalDraft {
  incidentKey: string;
  edgeNodeId: string;
  /** organization-internal (A4) or the federation link id (B4). */
  boundaryRef: string;
  actions: Array<RemediationActionDraft & { decision: AuthorityDecision }>;
  /** The proposal's overall gate = the strictest action decision. */
  overallDecision: AuthorityDecision;
  /** Actions refused by the band are surfaced but never dispatched. */
  refusedActionTypes: string[];
}

const DECISION_STRICTNESS: Record<AuthorityDecision, number> = {
  "auto-approve": 0,
  "needs-human-approval": 1,
  refuse: 2,
};

function strictest(decisions: AuthorityDecision[]): AuthorityDecision {
  return decisions.reduce<AuthorityDecision>(
    (acc, d) => (DECISION_STRICTNESS[d] > DECISION_STRICTNESS[acc] ? d : acc),
    "auto-approve",
  );
}

/**
 * Build a remediation proposal for an incident: classify each action under the
 * band, compute the overall gate, and list refused actions. Pure — the caller
 * persists the result (as `AgentActionProposal` rows in-thread for A4, or a
 * link-scoped specialization for B4) and routes `needs-human-approval` to the
 * Attention Surface.
 */
export function buildRemediationProposal(
  input: { incidentKey: string; edgeNodeId: string; boundaryRef?: string },
  actions: RemediationActionDraft[],
  band: AuthorityBand = CONSERVATIVE_AUTHORITY_BAND,
): RemediationProposalDraft {
  const evaluated = actions.map((a) => ({
    ...a,
    decision: evaluateRemediationAuthority(a.riskClass, band),
  }));
  // Refused actions do not contribute to the executable gate; an all-refused
  // proposal still surfaces (so the operator sees what was withheld and why).
  const dispatchable = evaluated.filter((a) => a.decision !== "refuse");
  const overallDecision =
    dispatchable.length === 0 ? "refuse" : strictest(dispatchable.map((a) => a.decision));
  return {
    incidentKey: input.incidentKey,
    edgeNodeId: input.edgeNodeId,
    boundaryRef: input.boundaryRef ?? "organization:internal",
    actions: evaluated,
    overallDecision,
    refusedActionTypes: evaluated.filter((a) => a.decision === "refuse").map((a) => a.actionType),
  };
}

/** Map an `AuthorityBinding` row's posture onto an `AuthorityBand`. Unknown /
 *  missing posture falls back to the conservative band — fail closed. */
export function authorityBandFromBinding(binding?: {
  approvalMode?: string | null;
  sensitivityCeiling?: string | null;
} | null): AuthorityBand {
  if (!binding) return CONSERVATIVE_AUTHORITY_BAND;
  const ceiling = (REMEDIATION_RISK_CLASSES as readonly string[]).includes(
    binding.sensitivityCeiling ?? "",
  )
    ? (binding.sensitivityCeiling as RemediationRiskClass)
    : "high";
  // approvalMode "none" lets the band auto-approve up to its ceiling; anything
  // else keeps auto-approve at read-only (humans gate the rest).
  const autoApproveCeiling: RemediationRiskClass =
    binding.approvalMode === "none" ? ceiling : "read-only";
  return { autoApproveCeiling, humanApprovalCeiling: ceiling };
}
