// Catalog maintenance sweeps that read the discovered catalog and rewrite
// ModelProfile rows: ModelCard backfill (EP-INF-003) and execution-recipe
// seeding (EP-INF-007). Extracted from ai-provider-internals (BI-7F2FBDA3) so
// the discovery module keeps shrinking under its module-size baseline.

import { prisma } from "@dpf/db";

import { extractModelCardWithFallback } from "@/lib/routing/adapter-registry";

/**
 * EP-INF-003: Backfill ModelCard fields for all existing ModelProfiles.
 * Reads all DiscoveredModel records and re-extracts ModelCard data using
 * the adapter registry, then writes the card fields to the corresponding
 * ModelProfile rows. Safe to run repeatedly — uses updateMany.
 */
export async function backfillModelCards(): Promise<number> {
  const discovered = await prisma.discoveredModel.findMany();
  let updated = 0;
  for (const dm of discovered) {
    const card = extractModelCardWithFallback(dm.providerId, dm.modelId, dm.rawMetadata as Record<string, unknown>);
    await prisma.modelProfile.updateMany({
      where: { providerId: dm.providerId, modelId: dm.modelId },
      data: {
        modelFamily: card.modelFamily,
        modelClass: card.modelClass,
        maxInputTokens: card.maxInputTokens,
        inputModalities: card.inputModalities as any,
        outputModalities: card.outputModalities as any,
        capabilities: (dm.providerId === "local" || dm.providerId === "ollama")
          ? { ...card.capabilities, streaming: true } as any
          : card.capabilities as any,
        pricing: card.pricing as any,
        supportedParameters: card.supportedParameters as any,
        metadataSource: card.metadataSource,
        metadataConfidence: card.metadataConfidence,
        lastMetadataRefresh: new Date(),
        rawMetadataHash: card.rawMetadataHash,
      },
    });
    updated++;
  }
  return updated;
}


/**
 * EP-INF-007: Seed execution recipes for all active/degraded model profiles.
 * Creates champion seed recipes for each contract family, skipping any that
 * already exist. Safe to run repeatedly — idempotent.
 */
export async function seedAllRecipes(): Promise<number> {
  const { buildSeedRecipe } = await import("../routing/recipe-seeder");
  const { inferContract } = await import("../routing/request-contract");

  const profiles = await prisma.modelProfile.findMany({
    where: { modelStatus: { in: ["active", "degraded"] } },
    include: { provider: true },
  });

  // Chat/reasoning contract families (for chat/reasoning/code model classes)
  const chatContractFamilies = [
    "sync.greeting", "sync.status-query", "sync.summarization",
    "sync.reasoning", "sync.data-extraction", "sync.code-gen",
    "sync.web-search", "sync.creative", "sync.tool-action",
  ];

  // EP-INF-009c: Non-chat contract families keyed by modelClass
  const nonChatContractFamilies: Record<string, string[]> = {
    image_gen: ["sync.image-gen"],
    embedding: ["sync.embedding"],
    audio: ["sync.transcription"],
  };

  let seeded = 0;
  for (const profile of profiles) {
    // Select contract families based on model class
    const modelClass = (profile.modelClass as string) ?? "chat";
    const contractFamilies = nonChatContractFamilies[modelClass] ?? chatContractFamilies;

    for (const family of contractFamilies) {
      // Check if recipe already exists
      const existing = await prisma.executionRecipe.findFirst({
        where: {
          providerId: profile.providerId,
          modelId: profile.modelId,
          contractFamily: family,
          status: "champion",
        },
      });
      if (existing) continue;

      // Create a minimal contract for seeding
      const taskType = family.split(".")[1] ?? "reasoning";
      const contract = await inferContract(
        taskType,
        [{ role: "user", content: "seed" }],
      );

      const modelCard = {
        capabilities: (profile.capabilities as unknown as import("../routing/model-card-types").ModelCardCapabilities) ?? {},
        maxOutputTokens: profile.maxOutputTokens,
        modelClass: (profile.modelClass as string) ?? "chat",
      };

      const recipe = buildSeedRecipe(
        profile.providerId,
        profile.modelId,
        family,
        modelCard,
        contract,
      );

      await prisma.executionRecipe.create({
        data: {
          providerId: profile.providerId,
          modelId: profile.modelId,
          contractFamily: family,
          version: 1,
          status: "champion",
          origin: "seed",
          executionAdapter: recipe.executionAdapter,
          providerSettings: recipe.providerSettings as object,
          toolPolicy: recipe.toolPolicy as object,
          responsePolicy: recipe.responsePolicy as object,
        },
      });
      seeded++;
    }
  }
  return seeded;
}
