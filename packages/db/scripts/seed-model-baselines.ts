/**
 * EP-INF-002: Seed existing ModelProfile rows with family baseline scores
 * and extract metadata from DiscoveredModel.rawMetadata.
 * Run: DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx tsx packages/db/scripts/seed-model-baselines.ts
 */
import { prisma } from "../src/client";

// Inline the baseline logic (or import from apps/web if module resolution works)
// For simplicity, duplicate the core pattern matching here.

interface BaselineScores {
  reasoning: number; codegen: number; toolFidelity: number;
  instructionFollowing: number; structuredOutput: number;
  conversational: number; contextRetention: number;
}

const PATTERNS: Array<{ pattern: RegExp; scores: BaselineScores; confidence: string }> = [
  { pattern: /claude.*opus/i, scores: { reasoning: 95, codegen: 92, toolFidelity: 90, instructionFollowing: 92, structuredOutput: 88, conversational: 90, contextRetention: 88 }, confidence: "medium" },
  { pattern: /claude.*sonnet/i, scores: { reasoning: 88, codegen: 91, toolFidelity: 85, instructionFollowing: 88, structuredOutput: 82, conversational: 85, contextRetention: 80 }, confidence: "medium" },
  { pattern: /claude.*haiku/i, scores: { reasoning: 65, codegen: 60, toolFidelity: 62, instructionFollowing: 70, structuredOutput: 68, conversational: 72, contextRetention: 60 }, confidence: "medium" },
  { pattern: /gpt-4o-mini/i, scores: { reasoning: 68, codegen: 62, toolFidelity: 65, instructionFollowing: 68, structuredOutput: 65, conversational: 70, contextRetention: 58 }, confidence: "medium" },
  { pattern: /gpt-4o/i, scores: { reasoning: 88, codegen: 85, toolFidelity: 88, instructionFollowing: 85, structuredOutput: 82, conversational: 85, contextRetention: 78 }, confidence: "medium" },
  { pattern: /llama.*3\.1.*70b/i, scores: { reasoning: 72, codegen: 68, toolFidelity: 50, instructionFollowing: 65, structuredOutput: 48, conversational: 70, contextRetention: 55 }, confidence: "low" },
  { pattern: /llama.*3\.1.*8b/i, scores: { reasoning: 55, codegen: 50, toolFidelity: 40, instructionFollowing: 52, structuredOutput: 35, conversational: 58, contextRetention: 45 }, confidence: "low" },
];

function findBaseline(modelId: string): { scores: BaselineScores; confidence: string } | null {
  for (const p of PATTERNS) {
    if (p.pattern.test(modelId)) return p;
  }
  return null;
}

async function main() {
  const profiles = await prisma.modelProfile.findMany();
  let seeded = 0;
  let defaulted = 0;

  for (const profile of profiles) {
    const baseline = findBaseline(profile.modelId);
    const scores = baseline?.scores ?? {
      reasoning: 50, codegen: 50, toolFidelity: 50,
      instructionFollowing: 50, structuredOutput: 50,
      conversational: 50, contextRetention: 50,
    };
    const confidence = baseline?.confidence ?? "low";

    await prisma.modelProfile.update({
      where: { id: profile.id },
      data: {
        reasoning: scores.reasoning,
        codegen: scores.codegen,
        toolFidelity: scores.toolFidelity,
        instructionFollowingScore: scores.instructionFollowing,
        structuredOutputScore: scores.structuredOutput,
        conversational: scores.conversational,
        contextRetention: scores.contextRetention,
        profileSource: "seed",
        profileConfidence: confidence,
        modelStatus: "active",
      },
    });

    if (baseline) {
      console.log(`BASELINED: ${profile.providerId}/${profile.modelId} (${confidence})`);
      seeded++;
    } else {
      console.log(`DEFAULTED: ${profile.providerId}/${profile.modelId} (all 50s)`);
      defaulted++;
    }
  }

  console.log(`\nDone: ${seeded} baselined, ${defaulted} defaulted, ${profiles.length} total`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
