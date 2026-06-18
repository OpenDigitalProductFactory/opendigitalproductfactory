/**
 * BI-6F42465E (EP-F7E35344 — AI Coworker Capability Inputs).
 *
 * Day-1 seed pricing for model profiles. On a fresh install a model profile
 * whose `pricing.inputPerMToken`/`outputPerMToken` are null gets a `null` cost
 * from `estimateCost` (apps/web/lib/routing/cost-ranking.ts) and is then
 * penalized in cost-per-success ranking (rankScore = successProb * 50). When
 * EVERY paid model is null-priced they all tie at that half-score and routing
 * collapses onto whatever the crude provider-tier sort surfaces first — the
 * reason the Stage-5b `user_configured > bundled` override exists at all.
 *
 * `seedModelPricing()` backfills null prices by substring-matching the modelId
 * against these brackets. Extracted from seed.ts into this pure, dependency-free
 * module so the resolution logic is unit-testable without a database.
 *
 * Prices are public list rates per 1M tokens, verified 2026-06-18 with the
 * source on each bracket. Substring matching means new model versions inherit
 * the right bracket automatically; admin-tuned values are always preserved
 * (the seeder only fills nulls).
 */

export interface SeedPrice {
  inputPerMToken: number;
  outputPerMToken: number;
}

export interface PriceBracket extends SeedPrice {
  match: (providerId: string, modelId: string) => boolean;
  /** Source for the published rate (audit trail; not consumed at runtime). */
  source: string;
}

// Order matters: more specific matchers (mini/small/8b/build/pro) must precede
// the provider's general flagship bracket. `resolveSeedPrice` returns the first
// match.
export const PRICE_BRACKETS: PriceBracket[] = [
  // ── Anthropic Claude family (subscription + direct) ──────────────────────
  { match: (p, m) => (p === "anthropic-sub" || p === "anthropic") && m.includes("haiku"), inputPerMToken: 1, outputPerMToken: 5, source: "anthropic.com/pricing" },
  { match: (p, m) => (p === "anthropic-sub" || p === "anthropic") && m.includes("sonnet"), inputPerMToken: 3, outputPerMToken: 15, source: "anthropic.com/pricing" },
  { match: (p, m) => (p === "anthropic-sub" || p === "anthropic") && m.includes("opus"), inputPerMToken: 15, outputPerMToken: 75, source: "anthropic.com/pricing" },

  // ── OpenAI (codex CLI / ChatGPT subscription + direct) ───────────────────
  { match: (p, m) => (p === "codex" || p === "chatgpt") && m.includes("codex"), inputPerMToken: 5, outputPerMToken: 20, source: "openai.com/api/pricing" },
  { match: (p, m) => (p === "codex" || p === "chatgpt" || p === "openai") && m.startsWith("gpt-5"), inputPerMToken: 10, outputPerMToken: 40, source: "openai.com/api/pricing" },
  { match: (p, m) => (p === "codex" || p === "chatgpt" || p === "openai") && m.startsWith("gpt-4"), inputPerMToken: 5, outputPerMToken: 15, source: "openai.com/api/pricing" },

  // ── DeepSeek (deepseek-chat/reasoner are aliases of v4-flash) ────────────
  { match: (p, m) => p === "deepseek" && m.includes("pro"), inputPerMToken: 0.435, outputPerMToken: 0.87, source: "api-docs.deepseek.com/quick_start/pricing" },
  { match: (p) => p === "deepseek", inputPerMToken: 0.14, outputPerMToken: 0.28, source: "api-docs.deepseek.com/quick_start/pricing" },

  // ── Groq (hosted Llama) ──────────────────────────────────────────────────
  { match: (p, m) => p === "groq" && m.includes("8b"), inputPerMToken: 0.05, outputPerMToken: 0.08, source: "groq.com/pricing" },
  { match: (p) => p === "groq", inputPerMToken: 0.59, outputPerMToken: 0.79, source: "groq.com/pricing" },

  // ── Mistral (large-3 / small-4; -latest aliases resolve to these) ────────
  { match: (p, m) => p === "mistral" && m.includes("small"), inputPerMToken: 0.1, outputPerMToken: 0.3, source: "mistral.ai/pricing" },
  { match: (p) => p === "mistral", inputPerMToken: 0.5, outputPerMToken: 1.5, source: "mistral.ai/pricing" },

  // ── xAI Grok (grok-3 line retired → redirects bill at grok-4.3) ──────────
  { match: (p, m) => p === "xai" && m.includes("build"), inputPerMToken: 1, outputPerMToken: 2, source: "docs.x.ai/docs/models" },
  { match: (p) => p === "xai", inputPerMToken: 1.25, outputPerMToken: 2.5, source: "docs.x.ai/docs/models" },

  // ── Together / Fireworks (flat input=output for Llama-3.3-70B class) ─────
  { match: (p) => p === "together", inputPerMToken: 1.04, outputPerMToken: 1.04, source: "together.ai/models/llama-3-3-70b" },
  { match: (p) => p === "fireworks", inputPerMToken: 0.9, outputPerMToken: 0.9, source: "fireworks.ai (serverless llama-v3p3-70b)" },

  // ── Bundled local — always free (compute cost, not per-token) ────────────
  { match: (p) => p === "local" || p === "ollama", inputPerMToken: 0, outputPerMToken: 0, source: "bundled local inference (no per-token cost)" },

  // NOTE: Cohere intentionally omitted — only legacy-table rates were
  // verifiable as of 2026-06-18; do not seed unverified prices (never-fabricate).
];

/**
 * Resolve the seed price for a (providerId, modelId), or null when no bracket
 * matches (e.g. an unknown provider, or one with verification still pending).
 */
export function resolveSeedPrice(providerId: string, modelId: string): SeedPrice | null {
  const bracket = PRICE_BRACKETS.find((b) => b.match(providerId, modelId));
  return bracket ? { inputPerMToken: bracket.inputPerMToken, outputPerMToken: bracket.outputPerMToken } : null;
}
