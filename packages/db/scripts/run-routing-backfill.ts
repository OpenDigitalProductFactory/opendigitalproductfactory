/**
 * One-time script: Run ModelCard backfill + recipe seeding.
 * Usage: cd packages/db && npx tsx scripts/run-routing-backfill.ts
 */
import { prisma } from "../src/client";

async function main() {
  console.log("=== Routing Backfill & Seed ===\n");

  // 1. Check current state
  const providers = await prisma.modelProvider.findMany({
    where: { status: { in: ["active", "degraded"] } },
    select: { providerId: true, name: true, status: true },
  });
  console.log(`Active providers: ${providers.length}`);
  for (const p of providers) {
    console.log(`  - ${p.providerId} (${p.name}) [${p.status}]`);
  }

  const profileCount = await prisma.modelProfile.count({
    where: { modelStatus: { in: ["active", "degraded"] } },
  });
  console.log(`Active model profiles: ${profileCount}`);

  const discoveredCount = await prisma.discoveredModel.count();
  console.log(`Discovered models: ${discoveredCount}`);

  const existingRecipes = await prisma.executionRecipe.count();
  console.log(`Existing recipes: ${existingRecipes}`);

  // 2. Show sample profiles (current state of ModelCard fields)
  const samples = await prisma.modelProfile.findMany({
    where: { modelStatus: "active" },
    take: 3,
    select: {
      providerId: true,
      modelId: true,
      modelClass: true,
      metadataSource: true,
      metadataConfidence: true,
    },
  });
  console.log(`\nSample profiles (before backfill):`);
  for (const s of samples) {
    console.log(`  - ${s.providerId}/${s.modelId} class=${s.modelClass} source=${s.metadataSource} confidence=${s.metadataConfidence}`);
  }

  // 3. Run backfill
  console.log("\n--- Running ModelCard backfill ---");
  const discovered = await prisma.discoveredModel.findMany();
  let backfilled = 0;

  // Dynamic import from apps/web since routing code lives there
  const { extractModelCardWithFallback } = await import("../../apps/web/lib/routing/adapter-registry");

  for (const dm of discovered) {
    const card = extractModelCardWithFallback(dm.providerId, dm.modelId, dm.rawMetadata);
    await prisma.modelProfile.updateMany({
      where: { providerId: dm.providerId, modelId: dm.modelId },
      data: {
        modelFamily: card.modelFamily,
        modelClass: card.modelClass,
        maxInputTokens: card.maxInputTokens,
        inputModalities: card.inputModalities as any,
        outputModalities: card.outputModalities as any,
        capabilities: card.capabilities as any,
        pricing: card.pricing as any,
        supportedParameters: card.supportedParameters as any,
        metadataSource: card.metadataSource,
        metadataConfidence: card.metadataConfidence,
        lastMetadataRefresh: new Date(),
        rawMetadataHash: card.rawMetadataHash,
      },
    });
    backfilled++;
  }
  console.log(`Backfilled ${backfilled} model cards`);

  // 4. Show sample profiles (after backfill)
  const samplesAfter = await prisma.modelProfile.findMany({
    where: { modelStatus: "active" },
    take: 3,
    select: {
      providerId: true,
      modelId: true,
      modelClass: true,
      metadataSource: true,
      metadataConfidence: true,
    },
  });
  console.log(`\nSample profiles (after backfill):`);
  for (const s of samplesAfter) {
    console.log(`  - ${s.providerId}/${s.modelId} class=${s.modelClass} source=${s.metadataSource} confidence=${s.metadataConfidence}`);
  }

  // 5. Seed recipes
  console.log("\n--- Seeding recipes ---");
  const { buildSeedRecipe } = await import("../../apps/web/lib/routing/recipe-seeder");
  const { inferContract } = await import("../../apps/web/lib/routing/request-contract");

  const contractFamilies = [
    "sync.greeting", "sync.status-query", "sync.summarization",
    "sync.reasoning", "sync.data-extraction", "sync.code-gen",
    "sync.web-search", "sync.creative", "sync.tool-action",
  ];

  const activeProfiles = await prisma.modelProfile.findMany({
    where: { modelStatus: { in: ["active", "degraded"] } },
  });

  let seeded = 0;
  for (const profile of activeProfiles) {
    for (const family of contractFamilies) {
      const existing = await prisma.executionRecipe.findFirst({
        where: {
          providerId: profile.providerId,
          modelId: profile.modelId,
          contractFamily: family,
          status: "champion",
        },
      });
      if (existing) continue;

      const taskType = family.split(".")[1] ?? "reasoning";
      const contract = await inferContract(taskType, [{ role: "user", content: "seed" }]);

      const modelCard = {
        capabilities: (profile.capabilities as any) ?? {},
        maxOutputTokens: profile.maxOutputTokens,
        modelClass: (profile as any).modelClass ?? "chat",
      };

      const recipe = buildSeedRecipe(profile.providerId, profile.modelId, family, modelCard, contract);

      await prisma.executionRecipe.create({
        data: {
          providerId: profile.providerId,
          modelId: profile.modelId,
          contractFamily: family,
          version: 1,
          status: "champion",
          origin: "seed",
          providerSettings: recipe.providerSettings,
          toolPolicy: recipe.toolPolicy,
          responsePolicy: recipe.responsePolicy,
        },
      });
      seeded++;
    }
  }
  console.log(`Seeded ${seeded} new recipes`);

  // 6. Final state
  const finalRecipes = await prisma.executionRecipe.count();
  console.log(`\n=== Final State ===`);
  console.log(`Total recipes: ${finalRecipes}`);

  // Show a few recipes
  const sampleRecipes = await prisma.executionRecipe.findMany({
    take: 5,
    select: {
      providerId: true,
      modelId: true,
      contractFamily: true,
      status: true,
      providerSettings: true,
    },
  });
  console.log("Sample recipes:");
  for (const r of sampleRecipes) {
    console.log(`  - ${r.providerId}/${r.modelId} [${r.contractFamily}] ${r.status}: ${JSON.stringify(r.providerSettings)}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  const { prisma: p } = await import("../src/client");
  await p.$disconnect();
  process.exit(1);
});
