import { prisma } from "../src/client";

async function main() {
  const ollama = await prisma.modelProvider.findUnique({
    where: { providerId: "ollama" },
    select: { status: true, sensitivityClearance: true, enabledFamilies: true },
  });
  console.log("=== Ollama Provider ===");
  console.log(JSON.stringify(ollama, null, 2));

  const profiles = await prisma.modelProfile.findMany({
    where: { providerId: "ollama" },
    select: { modelId: true, modelStatus: true, retiredAt: true },
  });
  console.log(`\nModel profiles: ${profiles.length}`);
  for (const p of profiles) console.log(`  ${p.modelId} (${p.modelStatus})`);

  const discovered = await prisma.discoveredModel.findMany({
    where: { providerId: "ollama" },
    select: { modelId: true },
  });
  console.log(`\nDiscovered models: ${discovered.length}`);
  for (const d of discovered) console.log(`  ${d.modelId}`);

  // Check what the routing pipeline would see
  const manifests = await prisma.modelProfile.findMany({
    where: {
      modelStatus: { in: ["active", "degraded"] },
      retiredAt: null,
      provider: { status: { in: ["active", "degraded"] }, endpointType: "llm" },
    },
    select: { providerId: true, modelId: true, modelStatus: true },
  });
  console.log(`\nAll active endpoint manifests (what routing sees): ${manifests.length}`);
  for (const m of manifests) console.log(`  ${m.providerId}/${m.modelId} (${m.modelStatus})`);

  await prisma.$disconnect();
}

main().catch(console.error);
