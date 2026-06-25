"use server";

// EP-MSP-FEDERATION · B4 operator surface — decide on cross-org remediation
// proposals. The customer's human approval/rejection of an MSP proposal. On
// approve we record intent; the actual execution dispatches via the control
// runner (EP-CTRL-5E21A4) when that substrate lands — the MSP never gains
// standing execute rights, and nothing runs here.

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { syncUserPrincipal } from "@/lib/identity/principal-linking";
import { can } from "@/lib/permissions";

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
    select: { proposalId: true, status: true },
  });
  if (!proposal) return { ok: false, error: "not_found", message: "Proposal not found" };
  if (proposal.status !== "proposed") {
    return { ok: false, error: "invalid_transition", message: `proposal is already ${proposal.status}` };
  }

  const status = decision === "approve" ? "approved" : "rejected";
  await prisma.federatedRemediationProposal.update({
    where: { proposalId },
    data: {
      status,
      decidedAt: new Date(),
      decidedByPrincipalId: gate.principalId,
      // Execution dispatches on the customer's own control runner when
      // EP-CTRL-5E21A4 lands; until then approval records intent only.
      ...(decision === "approve" ? { executionEvidenceRef: "pending-control-runner" } : {}),
    },
  });
  revalidatePath(ADMIN_PATH);
  return { ok: true, proposalId, status };
}
