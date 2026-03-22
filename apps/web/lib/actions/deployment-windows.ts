"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma, type Prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

// ─── Auth Guard ──────────────────────────────────────────────────────────────

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

// ─── Query Functions ─────────────────────────────────────────────────────────

/**
 * Returns the active business profile with deployment windows and blackout periods.
 */
export async function getBusinessProfile() {
  await requireOpsAccess();

  return prisma.businessProfile.findFirst({
    where: { isActive: true },
    include: {
      deploymentWindows: true,
      blackoutPeriods: true,
    },
  });
}

/**
 * Returns deployment windows matching the RFC type and risk level,
 * excluding those blocked by active blackout periods.
 *
 * @param rfcType - The change request type (e.g. "normal", "standard", "emergency")
 * @param riskLevel - The risk level (e.g. "low", "medium", "high", "critical")
 * @param proposedDate - Optional date to check blackout periods against (defaults to now)
 */
export async function getAvailableWindows(
  rfcType: string,
  riskLevel: string,
  proposedDate?: Date
) {
  await requireOpsAccess();

  const profile = await prisma.businessProfile.findFirst({
    where: { isActive: true },
    include: {
      deploymentWindows: true,
      blackoutPeriods: true,
    },
  });

  if (!profile) return [];

  // Filter windows by allowed change types AND allowed risk levels
  const matchingWindows = profile.deploymentWindows.filter(
    (w) =>
      w.allowedChangeTypes.includes(rfcType) &&
      w.allowedRiskLevels.includes(riskLevel)
  );

  // Check blackout periods at the proposed date (or now)
  const checkDate = proposedDate ?? new Date();

  const activeBlackouts = profile.blackoutPeriods.filter(
    (bp) => bp.startAt <= checkDate && bp.endAt >= checkDate
  );

  // If no active blackouts, all matching windows are available
  if (activeBlackouts.length === 0) return matchingWindows;

  // Check if any blackout blocks this change type
  const isBlocked = activeBlackouts.some(
    (bp) => !bp.exceptions.includes(rfcType)
  );

  if (isBlocked) return [];

  // All active blackouts have exceptions for this rfcType — windows remain available
  return matchingWindows;
}

/**
 * Checks for other RFCs in scheduled/in-progress status that target overlapping
 * inventory entities or digital products in the same time window.
 *
 * @param rfcId - The RFC ID to check conflicts for
 * @param plannedStartAt - Proposed start time
 * @param plannedEndAt - Proposed end time
 */
export async function checkSchedulingConflicts(
  rfcId: string,
  plannedStartAt: Date,
  plannedEndAt: Date
) {
  await requireOpsAccess();

  // Get the change items for this RFC to know which entities it targets
  const thisRfc = await prisma.changeRequest.findUnique({
    where: { rfcId },
    include: { changeItems: true },
  });

  if (!thisRfc) throw new Error(`RFC not found: ${rfcId}`);

  const targetEntityIds = thisRfc.changeItems
    .map((ci) => ci.inventoryEntityId)
    .filter((id): id is string => id != null);

  const targetProductIds = thisRfc.changeItems
    .map((ci) => ci.digitalProductId)
    .filter((id): id is string => id != null);

  // If no target entities or products, no conflicts possible
  if (targetEntityIds.length === 0 && targetProductIds.length === 0) {
    return { hasConflicts: false, conflicts: [] };
  }

  // Find overlapping RFCs in scheduled or in-progress status
  const overlappingRfcs = await prisma.changeRequest.findMany({
    where: {
      rfcId: { not: rfcId },
      status: { in: ["scheduled", "in-progress"] },
      plannedStartAt: { lt: plannedEndAt },
      plannedEndAt: { gt: plannedStartAt },
    },
    include: { changeItems: true },
  });

  // Check each overlapping RFC for entity/product overlap
  const conflicts: Array<{
    rfcId: string;
    title: string;
    status: string;
    plannedStartAt: Date | null;
    plannedEndAt: Date | null;
    overlappingEntityIds: string[];
    overlappingProductIds: string[];
  }> = [];

  for (const otherRfc of overlappingRfcs) {
    const otherEntityIds = otherRfc.changeItems
      .map((ci) => ci.inventoryEntityId)
      .filter((id): id is string => id != null);

    const otherProductIds = otherRfc.changeItems
      .map((ci) => ci.digitalProductId)
      .filter((id): id is string => id != null);

    const overlappingEntityIds = targetEntityIds.filter((id) =>
      otherEntityIds.includes(id)
    );
    const overlappingProductIds = targetProductIds.filter((id) =>
      otherProductIds.includes(id)
    );

    if (overlappingEntityIds.length > 0 || overlappingProductIds.length > 0) {
      conflicts.push({
        rfcId: otherRfc.rfcId,
        title: otherRfc.title,
        status: otherRfc.status,
        plannedStartAt: otherRfc.plannedStartAt,
        plannedEndAt: otherRfc.plannedEndAt,
        overlappingEntityIds,
        overlappingProductIds,
      });
    }
  }

  return { hasConflicts: conflicts.length > 0, conflicts };
}

// ─── Mutation Functions ──────────────────────────────────────────────────────

/**
 * Creates a business profile with typed input.
 */
export async function createBusinessProfile(input: {
  profileKey: string;
  name: string;
  description?: string;
  businessHours: Record<string, unknown>;
  timezone?: string;
  hasStorefront?: boolean;
  lowTrafficWindows?: Record<string, unknown>;
}) {
  await requireOpsAccess();

  const profile = await prisma.businessProfile.create({
    data: {
      profileKey: input.profileKey,
      name: input.name,
      description: input.description ?? null,
      businessHours: input.businessHours as Prisma.InputJsonValue,
      timezone: input.timezone ?? "UTC",
      hasStorefront: input.hasStorefront ?? false,
      ...(input.lowTrafficWindows ? { lowTrafficWindows: input.lowTrafficWindows as Prisma.InputJsonValue } : {}),
    },
  });

  revalidatePath("/ops");
  return profile;
}

/**
 * Creates a deployment window for a business profile.
 */
export async function createDeploymentWindow(input: {
  businessProfileId: string;
  windowKey: string;
  name: string;
  description?: string;
  dayOfWeek: number[];
  startTime: string;
  endTime: string;
  maxConcurrentChanges?: number;
  allowedChangeTypes?: string[];
  allowedRiskLevels?: string[];
  enforcement?: string;
}) {
  await requireOpsAccess();

  const window = await prisma.deploymentWindow.create({
    data: {
      businessProfileId: input.businessProfileId,
      windowKey: input.windowKey,
      name: input.name,
      description: input.description ?? null,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      maxConcurrentChanges: input.maxConcurrentChanges ?? 1,
      allowedChangeTypes: input.allowedChangeTypes ?? ["standard", "normal"],
      allowedRiskLevels: input.allowedRiskLevels ?? ["low", "medium"],
      enforcement: input.enforcement ?? "advisory",
    },
  });

  revalidatePath("/ops");
  return window;
}

/**
 * Creates a blackout period for a business profile.
 */
export async function createBlackoutPeriod(input: {
  businessProfileId: string;
  name: string;
  reason?: string;
  startAt: Date;
  endAt: Date;
  scope?: string;
  exceptions?: string[];
  calendarEventId?: string;
}) {
  await requireOpsAccess();

  const blackout = await prisma.blackoutPeriod.create({
    data: {
      businessProfileId: input.businessProfileId,
      name: input.name,
      reason: input.reason ?? null,
      startAt: input.startAt,
      endAt: input.endAt,
      scope: input.scope ?? "all",
      exceptions: input.exceptions ?? [],
      calendarEventId: input.calendarEventId ?? null,
    },
  });

  revalidatePath("/ops");
  return blackout;
}
