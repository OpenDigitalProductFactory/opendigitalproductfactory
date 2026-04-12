/**
 * EP-INF-012: Quality tier system for model routing simplification.
 *
 * Tiers replace opaque 0-100 dimension scores as the primary configuration
 * surface. Dimension scores are derived from tier baselines and remain
 * available internally for fine-grained ranking within a tier.
 */

// ── Quality Tier type ──────────────────────────────────────────────────────

export type QualityTier = "frontier" | "strong" | "adequate" | "basic";

export const QUALITY_TIERS: QualityTier[] = ["frontier", "strong", "adequate", "basic"];

export const TIER_LABELS: Record<QualityTier, string> = {
  frontier: "Frontier",
  strong: "Strong",
  adequate: "Adequate",
  basic: "Basic",
};

export const TIER_DESCRIPTIONS: Record<QualityTier, string> = {
  frontier: "Best available. Recommended for Build Studio and complex tasks.",
  strong: "Good for most tasks. Recommended for admin, compliance, finance.",
  adequate: "Basic tasks and conversation. Cheapest cloud option.",
  basic: "Local models only. No cloud cost. Limited capabilities.",
};

// ── Family-to-Tier mapping ─────────────────────────────────────────────────
// Longest prefix match against modelId determines tier.

export const FAMILY_TIERS: Record<string, QualityTier> = {
  // Anthropic
  "claude-opus-4":    "frontier",
  "claude-sonnet-4":  "frontier",
  "claude-haiku-4":   "strong",
  "claude-3-haiku":   "adequate",
  // OpenAI
  "gpt-5":            "frontier",
  "o1":               "frontier",
  "o3":               "frontier",
  "o4":               "frontier",
  "gpt-4o":           "strong",
  "gpt-4o-mini":      "adequate",
  // Google
  "gemini-2.5-pro":   "strong",
  "gemini-2.5-flash": "adequate",
  "gemini-2.0-flash": "adequate",
  "gemma4":           "adequate",
  "gemma":            "basic",
  // Local / open-source
  "llama":            "basic",
  "phi":              "basic",
  "qwen":             "basic",
  "mistral":          "basic",
  "deepseek":         "basic",
  "command-r":        "adequate",
};

/**
 * Assign a quality tier to a model using longest-prefix match.
 * Returns "adequate" for unknown models (conservative default).
 */
export function assignTierFromModelId(modelId: string): QualityTier {
  const normalised = modelId.toLowerCase();
  let bestMatch = "";
  let bestTier: QualityTier = "adequate";

  for (const [prefix, tier] of Object.entries(FAMILY_TIERS)) {
    if (normalised.startsWith(prefix) && prefix.length > bestMatch.length) {
      bestMatch = prefix;
      bestTier = tier;
    }
  }

  return bestTier;
}

// ── Tier → Dimension Baselines ─────────────────────────────────────────────
// These replace manual per-model dimension seeding.

export const TIER_DIMENSION_BASELINES: Record<QualityTier, {
  codegen: number;
  toolFidelity: number;
  reasoning: number;
  instructionFollowing: number;
  structuredOutput: number;
  conversational: number;
  contextRetention: number;
}> = {
  frontier: { codegen: 90, toolFidelity: 90, reasoning: 90, instructionFollowing: 90, structuredOutput: 88, conversational: 90, contextRetention: 88 },
  strong:   { codegen: 75, toolFidelity: 75, reasoning: 75, instructionFollowing: 75, structuredOutput: 72, conversational: 75, contextRetention: 72 },
  adequate: { codegen: 55, toolFidelity: 55, reasoning: 55, instructionFollowing: 55, structuredOutput: 52, conversational: 55, contextRetention: 52 },
  basic:    { codegen: 35, toolFidelity: 35, reasoning: 35, instructionFollowing: 35, structuredOutput: 32, conversational: 35, contextRetention: 32 },
};

// ── Tier → Minimum Dimension Thresholds ────────────────────────────────────
// Used to translate an agent's minimumTier into minimumDimensions for the
// existing RequestContract.minimumDimensions check in cost-ranking.ts.

export const TIER_MINIMUM_DIMENSIONS: Record<QualityTier, Record<string, number>> = {
  frontier: { codegen: 85, toolFidelity: 85, reasoning: 85 },
  strong:   { codegen: 70, toolFidelity: 70, reasoning: 70 },
  adequate: { codegen: 50, toolFidelity: 50, reasoning: 50 },
  basic:    {}, // No minimums — accept anything
};

/**
 * Check if a tier string is a valid QualityTier.
 */
export function isValidTier(tier: string): tier is QualityTier {
  return QUALITY_TIERS.includes(tier as QualityTier);
}
