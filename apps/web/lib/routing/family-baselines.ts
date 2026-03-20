/**
 * EP-INF-002: Model family baseline registry.
 * Maps model name patterns to known baseline capability scores.
 * Used to seed profiles when a model is first discovered.
 */

export interface FamilyBaseline {
  scores: {
    reasoning: number;
    codegen: number;
    toolFidelity: number;
    instructionFollowing: number;
    structuredOutput: number;
    conversational: number;
    contextRetention: number;
  };
  confidence: "low" | "medium";
}

interface FamilyEntry {
  pattern: RegExp;
  baseline: FamilyBaseline;
}

// Order matters — first match wins. More specific patterns before general ones.
const FAMILY_REGISTRY: FamilyEntry[] = [
  // ── Anthropic ──
  { pattern: /claude.*opus/i, baseline: { scores: { reasoning: 95, codegen: 92, toolFidelity: 90, instructionFollowing: 92, structuredOutput: 88, conversational: 90, contextRetention: 88 }, confidence: "medium" } },
  { pattern: /claude.*sonnet/i, baseline: { scores: { reasoning: 88, codegen: 91, toolFidelity: 85, instructionFollowing: 88, structuredOutput: 82, conversational: 85, contextRetention: 80 }, confidence: "medium" } },
  { pattern: /claude.*haiku/i, baseline: { scores: { reasoning: 65, codegen: 60, toolFidelity: 62, instructionFollowing: 70, structuredOutput: 68, conversational: 72, contextRetention: 60 }, confidence: "medium" } },

  // ── OpenAI — specific before general ──
  { pattern: /gpt-4o-mini/i, baseline: { scores: { reasoning: 68, codegen: 62, toolFidelity: 65, instructionFollowing: 68, structuredOutput: 65, conversational: 70, contextRetention: 58 }, confidence: "medium" } },
  { pattern: /gpt-4o/i, baseline: { scores: { reasoning: 88, codegen: 85, toolFidelity: 88, instructionFollowing: 85, structuredOutput: 82, conversational: 85, contextRetention: 78 }, confidence: "medium" } },
  { pattern: /gpt-4-turbo/i, baseline: { scores: { reasoning: 82, codegen: 80, toolFidelity: 82, instructionFollowing: 80, structuredOutput: 78, conversational: 80, contextRetention: 72 }, confidence: "medium" } },
  { pattern: /(?:^|\/)o[134]-/i, baseline: { scores: { reasoning: 95, codegen: 88, toolFidelity: 75, instructionFollowing: 82, structuredOutput: 75, conversational: 70, contextRetention: 80 }, confidence: "medium" } },

  // ── Meta Llama ──
  { pattern: /llama.*3\.1.*405b/i, baseline: { scores: { reasoning: 80, codegen: 75, toolFidelity: 60, instructionFollowing: 72, structuredOutput: 55, conversational: 75, contextRetention: 65 }, confidence: "low" } },
  { pattern: /llama.*3\.1.*70b/i, baseline: { scores: { reasoning: 72, codegen: 68, toolFidelity: 50, instructionFollowing: 65, structuredOutput: 48, conversational: 70, contextRetention: 55 }, confidence: "low" } },
  { pattern: /llama.*3\.1.*8b/i, baseline: { scores: { reasoning: 55, codegen: 50, toolFidelity: 40, instructionFollowing: 52, structuredOutput: 35, conversational: 58, contextRetention: 45 }, confidence: "low" } },

  // ── Google ──
  { pattern: /gemini.*2\.0.*flash/i, baseline: { scores: { reasoning: 75, codegen: 72, toolFidelity: 70, instructionFollowing: 75, structuredOutput: 70, conversational: 72, contextRetention: 68 }, confidence: "low" } },
  { pattern: /gemini.*1\.5.*pro/i, baseline: { scores: { reasoning: 82, codegen: 78, toolFidelity: 75, instructionFollowing: 80, structuredOutput: 75, conversational: 78, contextRetention: 85 }, confidence: "low" } },

  // ── Mistral ──
  { pattern: /mistral.*large/i, baseline: { scores: { reasoning: 78, codegen: 72, toolFidelity: 68, instructionFollowing: 75, structuredOutput: 65, conversational: 72, contextRetention: 65 }, confidence: "low" } },
  { pattern: /mixtral/i, baseline: { scores: { reasoning: 65, codegen: 60, toolFidelity: 50, instructionFollowing: 62, structuredOutput: 48, conversational: 65, contextRetention: 55 }, confidence: "low" } },

  // ── DeepSeek ──
  { pattern: /deepseek.*coder/i, baseline: { scores: { reasoning: 60, codegen: 88, toolFidelity: 55, instructionFollowing: 65, structuredOutput: 55, conversational: 55, contextRetention: 58 }, confidence: "low" } },
  { pattern: /deepseek.*v3/i, baseline: { scores: { reasoning: 82, codegen: 85, toolFidelity: 65, instructionFollowing: 72, structuredOutput: 60, conversational: 68, contextRetention: 70 }, confidence: "low" } },

  // ── Qwen ──
  { pattern: /qwen.*2\.5.*72b/i, baseline: { scores: { reasoning: 78, codegen: 75, toolFidelity: 55, instructionFollowing: 70, structuredOutput: 55, conversational: 68, contextRetention: 62 }, confidence: "low" } },
  { pattern: /qwen.*2\.5.*7b/i, baseline: { scores: { reasoning: 55, codegen: 52, toolFidelity: 38, instructionFollowing: 50, structuredOutput: 38, conversational: 55, contextRetention: 42 }, confidence: "low" } },

  // ── Cohere ──
  { pattern: /command-r-plus/i, baseline: { scores: { reasoning: 78, codegen: 70, toolFidelity: 72, instructionFollowing: 75, structuredOutput: 68, conversational: 75, contextRetention: 70 }, confidence: "low" } },
  { pattern: /command-r(?!-plus)/i, baseline: { scores: { reasoning: 65, codegen: 58, toolFidelity: 58, instructionFollowing: 62, structuredOutput: 55, conversational: 65, contextRetention: 58 }, confidence: "low" } },
];

/**
 * Find the baseline capability scores for a model based on its name.
 * Returns null if no family pattern matches — caller should use defaults (all 50s).
 */
export function getBaselineForModel(modelId: string): FamilyBaseline | null {
  for (const entry of FAMILY_REGISTRY) {
    if (entry.pattern.test(modelId)) {
      return entry.baseline;
    }
  }
  return null;
}
