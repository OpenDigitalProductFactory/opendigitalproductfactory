"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { isValidTier, type QualityTier } from "@/lib/routing/quality-tiers";

const VALID_BUDGET_CLASSES = ["minimize_cost", "balanced", "quality_first"] as const;
type BudgetClass = (typeof VALID_BUDGET_CLASSES)[number];

async function requireManagePlatform(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_platform",
    )
  ) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

export async function saveAgentModelConfig(
  agentId: string,
  minimumTier: string,
  budgetClass: string,
  pinnedProviderId?: string | null,
  pinnedModelId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireManagePlatform();

  if (!isValidTier(minimumTier)) {
    return { ok: false, error: `Invalid tier: ${minimumTier}` };
  }
  if (!VALID_BUDGET_CLASSES.includes(budgetClass as BudgetClass)) {
    return { ok: false, error: `Invalid budget class: ${budgetClass}` };
  }

  await prisma.agentModelConfig.upsert({
    where: { agentId },
    update: {
      minimumTier,
      budgetClass,
      pinnedProviderId: pinnedProviderId ?? null,
      pinnedModelId: pinnedModelId ?? null,
      configuredAt: new Date(),
      configuredById: userId,
    },
    create: {
      agentId,
      minimumTier,
      budgetClass,
      pinnedProviderId: pinnedProviderId ?? null,
      pinnedModelId: pinnedModelId ?? null,
      configuredAt: new Date(),
      configuredById: userId,
    },
  });

  revalidatePath("/platform/ai");
  revalidatePath("/platform/ai/model-assignment");
  return { ok: true };
}

export async function overrideModelTier(
  providerId: string,
  modelId: string,
  qualityTier: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireManagePlatform();

  if (!isValidTier(qualityTier)) {
    return { ok: false, error: `Invalid tier: ${qualityTier}` };
  }

  const result = await prisma.modelProfile.updateMany({
    where: { providerId, modelId },
    data: {
      qualityTier,
      qualityTierSource: "admin",
    },
  });

  if (result.count === 0) {
    return { ok: false, error: "Model not found" };
  }

  revalidatePath("/platform/ai/providers");
  return { ok: true };
}
