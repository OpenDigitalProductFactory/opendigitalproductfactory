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

// Re-export Promotion type shape for the UI component
export type PromotionRow = Awaited<ReturnType<typeof getPromotions>>[number];

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

/**
 * Execute an approved promotion through the full pipeline:
 * validate → check window → backup → extract diff → scan destructive → apply → health check
 */
export async function executePromotionAction(
  promotionId: string,
  overrideReason?: string,
) {
  await requireOpsAccess();
  const { executePromotion } = await import("@/lib/sandbox-promotion");
  return executePromotion(promotionId, overrideReason);
}

/**
 * Acknowledge destructive operations in a promotion's migrations.
 * Required before deploying promotions that contain DROP, TRUNCATE, etc.
 */
export async function acknowledgeDestructiveOps(promotionId: string) {
  await requireOpsAccess();
  await prisma.changePromotion.update({
    where: { promotionId },
    data: { destructiveAcknowledged: true },
  });
}

/**
 * Get deployment window availability for a promotion.
 * Returns current window status without requiring the promotion to be approved.
 */
export async function getPromotionWindowStatus(promotionId: string) {
  await requireOpsAccess();

  const promotion = await prisma.changePromotion.findUnique({
    where: { promotionId },
    include: {
      changeItem: {
        include: { changeRequest: { select: { type: true, riskLevel: true } } },
      },
    },
  });
  if (!promotion) return { available: false, message: "Promotion not found" };

  const rfcType = promotion.changeItem?.changeRequest?.type ?? "normal";
  const riskLevel = promotion.changeItem?.changeRequest?.riskLevel ?? "low";

  const profile = await prisma.businessProfile.findFirst({
    where: { isActive: true },
    include: { deploymentWindows: true, blackoutPeriods: true },
  });

  if (!profile) return { available: true, message: "No business profile configured — deployment unrestricted." };

  const now = new Date();

  // Check blackouts
  const activeBlackout = profile.blackoutPeriods.find(
    (bp) => bp.startAt <= now && bp.endAt >= now && !bp.exceptions.includes(rfcType),
  );
  if (activeBlackout) {
    return {
      available: false,
      message: `Blackout active until ${activeBlackout.endAt.toISOString()}. Reason: ${activeBlackout.reason ?? "Scheduled blackout"}.`,
      blackoutEnd: activeBlackout.endAt.toISOString(),
    };
  }

  // Check windows
  const { isNowInWindow } = await import("@/lib/sandbox-promotion");
  const matchingWindows = profile.deploymentWindows.filter(
    (w) => w.allowedChangeTypes.includes(rfcType) && w.allowedRiskLevels.includes(riskLevel),
  );

  if (matchingWindows.length === 0) {
    return { available: true, message: "No deployment windows configured — deployment unrestricted." };
  }

  if (isNowInWindow(matchingWindows)) {
    return { available: true, message: "Deployment window is open now." };
  }

  const windowSummary = matchingWindows
    .map((w) => `${w.name}: days ${w.dayOfWeek.join(",")}, ${w.startTime}-${w.endTime}`)
    .join("; ");

  return {
    available: false,
    message: `Not in a deployment window. Available: ${windowSummary}`,
    windows: windowSummary,
  };
}
