// apps/web/lib/actions/improvements.ts
"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { ingestBacklogItem, improvementCategoryToWorkType } from "@/lib/operate/backlog-ingest";

// ─── Allowed transitions ─────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  proposed: ["reviewed", "rejected"],
  reviewed: ["prioritized", "rejected"],
  prioritized: ["in_progress"],
  in_progress: ["implemented"],
  implemented: ["verified"],
};

async function transitionImprovement(
  proposalId: string,
  _expectedStatus: string,
  data: Record<string, unknown>,
) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const proposal = await prisma.improvementProposal.findUnique({ where: { proposalId } });
  if (!proposal) return { error: "Not found" };

  const allowed = VALID_TRANSITIONS[proposal.status];
  const targetStatus = data["status"] as string;
  if (!allowed?.includes(targetStatus)) {
    return { error: `Cannot transition from "${proposal.status}" to "${targetStatus}"` };
  }

  await prisma.improvementProposal.update({ where: { proposalId }, data: data as never });

  revalidatePath("/ops/improvements");
  return { success: true };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function reviewImprovement(proposalId: string) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };
  return transitionImprovement(proposalId, "proposed", {
    status: "reviewed",
    reviewedById: session.user.id,
    reviewedAt: new Date(),
  });
}

export async function prioritizeImprovement(proposalId: string) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const proposal = await prisma.improvementProposal.findUnique({ where: { proposalId } });
  if (!proposal) return { error: "Not found" };
  if (proposal.status !== "reviewed") return { error: `Cannot prioritize from "${proposal.status}"` };

  // The backlog item is normally created when the proposal is filed
  // (EP-INTAKE-UNIFY auto-file). Reuse it; only file one for legacy proposals
  // that predate auto-filing. Route any creation through the shared front door
  // so the item carries a workType (the historical defect was a workType-less,
  // triage-skipping direct create here).
  let backlogItemId = proposal.backlogItemId;
  if (!backlogItemId) {
    const ingest = await ingestBacklogItem({
      title: proposal.title,
      body: [
        proposal.description,
        proposal.observedFriction ? `Observed friction: ${proposal.observedFriction}` : null,
        `Category: ${proposal.category} | Severity: ${proposal.severity}`,
        `From improvement proposal ${proposal.proposalId}`,
      ]
        .filter(Boolean)
        .join("\n"),
      workType: improvementCategoryToWorkType(proposal.category),
      source: "automated-detection",
      itemIdPrefix: "IMP",
      submittedById: session.user.id,
      origin: { kind: "improvement", id: proposal.proposalId },
    });
    backlogItemId = ingest.itemId;
  }

  await prisma.improvementProposal.update({
    where: { proposalId },
    data: {
      status: "prioritized",
      prioritizedAt: new Date(),
      backlogItemId,
    },
  });

  revalidatePath("/ops/improvements");
  revalidatePath("/ops");
  return { success: true, backlogItemId };
}

export async function startImprovement(proposalId: string) {
  return transitionImprovement(proposalId, "prioritized", { status: "in_progress" });
}

export async function completeImprovement(proposalId: string) {
  return transitionImprovement(proposalId, "in_progress", { status: "implemented" });
}

export async function rejectImprovement(proposalId: string, reason: string) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const proposal = await prisma.improvementProposal.findUnique({ where: { proposalId } });
  if (!proposal) return { error: "Not found" };
  if (!["proposed", "reviewed"].includes(proposal.status)) {
    return { error: `Cannot reject from "${proposal.status}"` };
  }

  await prisma.improvementProposal.update({
    where: { proposalId },
    data: {
      status: "rejected",
      rejectionReason: reason,
      reviewedById: session.user.id,
      reviewedAt: new Date(),
    },
  });

  revalidatePath("/ops/improvements");
  return { success: true };
}

export async function verifyImprovement(proposalId: string) {
  return transitionImprovement(proposalId, "implemented", {
    status: "verified",
    verifiedAt: new Date(),
  });
}
