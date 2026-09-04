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
  // Anthropic. GENERATION-LESS entries are deliberate: a vendor ships a new
  // generation every few weeks, and a table keyed to one generation silently
  // demotes the next one to the unknown-model fallback — which is BELOW
  // "strong", so a brand-new flagship ranked under the previous generation's
  // cheapest model and was excluded by every minimumTier: "strong" floor while
  // that cheap model passed. Observed live: claude-opus-5 and claude-sonnet-5
  // classified "adequate" (measured toolFidelity 90 and 85) while
  // claude-haiku-4-5 classified "strong" (measured 75). Longest-prefix match
  // means a generation-specific entry still wins where one exists.
  "claude-opus":      "frontier",
  "claude-sonnet":    "frontier",
  "claude-haiku":     "strong",
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
  // Google — versioned families, longest prefix wins
  "gemini-3.1-pro":   "strong",   // Gemini 3.1 Pro: next-gen, matches GPT-4o class
  "gemini-3-pro":     "strong",   // Gemini 3 Pro: flagship 3.x gen
  "gemini-2.5-pro":   "strong",
  "gemini-2.5-flash": "adequate",
  "gemini-2.0-flash": "adequate",
  "gemma4":           "adequate",
  "gemma":            "basic",
  // Local / open-source — versioned families first (longest-prefix wins)
  "qwen3":            "strong",   // Qwen3 8B+: F1 0.93–0.97 tool calling, matches Haiku
  "qwen2.5-coder":    "strong",   // Coding-specialised with strong tool use
  "qwen":             "basic",    // Unversioned Qwen fallback
  "llama":            "basic",
  "phi":              "basic",
  "mistral":          "basic",
  "deepseek":         "basic",
  "command-r":        "adequate",
};

/**
 * Normalise a raw model ID to a bare family name for prefix matching.
 * Handles Docker Model Runner and Ollama naming conventions:
 *   "ai/qwen3:8b"             → "qwen3"
 *   "docker.io/ai/gemma4:latest" → "gemma4"
 *   "claude-sonnet-4-5"       → "claude-sonnet-4-5"  (unchanged)
 */
function normaliseFamilyId(modelId: string): string {
  let s = modelId.toLowerCase();
  // Strip namespace prefix — take the last path segment
  if (s.includes("/")) {
    s = s.split("/").pop()!;
  }
  // Strip tag suffix (e.g. ":8b", ":latest")
  const colon = s.indexOf(":");
  if (colon > 0) {
    s = s.substring(0, colon);
  }
  return s;
}

/** The tier assumed for a model no family rule matches. */
export const UNMATCHED_MODEL_TIER: QualityTier = "adequate";

export type TierClassification = {
  tier: QualityTier;
  /** False when no family rule matched and the fallback was assumed. */
  matched: boolean;
  /** The family prefix that decided the tier, or null when unmatched. */
  matchedFamily: string | null;
};

/**
 * Classify a model, reporting whether a family rule actually matched.
 *
 * "Unknown" and "weak" are different claims, and conflating them is what makes
 * the fallback dangerous: an unmatched model is assumed `adequate`, which sits
 * BELOW `strong`, so an unrecognised flagship is excluded by exactly the floors
 * that exist to guarantee capability. Callers that care — seeding, posture,
 * routing diagnostics — should surface `matched: false` rather than presenting
 * the assumed tier as though it were established.
 */
export function classifyTierFromModelId(modelId: string): TierClassification {
  const normalised = normaliseFamilyId(modelId);
  let matchedFamily: string | null = null;
  let bestTier: QualityTier = UNMATCHED_MODEL_TIER;

  for (const [prefix, tier] of Object.entries(FAMILY_TIERS)) {
    if (normalised.startsWith(prefix) && prefix.length > (matchedFamily?.length ?? 0)) {
      matchedFamily = prefix;
      bestTier = tier;
    }
  }

  return { tier: bestTier, matched: matchedFamily !== null, matchedFamily };
}

/**
 * Assign a quality tier to a model using longest-prefix match.
 * Returns "adequate" for unknown models — see classifyTierFromModelId when the
 * caller needs to know whether that tier was matched or merely assumed.
 */
export function assignTierFromModelId(modelId: string): QualityTier {
  return classifyTierFromModelId(modelId).tier;
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
