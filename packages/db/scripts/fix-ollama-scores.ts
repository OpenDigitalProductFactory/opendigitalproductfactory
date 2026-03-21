import { prisma } from "../src/client";

/**
 * Reset llama3.1:8b scores to realistic values.
 * The eval golden tests are too simple and inflated everything.
 */
async function main() {
  await prisma.modelProfile.update({
    where: { providerId_modelId: { providerId: "ollama", modelId: "llama3.1:8b" } },
    data: {
      reasoning: 45,           // Decent for simple reasoning, struggles with multi-step
      codegen: 35,             // Can do simple code, unreliable for complex tasks
      toolFidelity: 15,        // Technically supports tool API but hallucinates calls
      instructionFollowingScore: 40,  // Follows basic instructions, misses nuance
      structuredOutputScore: 20,      // Can do simple JSON, unreliable formatting
      conversational: 65,      // This is its strength — natural conversation
      contextRetention: 45,    // OK within its 128k window but loses detail
      profileSource: "seed",   // Mark as seed — eval results were unreliable
      profileConfidence: "low",
      evalCount: 0,            // Reset eval count since results were bad
      lastEvalAt: null,
    },
  });

  console.log("Reset llama3.1:8b to realistic scores:");
  console.log("  Reasoning: 45 (decent for simple, struggles multi-step)");
  console.log("  Code Gen: 35 (simple code only)");
  console.log("  Tool Fidelity: 15 (technically supports but hallucinates)");
  console.log("  Instruction Following: 40 (basic instructions OK)");
  console.log("  Structured Output: 20 (simple JSON, unreliable)");
  console.log("  Conversational: 65 (its strength)");
  console.log("  Context Retention: 45 (OK within window)");

  await prisma.$disconnect();
}

main().catch(console.error);
