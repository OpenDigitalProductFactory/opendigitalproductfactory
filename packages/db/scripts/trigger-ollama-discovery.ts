import { prisma } from "../src/client";

async function main() {
  const baseUrl = "http://localhost:11434";

  let data: { models: Array<{ name: string; details: { family: string; parameter_size: string } }> };
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    data = await res.json() as typeof data;
  } catch {
    console.log("Ollama not reachable at " + baseUrl);
    return;
  }

  console.log(`Found ${data.models.length} models in Ollama`);

  for (const model of data.models) {
    if (model.name.includes("embed")) {
      console.log(`  Skipping ${model.name} (embedding model)`);
      continue;
    }

    await prisma.discoveredModel.upsert({
      where: { providerId_modelId: { providerId: "ollama", modelId: model.name } },
      update: {},
      create: { providerId: "ollama", modelId: model.name, rawMetadata: model as any },
    });

    await prisma.modelProfile.upsert({
      where: { providerId_modelId: { providerId: "ollama", modelId: model.name } },
      update: { modelStatus: "active", retiredAt: null },
      create: {
        providerId: "ollama",
        modelId: model.name,
        friendlyName: model.name,
        summary: `Local ${model.details.family} model (${model.details.parameter_size})`,
        capabilityTier: "basic",
        costTier: "free",
        bestFor: ["conversation", "simple summaries", "guided tasks"],
        avoidFor: ["complex reasoning", "code generation", "document analysis"],
        generatedBy: "setup-bootstrap",
        modelStatus: "active",
        profileSource: "seed",
        profileConfidence: "low",
        reasoning: 50,
        codegen: 40,
        toolFidelity: 30,
        instructionFollowingScore: 50,
        structuredOutputScore: 30,
        conversational: 60,
        contextRetention: 50,
        modelClass: "chat",
      },
    });

    console.log(`  ${model.name} — profile created/updated`);
  }

  const profiles = await prisma.modelProfile.findMany({
    where: { providerId: "ollama", modelStatus: "active", retiredAt: null },
    select: { modelId: true },
  });
  console.log(`\nActive Ollama profiles: ${profiles.length}`);
  for (const p of profiles) console.log(`  ${p.modelId}`);

  await prisma.$disconnect();
}

main().catch(console.error);
