import { prisma } from "@dpf/db";

import type { KnownModel } from "@/lib/routing/known-provider-models";
import { TIER_DIMENSION_BASELINES } from "@/lib/routing/quality-tiers";

/**
 * Seed DiscoveredModel + ModelProfile from the known-model catalog.
 * Used for providers that can't call /v1/models (subscription OAuth, agent providers).
 */
export async function seedKnownModels(
  providerId: string,
  models: KnownModel[],
): Promise<{ discovered: number; profiled: number }> {
  let discovered = 0;
  let profiled = 0;

  for (const m of models) {
    await prisma.discoveredModel.upsert({
      where: { providerId_modelId: { providerId, modelId: m.modelId } },
      create: {
        providerId,
        modelId: m.modelId,
        rawMetadata: { id: m.modelId, source: "known_catalog" } as any,
        lastSeenAt: new Date(),
      },
      update: {
        rawMetadata: { id: m.modelId, source: "known_catalog" } as any,
        lastSeenAt: new Date(),
      },
    });
    discovered++;

    const existing = await prisma.modelProfile.findUnique({
      where: { providerId_modelId: { providerId, modelId: m.modelId } },
      select: { qualityTierSource: true, profileSource: true, supportsToolUse: true },
    });

    const shouldWriteScores = !existing?.profileSource || existing.profileSource === "seed";
    const isManuallySetCatalog = existing?.profileSource === "evaluated" || existing?.profileSource === "admin";
    const shouldWriteTier = !existing?.qualityTierSource || existing.qualityTierSource !== "admin";

    const scores = m.scores ?? {
      reasoning: TIER_DIMENSION_BASELINES[m.qualityTier].reasoning,
      codegen: TIER_DIMENSION_BASELINES[m.qualityTier].codegen,
      toolFidelity: TIER_DIMENSION_BASELINES[m.qualityTier].toolFidelity,
      instructionFollowingScore: TIER_DIMENSION_BASELINES[m.qualityTier].instructionFollowing,
      structuredOutputScore: TIER_DIMENSION_BASELINES[m.qualityTier].structuredOutput,
      conversational: TIER_DIMENSION_BASELINES[m.qualityTier].conversational,
      contextRetention: TIER_DIMENSION_BASELINES[m.qualityTier].contextRetention,
    };

    const scoreFields = shouldWriteScores ? {
      ...scores,
      profileSource: "seed" as const,
      profileConfidence: "medium" as const,
    } : {};

    const tierFields = shouldWriteTier ? {
      qualityTier: m.qualityTier,
      qualityTierSource: "auto" as const,
    } : {};

    await prisma.modelProfile.upsert({
      where: { providerId_modelId: { providerId, modelId: m.modelId } },
      create: {
        providerId,
        modelId: m.modelId,
        friendlyName: m.friendlyName,
        summary: m.summary,
        capabilityCategory: m.capabilityCategory,
        costTier: m.costTier,
        bestFor: m.bestFor,
        avoidFor: m.avoidFor,
        modelClass: m.modelClass,
        modelFamily: m.modelFamily,
        modelStatus: m.defaultStatus,
        retiredAt: m.defaultStatus === "retired" ? new Date() : null,
        retiredReason: m.defaultStatus === "retired" || m.defaultStatus === "disabled"
          ? (m.retiredReason ?? null)
          : null,
        maxContextTokens: m.maxContextTokens,
        maxOutputTokens: m.maxOutputTokens,
        inputModalities: m.inputModalities,
        outputModalities: m.outputModalities,
        capabilities: m.capabilities as any,
        supportsToolUse: m.capabilities.toolUse ?? false,
        qualityTier: m.qualityTier,
        qualityTierSource: "auto",
        ...scores,
        profileSource: "seed",
        profileConfidence: "medium",
        generatedBy: "system:auto-discover",
      },
      update: {
        friendlyName: m.friendlyName,
        summary: m.summary,
        modelClass: m.modelClass,
        modelFamily: m.modelFamily,
        modelStatus: m.defaultStatus,
        retiredAt: m.defaultStatus === "retired" ? new Date() : null,
        retiredReason: m.defaultStatus === "retired" || m.defaultStatus === "disabled"
          ? (m.retiredReason ?? null)
          : null,
        maxContextTokens: m.maxContextTokens,
        maxOutputTokens: m.maxOutputTokens,
        inputModalities: m.inputModalities,
        outputModalities: m.outputModalities,
        capabilities: m.capabilities as any,
        supportsToolUse: isManuallySetCatalog
          ? (existing.supportsToolUse ?? m.capabilities.toolUse ?? false)
          : (m.capabilities.toolUse ?? false),
        ...scoreFields,
        ...tierFields,
        generatedBy: "system:auto-discover",
      },
    });
    profiled++;
  }

  console.log(`[auto-discover] Seeded ${discovered} known models for ${JSON.stringify(providerId)}`);
  return { discovered, profiled };
}
