// EP-REMOTE-ACTION · P1 — the proposal→RemoteAction seam (DB-injected).
//
// Spec: docs/superpowers/specs/2026-06-25-convergent-remote-action-execution-design.md §4.
// When a customer APPROVES a FederatedRemediationProposal, materialize the governed
// RemoteAction rows its actions become — on the CUSTOMER's side, under the
// CUSTOMER's authority. Nothing is dispatched or executed here: there is no
// platform→Edge channel yet (P2), so every row rests at status="queued". This
// replaces the dead `executionEvidenceRef = "pending-control-runner"` stub with
// real, auditable execution intent.
//
// Sovereignty (spec §6): the MSP is recorded as `requestedByPrincipalId` and the
// link as `originLinkId`; only the customer's per-action approver may move a
// mutating action past `proposed`. Read-only actions arrive `approved` (the
// customer's proposal decision authorizes the auto class); mutating ones arrive
// `proposed` and wait.

import { randomUUID } from "crypto";

import { CONSERVATIVE_AUTHORITY_BAND, type AuthorityBand } from "./remediation-authority";
import { planRemoteActionsForProposal, type StoredProposalAction } from "./remote-action-planning";

export interface RemoteActionDb {
  remoteAction: {
    create(args: { data: Record<string, unknown> }): Promise<{ actionKey: string }>;
  };
}

export interface MaterializeProposalInput {
  proposalId: string;
  federationLinkId: string;
  edgeNodeId?: string | null;
  customerAccountId?: string | null;
  customerSiteId?: string | null;
  /** The proposal's stored actions (RemediationActionDraft[] with riskClass). */
  actions: StoredProposalAction[];
  /** The customer principal who approved the proposal (the per-action auto approver). */
  approverPrincipalId: string;
  /** The MSP (federated-peer) principal that proposed — recorded as the requester. */
  requestedByPrincipalId: string;
  /** Authority band (from the link's AuthorityBinding); defaults conservative. */
  band?: AuthorityBand;
}

export interface MaterializeProposalResult {
  created: number;
  /** Goes onto FederatedRemediationProposal.executionEvidenceRef. */
  evidenceRef: string;
  summary: string;
  refusedCount: number;
}

export async function materializeRemoteActionsForProposal(
  db: RemoteActionDb,
  input: MaterializeProposalInput,
): Promise<MaterializeProposalResult> {
  const band = input.band ?? CONSERVATIVE_AUTHORITY_BAND;
  const plan = planRemoteActionsForProposal(input.actions, band);

  let created = 0;
  for (const a of plan.toMaterialize) {
    const actionKey = `ra_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await db.remoteAction.create({
      data: {
        actionKey,
        actionType: a.actionType,
        riskClass: a.riskClass,
        parameters: a.parameters,
        originProposalRef: input.proposalId,
        originLinkId: input.federationLinkId,
        edgeNodeId: input.edgeNodeId ?? null,
        customerAccountId: input.customerAccountId ?? null,
        customerSiteId: input.customerSiteId ?? null,
        requestedByPrincipalId: input.requestedByPrincipalId,
        approvalState: a.approvalState,
        // Only the auto class is approved by the proposal decision; mutating
        // actions stay `proposed` with no approver until a per-action approval.
        approvedByPrincipalId: a.approvalState === "approved" ? input.approverPrincipalId : null,
        status: "queued",
        evidence: {
          sourceActionType: a.sourceActionType,
          rationale: a.rationale,
          dispatch: "deferred-P2-no-edge-channel",
        },
      },
    });
    created++;
  }

  return {
    created,
    evidenceRef: `remoteactions:${created}:proposal:${input.proposalId}`,
    summary: plan.summary,
    refusedCount: plan.refused.length,
  };
}
