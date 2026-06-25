// EP-MSP-FEDERATION · B4 — cross-org remediation consent routing (BI-3C21D4E2).
// The safety crux: where a remediation proposal lands once it crosses the link.
// Reuses the shared authority-band decision (remediation-authority.ts) and adds
// the cross-org consent rule: a proposal lands on the CUSTOMER's Attention
// Surface unless the CUSTOMER's OWN policy permits auto-execution for that band.
// The MSP can never decide auto-execution on a sovereign customer — it only
// proposes; the customer's own runner executes. Pure + testable.

import type { RemediationProposalDraft } from "@/lib/service-desk/remediation-authority";

export type ProposalLanding =
  | "auto-execute-on-customer"
  | "customer-attention-surface"
  | "refused";

export interface ConsentRoutingInput {
  proposal: RemediationProposalDraft;
  /** The link must be trusted (dual-approved) to exchange anything. */
  linkTrusted: boolean;
  /** The CUSTOMER's own policy permits auto-execution for this band. MSP-independent. */
  customerAllowsAuto: boolean;
}

/**
 * Decide where a proposal lands. Order of guards matters: an untrusted link or a
 * band-refused proposal is refused before any auto-execute is considered, and
 * auto-execute requires the customer's own consent — never the MSP's.
 */
export function routeRemediationProposal(input: ConsentRoutingInput): ProposalLanding {
  if (!input.linkTrusted) return "refused";
  switch (input.proposal.overallDecision) {
    case "refuse":
      return "refused";
    case "auto-approve":
      return input.customerAllowsAuto ? "auto-execute-on-customer" : "customer-attention-surface";
    case "needs-human-approval":
    default:
      return "customer-attention-surface";
  }
}

export interface FederatedProposalRecord {
  federationLinkId: string;
  incidentKey: string;
  edgeNodeId: string | null;
  actions: RemediationProposalDraft["actions"];
  overallDecision: RemediationProposalDraft["overallDecision"];
  status: "proposed";
  landing: ProposalLanding;
}

/** Shape the persisted FederatedRemediationProposal from a routed proposal. */
export function buildFederatedProposalRecord(
  federationLinkId: string,
  proposal: RemediationProposalDraft,
  landing: ProposalLanding,
): FederatedProposalRecord {
  return {
    federationLinkId,
    incidentKey: proposal.incidentKey,
    edgeNodeId: proposal.edgeNodeId,
    actions: proposal.actions,
    overallDecision: proposal.overallDecision,
    status: "proposed",
    landing,
  };
}
