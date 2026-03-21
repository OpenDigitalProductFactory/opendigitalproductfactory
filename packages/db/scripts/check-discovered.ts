import { prisma } from "../src/client";

async function main() {
  const discovered = await prisma.discoveredModel.findMany({
    select: { providerId: true, modelId: true },
    orderBy: [{ providerId: "asc" }, { modelId: "asc" }],
  });
  console.log(`Discovered models: ${discovered.length}`);
  for (const d of discovered) {
    console.log(`  ${d.providerId.padEnd(20)} ${d.modelId}`);
  }

  const profiles = await prisma.modelProfile.findMany({
    where: { modelStatus: { in: ["active", "degraded"] } },
    select: {
      providerId: true, modelId: true, modelClass: true,
      metadataSource: true, metadataConfidence: true,
      capabilities: true,
    },
  });
  console.log(`\nActive profiles: ${profiles.length}`);
  for (const p of profiles) {
    const caps = p.capabilities as Record<string, unknown> | null;
    const hasRealCaps = caps && Object.keys(caps).length > 0 && Object.values(caps).some(v => v !== null);
    console.log(`  ${p.providerId.padEnd(20)} ${p.modelId.padEnd(35)} class=${(p.modelClass ?? "?").padEnd(10)} source=${(p.metadataSource ?? "?").padEnd(10)} caps=${hasRealCaps ? "YES" : "empty"}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
