import { prisma } from "../src/index.js";

async function main() {
  console.log("=== ModelProfile records for anthropic-sub ===");
  const profiles = await prisma.modelProfile.findMany({
    where: { providerId: "anthropic-sub" },
    select: { modelId: true, modelStatus: true },
  });
  console.log(`Count: ${profiles.length}`);
  for (const p of profiles) console.log(`  ${p.modelId} (${p.modelStatus})`);

  console.log("\n=== DiscoveredModel records for anthropic-sub ===");
  const discovered = await prisma.discoveredModel.findMany({
    where: { providerId: "anthropic-sub" },
    select: { modelId: true },
  });
  console.log(`Count: ${discovered.length}`);
  for (const d of discovered) console.log(`  ${d.modelId}`);

  console.log("\n=== provider_priority config ===");
  const config = await prisma.platformConfig.findUnique({ where: { key: "provider_priority" } });
  console.log(config ? JSON.stringify(config.value, null, 2) : "NONE (uses bootstrap)");

  await prisma.$disconnect();
}

main().catch(console.error);
