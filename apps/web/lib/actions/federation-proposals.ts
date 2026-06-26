"use server";

// EP-MSP-FEDERATION · B4 operator surface — decide on cross-org remediation
// proposals. The customer's human approval/rejection of an MSP proposal. On
// approve we materialize the governed RemoteAction rows the proposal becomes
// (EP-REMOTE-ACTION P1, on the CUSTOMER's side): read-only actions reach
// `approved`, mutating ones reach `proposed`, and NOTHING dispatches — there is no
// platform→Edge channel yet (P2). The MSP never gains standing execute rights.

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { syncUserPrincipal } from "@/lib/identity/principal-linking";
import { can } from "@/lib/permissions";
import {
  materializeRemoteActionsForProposal,
  type RemoteActionDb,
} from "@/lib/service-desk/remote-action-execution";
import { type StoredProposalAction } from "@/lib/service-desk/remote-action-planning";

const ADMIN_PATH = "/platform/federation-proposals";

type ActionFailure = {
  ok: false;
  error: "unauthorized" | "forbidden" | "not_found" | "invalid_input" | "invalid_transition" | "internal_error";
  message: string;
};

async function assertManagePlatform(): Promise<
  { ok: true; principalId: string } | ActionFailure
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "unauthorized", message: "Sign in required" };
  if (!can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_platform")) {
    return { ok: false, error: "forbidden", message: "manage_platform capability required" };
  }
  const alias = await prisma.principalAlias.findFirst({
    where: { aliasType: "user", aliasValue: session.user.id },
    select: { principalId: true },
  });
  if (alias?.principalId) return { ok: true, principalId: alias.principalId };
  const synced = await syncUserPrincipal(session.user.id);
  return { ok: true, principalId: synced.id };
}

export type ProposalDecisionResult =
  | { ok: true; proposalId: string; status: string }
  | ActionFailure;

export async function decideFederatedProposalAction(
  proposalId: string,
  decision: "approve" | "reject",
): Promise<ProposalDecisionResult> {
  const gate = await assertManagePlatform();
  if (!gate.ok) return gate;
  if (decision !== "approve" && decision !== "reject") {
    return { ok: false, error: "invalid_input", message: "decision must be approve or reject" };
  }
  const proposal = await prisma.federatedRemediationProposal.findUnique({
    where: { proposalId },
    select: { proposalId: true, status: true, actions: true, federationLinkId: true, edgeNodeId: true },
  });
  if (!proposal) return { ok: false, error: "not_found", message: "Proposal not found" };
  if (proposal.status !== "proposed") {
    return { ok: false, error: "invalid_transition", message: `proposal is already ${proposal.status}` };
  }

  if (decision === "reject") {
    await prisma.federatedRemediationProposal.update({
      where: { proposalId },
      data: { status: "rejected", decidedAt: new Date(), decidedByPrincipalId: gate.principalId },
    });
    revalidatePath(ADMIN_PATH);
    return { ok: true, proposalId, status: "rejected" };
  }

  // Approve: materialize the governed RemoteAction rows (the proposal→RemoteAction
  // seam, EP-REMOTE-ACTION P1). The MSP that proposed is recorded as the requester,
  // the link as origin; read-only actions land `approved`, mutating ones `proposed`.
  // Conservative band for P1 — per-agreement bands (AuthorityBinding) widen it once
  // the founder sets the §15.4 pilot bands. Nothing dispatches (no P2 channel).
  const link = await prisma.federationLink.findUnique({
    where: { linkId: proposal.federationLinkId },
    select: { principalId: true },
  });
  const actions = Array.isArray(proposal.actions)
    ? (proposal.actions as unknown as StoredProposalAction[])
    : [];
  const result = await materializeRemoteActionsForProposal(prisma as unknown as RemoteActionDb, {
    proposalId: proposal.proposalId,
    federationLinkId: proposal.federationLinkId,
    edgeNodeId: proposal.edgeNodeId,
    actions,
    approverPrincipalId: gate.principalId,
    requestedByPrincipalId: link?.principalId ?? `federated-peer:${proposal.federationLinkId}`,
  });
  await prisma.federatedRemediationProposal.update({
    where: { proposalId },
    data: {
      status: "approved",
      decidedAt: new Date(),
      decidedByPrincipalId: gate.principalId,
      executionEvidenceRef: result.evidenceRef,
    },
  });
  revalidatePath(ADMIN_PATH);
  return { ok: true, proposalId, status: "approved" };
}
