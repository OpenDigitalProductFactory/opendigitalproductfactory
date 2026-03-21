import { prisma } from "../src/client";

async function main() {
  const deleted1 = await prisma.modelProfile.deleteMany({
    where: { providerId: "ollama", modelId: { not: "llama3.1:8b" } },
  });
  console.log(`Deleted ${deleted1.count} stale ModelProfile records`);

  const deleted2 = await prisma.discoveredModel.deleteMany({
    where: { providerId: "ollama", modelId: { not: "llama3.1:8b" } },
  });
  console.log(`Deleted ${deleted2.count} stale DiscoveredModel records`);

  const remaining = await prisma.modelProfile.findMany({
    where: { providerId: "ollama" },
    select: { modelId: true, modelStatus: true },
  });
  console.log("\nRemaining Ollama profiles:");
  for (const r of remaining) console.log(`  ${r.modelId} (${r.modelStatus})`);

  await prisma.$disconnect();
}

main().catch(console.error);
