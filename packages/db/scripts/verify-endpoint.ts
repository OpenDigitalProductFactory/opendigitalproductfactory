import { prisma } from "../src/client";

async function main() {
  const p = await prisma.modelProfile.findUnique({
    where: { providerId_modelId: { providerId: "ollama", modelId: "llama3.1:8b" } },
    select: { capabilities: true, modelStatus: true, retiredAt: true },
  });
  console.log("ModelProfile:", JSON.stringify(p, null, 2));

  // Simulate exactly what loadEndpointManifests does
  const manifests = await prisma.modelProfile.findMany({
    where: {
      modelStatus: { in: ["active", "degraded"] },
      retiredAt: null,
      provider: { status: { in: ["active", "degraded"] }, endpointType: "llm" },
    },
    include: { provider: true },
  });
  console.log(`\nManifests loaded: ${manifests.length}`);
  for (const m of manifests) {
    const caps = m.capabilities as any;
    console.log(`  ${m.providerId}/${m.modelId}: streaming=${caps?.streaming}, toolUse=${caps?.toolUse}, clearance=${JSON.stringify(m.provider.sensitivityClearance)}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
