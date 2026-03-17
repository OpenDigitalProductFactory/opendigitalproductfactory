"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";

async function requireOpsAccess(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "view_operations"
    )
  ) {
    throw new Error("Unauthorized");
  }
  return user.id!;
}

export async function getPromotions(status?: string) {
  await requireOpsAccess();
  return prisma.changePromotion.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      productVersion: {
        select: {
          version: true,
          gitTag: true,
          gitCommitHash: true,
          shippedBy: true,
          shippedAt: true,
          changeCount: true,
          changeSummary: true,
          digitalProduct: { select: { productId: true, name: true } },
        },
      },
    },
  });
}

export async function approvePromotion(promotionId: string, rationale: string) {
  const userId = await requireOpsAccess();
  await prisma.changePromotion.update({
    where: { promotionId },
    data: {
      status: "approved",
      approvedBy: userId,
      approvedAt: new Date(),
      rationale: rationale || null,
    },
  });
}

export async function rejectPromotion(promotionId: string, rationale: string) {
  const userId = await requireOpsAccess();
  await prisma.changePromotion.update({
    where: { promotionId },
    data: {
      status: "rejected",
      rejectedBy: userId,
      rejectedAt: new Date(),
      rationale: rationale || null,
    },
  });
}

export async function markDeployed(promotionId: string, deploymentLog?: string) {
  const userId = await requireOpsAccess();
  await prisma.changePromotion.update({
    where: { promotionId },
    data: {
      status: "deployed",
      deployedAt: new Date(),
      ...(deploymentLog ? { deploymentLog } : {}),
    },
  });
}
