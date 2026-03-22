"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { createRFC, scheduleRFC } from "./change-management";

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

// ─── List Catalog Entries ──────────────────────────────────────────────────

export async function listCatalogEntries(filters?: { category?: string }) {
  await requireOpsAccess();

  const where: Record<string, unknown> = {};
  if (filters?.category) where.category = filters.category;

  // Only return entries that are currently valid
  const now = new Date();
  return prisma.standardChangeCatalog.findMany({
    where: {
      ...where,
      validFrom: { lte: now },
      OR: [
        { validUntil: null },
        { validUntil: { gt: now } },
      ],
    },
    orderBy: { title: "asc" },
    include: {
      approvedBy: {
        select: { id: true, displayName: true, firstName: true, lastName: true },
      },
    },
  });
}

// ─── Get Catalog Entry ─────────────────────────────────────────────────────

export async function getCatalogEntry(catalogKey: string) {
  await requireOpsAccess();

  const entry = await prisma.standardChangeCatalog.findUnique({
    where: { catalogKey },
    include: {
      approvedBy: {
        select: { id: true, displayName: true, firstName: true, lastName: true },
      },
    },
  });
  if (!entry) throw new Error(`Catalog entry not found: ${catalogKey}`);
  return entry;
}

// ─── Create Catalog Entry ──────────────────────────────────────────────────

export async function createCatalogEntry(input: {
  catalogKey: string;
  title: string;
  description: string;
  category: string;
  preAssessedRisk: string;
  templateItems: Array<{
    itemType: string;
    title: string;
    description?: string;
    rollbackPlan?: string;
  }>;
  approvalPolicy?: string;
  validUntil?: string;
}) {
  const userId = await requireOpsAccess();

  if (!input.catalogKey?.trim()) throw new Error("catalogKey is required");
  if (!input.title?.trim()) throw new Error("Title is required");
  if (!input.description?.trim()) throw new Error("Description is required");
  if (!["low", "medium"].includes(input.preAssessedRisk)) {
    throw new Error("Standard changes can only have low or medium risk");
  }
  if (!input.templateItems?.length) throw new Error("At least one template item is required");

  // Get the employee profile for the approver
  const profile = await prisma.employeeProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!profile) throw new Error("Employee profile not found — required to approve catalog entries");

  const entry = await prisma.standardChangeCatalog.create({
    data: {
      catalogKey: input.catalogKey.trim(),
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category,
      preAssessedRisk: input.preAssessedRisk,
      templateItems: input.templateItems as never,
      approvalPolicy: input.approvalPolicy ?? "auto",
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      approvedById: profile.id,
    },
  });

  revalidatePath("/ops");
  return { catalogKey: entry.catalogKey };
}

// ─── Create RFC from Catalog Template ──────────────────────────────────────

export async function createRFCFromCatalog(
  catalogKey: string,
  overrides?: {
    title?: string;
    description?: string;
    plannedStartAt?: string;
    plannedEndAt?: string;
    deploymentWindowId?: string;
  }
) {
  await requireOpsAccess();

  const entry = await prisma.standardChangeCatalog.findUnique({
    where: { catalogKey },
  });
  if (!entry) throw new Error(`Catalog entry not found: ${catalogKey}`);

  // Validate the entry is still valid
  const now = new Date();
  if (entry.validUntil && entry.validUntil < now) {
    throw new Error("This catalog entry has expired and needs re-assessment");
  }

  // Create RFC as standard type — skips submitted → assessed → approved
  const { rfcId } = await createRFC({
    title: overrides?.title ?? entry.title,
    description: overrides?.description ?? entry.description,
    type: "standard",
    scope: "platform",
    riskLevel: entry.preAssessedRisk,
  });

  // Create change items from template
  const templateItems = entry.templateItems as Array<{
    itemType: string;
    title: string;
    description?: string;
    rollbackPlan?: string;
  }>;

  const rfc = await prisma.changeRequest.findUnique({ where: { rfcId } });
  if (!rfc) throw new Error("RFC creation failed");

  for (let i = 0; i < templateItems.length; i++) {
    const item = templateItems[i];
    await prisma.changeItem.create({
      data: {
        changeRequestId: rfc.id,
        itemType: item.itemType,
        title: item.title,
        description: item.description ?? null,
        rollbackPlan: item.rollbackPlan ?? null,
        executionOrder: i,
      },
    });
  }

  // Standard changes auto-transition: draft → submitted → assessed → approved
  // Then schedule if dates provided
  await prisma.changeRequest.update({
    where: { rfcId },
    data: {
      status: "approved",
      submittedAt: now,
      assessedAt: now,
      approvedAt: now,
      approvedById: entry.approvedById,
      impactReport: {
        source: "standard-change-catalog",
        catalogKey: entry.catalogKey,
        preAssessedRisk: entry.preAssessedRisk,
      } as never,
    },
  });

  // If scheduling data provided, schedule immediately
  if (overrides?.plannedStartAt) {
    await scheduleRFC(
      rfcId,
      new Date(overrides.plannedStartAt),
      overrides.plannedEndAt ? new Date(overrides.plannedEndAt) : undefined,
      overrides.deploymentWindowId,
    );
  }

  revalidatePath("/ops");
  return { rfcId };
}
