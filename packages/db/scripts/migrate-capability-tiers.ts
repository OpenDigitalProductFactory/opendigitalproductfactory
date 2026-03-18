import { prisma } from "../src/client";

const TIER_MAP: Record<string, string> = {
  "budget": "basic",
  "fast-worker": "routine",
  "specialist": "analytical",
  "deep-thinker": "deep-thinker",
  "embedding": "basic",
  "unknown": "basic",
};

async function migrate() {
  const profiles = await prisma.modelProfile.findMany();
  for (const p of profiles) {
    const newTier = TIER_MAP[p.capabilityTier] ?? "basic";
    if (newTier !== p.capabilityTier) {
      await prisma.modelProfile.update({
        where: { providerId_modelId: { providerId: p.providerId, modelId: p.modelId } },
        data: { capabilityTier: newTier },
      });
      console.log(`${p.providerId}/${p.modelId}: ${p.capabilityTier} → ${newTier}`);
    }
  }
  console.log("Done.");

}

migrate().catch(console.error);
