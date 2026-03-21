import { prisma } from "../src/index.js";

async function main() {
  // OAuth subscription only supports Haiku — delete non-Haiku models from anthropic-sub
  const deleted1 = await prisma.discoveredModel.deleteMany({
    where: {
      providerId: "anthropic-sub",
      NOT: { modelId: { contains: "haiku" } },
    },
  });
  console.log(`Deleted ${deleted1.count} non-Haiku DiscoveredModel records`);

  const deleted2 = await prisma.modelProfile.deleteMany({
    where: {
      providerId: "anthropic-sub",
      NOT: { modelId: { contains: "haiku" } },
    },
  });
  console.log(`Deleted ${deleted2.count} non-Haiku ModelProfile records`);

  // Also set Haiku models to active status
  const updated = await prisma.modelProfile.updateMany({
    where: { providerId: "anthropic-sub", modelId: { contains: "haiku" } },
    data: { modelStatus: "active" },
  });
  console.log(`Set ${updated.count} Haiku ModelProfile records to active`);

  const remaining = await prisma.discoveredModel.findMany({
    where: { providerId: "anthropic-sub" },
    select: { modelId: true },
  });
  console.log(`\nRemaining: ${remaining.map((m) => m.modelId).join(", ")}`);

  await prisma.$disconnect();
}

main().catch(console.error);
