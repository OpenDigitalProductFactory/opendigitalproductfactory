import { prisma } from "../src/client";

async function main() {
  // Keep only the best Ollama chat model active
  const profiles = await prisma.modelProfile.findMany({
    where: { providerId: "ollama", modelClass: "chat", modelStatus: "active" },
    select: { id: true, modelId: true, reasoning: true, conversational: true },
  });

  console.log("Active Ollama chat profiles:", profiles.map((p) => p.modelId));

  if (profiles.length <= 1) {
    console.log("Already single model — nothing to do");
    await prisma.$disconnect();
    return;
  }

  // Pick best by (reasoning + conversational)
  let best = profiles[0]!;
  for (const p of profiles) {
    if (p.reasoning + p.conversational > best.reasoning + best.conversational) {
      best = p;
    }
  }

  for (const p of profiles) {
    if (p.id !== best.id) {
      await prisma.modelProfile.update({
        where: { id: p.id },
        data: { modelStatus: "inactive" },
      });
      console.log(`Deactivated: ${p.modelId}`);
    }
  }

  console.log(`Best model kept active: ${best.modelId}`);
  await prisma.$disconnect();
}

main().catch(console.error);
