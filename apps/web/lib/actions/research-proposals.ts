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
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

async function currentOrgId(): Promise<string | null> {
  const org = await prisma.organization.findFirst({ select: { id: true } });
  return org?.id ?? null;
}

/**
 * Authority for a research DECISION (BI-1017777D).
 *
 * A signed-in session is not authority: approving spends web/LLM budget and lands a
 * draft in the org's knowledge, and the whole point of this gate is that a *human with
 * standing* releases it. Uses the shared `can()` primitive rather than a private rule —
 * a per-surface copy is how two approval surfaces ended up with no rule at all — but
 * keeps the `{ ok, error }` shape these actions contract for, which is exactly the case
 * `shared/guards.ts` documents as not routing through `requireCapability`.
 *
 * `manage_business_models` is the capability: these proposals are scoped to a digital
 * product / product line / business product, so product-direction authority is the right
 * source — NOT the workforce org chart, which has no accountable manager for a market
 * research question. Note the two host surfaces differ in audience (`/admin/research` is
 * HR-000; the portfolio intelligence tab is view_portfolio), so portfolio VIEWERS
 * without product-direction authority can still see a proposal they cannot release.
 */
async function authorizeResearchDecision(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return { ok: false, error: "Not authenticated" };
  if (!can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_business_models")) {
    return { ok: false, error: "You do not have authority to decide research proposals." };
  }
  return { ok: true, userId: user.id };
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
  const authorized = await authorizeResearchDecision();
  if (!authorized.ok) return { ok: false, error: authorized.error };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: "No organization is configured." };

  const res = await approveResearch(
    {
      proposalId,
      organizationId: orgId,
      decidedByUserId: authorized.userId,
    },
    // The gate: on approval, enqueue the actual research execution (slice C).
    { onApproved: (p) => enqueueResearchExecution(p) },
  );
  if (!res.approved) {
    return { ok: false, error: "Proposal is no longer pending." };
  }
  revalidatePath("/portfolio", "layout");
  return { ok: true };
}

export async function declineResearchProposalAction(
  proposalId: string,
): Promise<{ ok: boolean; error?: string }> {
  const authorized = await authorizeResearchDecision();
  if (!authorized.ok) return { ok: false, error: authorized.error };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: "No organization is configured." };

  const res = await declineResearch({
    proposalId,
    organizationId: orgId,
    decidedByUserId: authorized.userId,
  });
  if (!res.declined) {
    return { ok: false, error: "Proposal is no longer pending." };
  }
  revalidatePath("/portfolio", "layout");
  return { ok: true };
}
