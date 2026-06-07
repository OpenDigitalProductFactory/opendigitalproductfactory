"use server";

// Approval-UI server actions for scheduled research proposals (BI-8A58C65A
// slice E). Approving a proposal wires the onApproved seam to
// enqueueResearchExecution (slice C) — so approval is the single gate between
// a scheduled proposal and a real (web+LLM) research run that lands a draft.

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import {
  approveResearch,
  declineResearch,
  listPendingResearchProposals,
  type PendingResearchProposal,
} from "@/lib/wiki/research-proposal";
import { enqueueResearchExecution } from "@/lib/wiki/research-execution";

async function currentOrgId(): Promise<string | null> {
  const org = await prisma.organization.findFirst({ select: { id: true } });
  return org?.id ?? null;
}

export async function listPendingResearchProposalsAction(): Promise<PendingResearchProposal[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  const orgId = await currentOrgId();
  if (!orgId) return [];
  return listPendingResearchProposals(orgId);
}

export async function approveResearchProposalAction(
  proposalId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not authenticated" };

  const res = await approveResearch(
    { proposalId, decidedByUserId: session.user.id },
    // The gate: on approval, enqueue the actual research execution (slice C).
    { onApproved: (p) => enqueueResearchExecution(p) },
  );
  return res.approved ? { ok: true } : { ok: false, error: "Proposal is no longer pending." };
}

export async function declineResearchProposalAction(
  proposalId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not authenticated" };

  const res = await declineResearch({ proposalId, decidedByUserId: session.user.id });
  return res.declined ? { ok: true } : { ok: false, error: "Proposal is no longer pending." };
}
