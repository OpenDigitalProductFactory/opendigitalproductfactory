import { prisma } from "../src/client";

async function seed() {
  const providers = await prisma.modelProvider.findMany();
  for (const p of providers) {
    const isLocal = p.category === "local" || p.providerId === "ollama";
    await prisma.modelProvider.update({
      where: { providerId: p.providerId },
      data: {
        endpointType: "llm",
        sensitivityClearance: isLocal
          ? ["public", "internal", "confidential", "restricted"]
          : ["public", "internal"],
        capabilityTier: p.providerId === "ollama" ? "analytical" : "deep-thinker",
        costBand: isLocal ? "free" : "medium",
        taskTags: ["reasoning", "summarization", "code-gen"],
      },
    });
    console.log(`${p.providerId}: seeded endpoint manifest`);
  }
  console.log("Done.");

}

seed().catch(console.error);
