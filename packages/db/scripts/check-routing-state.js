const { PrismaClient } = require("../generated/client");
const p = new PrismaClient();

async function main() {
  const providers = await p.modelProvider.findMany({
    where: { status: { in: ["active", "degraded"] } },
    select: { providerId: true, name: true, status: true },
  });
  console.log("ACTIVE PROVIDERS:", JSON.stringify(providers, null, 2));

  const profileCount = await p.modelProfile.count({
    where: { modelStatus: { in: ["active", "degraded"] } },
  });
  console.log("ACTIVE PROFILES:", profileCount);

  const discoveredCount = await p.discoveredModel.count();
  console.log("DISCOVERED MODELS:", discoveredCount);

  const recipeCount = await p.executionRecipe.count();
  console.log("EXISTING RECIPES:", recipeCount);

  const samples = await p.modelProfile.findMany({
    where: { modelStatus: "active" },
    take: 5,
    select: {
      providerId: true,
      modelId: true,
      modelClass: true,
      metadataSource: true,
      metadataConfidence: true,
      capabilities: true,
    },
  });
  console.log("SAMPLE PROFILES:", JSON.stringify(samples, null, 2));

  await p.$disconnect();
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
