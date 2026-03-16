// apps/web/lib/actions/improvements.ts
"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import * as crypto from "crypto";

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

  // Create a linked backlog item
  const itemId = `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await prisma.backlogItem.create({
    data: {
      itemId,
      title: proposal.title,
      type: "product",
      status: "open",
      body: `${proposal.description}\n\n---\nFrom improvement proposal ${proposal.proposalId}\nCategory: ${proposal.category} | Severity: ${proposal.severity}\nObserved: ${proposal.observedFriction ?? "N/A"}`,
    },
  });

  await prisma.improvementProposal.update({
    where: { proposalId },
    data: {
      status: "prioritized",
      prioritizedAt: new Date(),
      backlogItemId: itemId,
    },
  });

  revalidatePath("/ops/improvements");
  revalidatePath("/ops");
  return { success: true, backlogItemId: itemId };
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
