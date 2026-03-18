/**
 * Seed capability profiles for all existing ModelProvider endpoints.
 * Based on known benchmark data and model cards.
 * Run: DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx tsx packages/db/scripts/seed-routing-profiles.ts
 */
import { prisma } from "../src/client";

interface ProfileSeed {
  providerId: string;
  supportsToolUse: boolean;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  modelRestrictions: string[];
  reasoning: number;
  codegen: number;
  toolFidelity: number;
  instructionFollowing: number;
  structuredOutput: number;
  conversational: number;
  contextRetention: number;
}

const PROFILES: ProfileSeed[] = [
  {
    providerId: "anthropic",
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 200000,
    maxOutputTokens: 8192,
    modelRestrictions: [],
    reasoning: 92,
    codegen: 90,
    toolFidelity: 88,
    instructionFollowing: 90,
    structuredOutput: 85,
    conversational: 88,
    contextRetention: 85,
  },
  {
    providerId: "anthropic-sub",
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 200000,
    maxOutputTokens: 8192,
    modelRestrictions: ["claude-haiku-3-5-20241022", "claude-3-5-haiku-20241022"],
    reasoning: 65,
    codegen: 60,
    toolFidelity: 62,
    instructionFollowing: 70,
    structuredOutput: 68,
    conversational: 72,
    contextRetention: 60,
  },
  {
    providerId: "openrouter",
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 128000,
    maxOutputTokens: 4096,
    modelRestrictions: [],
    reasoning: 85,
    codegen: 82,
    toolFidelity: 80,
    instructionFollowing: 82,
    structuredOutput: 78,
    conversational: 85,
    contextRetention: 75,
  },
  {
    providerId: "ollama",
    supportsToolUse: true,
    supportsStructuredOutput: false,
    supportsStreaming: true,
    maxContextTokens: 32768,
    maxOutputTokens: 4096,
    modelRestrictions: [],
    reasoning: 55,
    codegen: 50,
    toolFidelity: 40,
    instructionFollowing: 52,
    structuredOutput: 35,
    conversational: 58,
    contextRetention: 45,
  },
];

async function main() {
  for (const profile of PROFILES) {
    const provider = await prisma.modelProvider.findUnique({
      where: { providerId: profile.providerId },
    });
    if (!provider) {
      console.log(`SKIP: ${profile.providerId} not found in database`);
      continue;
    }

    await prisma.modelProvider.update({
      where: { providerId: profile.providerId },
      data: {
        supportsToolUse: profile.supportsToolUse,
        supportsStructuredOutput: profile.supportsStructuredOutput,
        supportsStreaming: profile.supportsStreaming,
        maxContextTokens: profile.maxContextTokens,
        maxOutputTokens: profile.maxOutputTokens,
        modelRestrictions: profile.modelRestrictions,
        reasoning: profile.reasoning,
        codegen: profile.codegen,
        toolFidelity: profile.toolFidelity,
        instructionFollowing: profile.instructionFollowing,
        structuredOutput: profile.structuredOutput,
        conversational: profile.conversational,
        contextRetention: profile.contextRetention,
        profileSource: "seed",
        profileConfidence: "low",
      },
    });
    console.log(`SEEDED: ${profile.providerId}`);
  }

  // Report providers not in the PROFILES list — they keep schema defaults (all 50s)
  const allProviders = await prisma.modelProvider.findMany({
    where: { endpointType: "llm" },
    select: { providerId: true },
  });
  const seededIds = new Set(PROFILES.map((p) => p.providerId));
  for (const p of allProviders) {
    if (!seededIds.has(p.providerId)) {
      console.log(`DEFAULT: ${p.providerId} — using schema defaults (all 50s). Add to PROFILES array for accurate scoring.`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
