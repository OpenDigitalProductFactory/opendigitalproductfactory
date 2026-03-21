import { prisma } from "../src/client";

async function main() {
  // Simulate what the routing pipeline sees
  const profiles = await prisma.modelProfile.findMany({
    where: {
      modelStatus: { in: ["active", "degraded"] },
      retiredAt: null,
      provider: { status: { in: ["active", "degraded"] }, endpointType: "llm" },
    },
    include: { provider: true },
  });

  console.log(`Endpoint manifests found: ${profiles.length}`);

  for (const mp of profiles) {
    console.log(`\n--- ${mp.providerId}/${mp.modelId} ---`);
    console.log(`  provider status: ${mp.provider.status}`);
    console.log(`  model status: ${mp.modelStatus}`);
    console.log(`  sensitivity clearance: ${JSON.stringify(mp.provider.sensitivityClearance)}`);
    console.log(`  capabilities: ${JSON.stringify(mp.capabilities)}`);
    console.log(`  modelClass: ${mp.modelClass}`);
    console.log(`  supportsToolUse (provider): ${mp.provider.supportsToolUse}`);
    console.log(`  supportsStreaming (provider): ${mp.provider.supportsStreaming}`);
    console.log(`  maxContextTokens: ${mp.maxContextTokens ?? mp.provider.maxContextTokens}`);

    // Check what getExclusionReasonV2 would check:
    const caps = mp.capabilities as any ?? {};
    console.log(`  caps.toolUse: ${caps.toolUse}`);
    console.log(`  caps.structuredOutput: ${caps.structuredOutput}`);
    console.log(`  caps.streaming: ${caps.streaming}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
