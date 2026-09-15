// apps/web/lib/routing/model-pricing-reference.ts
//
// Researched per-model list pricing, so a discovered model is costed at its OWN
// rate rather than inheriting one flat provider rate.
//
// The defect this closes: model discovery writes EMPTY_PRICING (all nulls) for
// any provider whose metadata does not carry prices, and `loader.ts` then falls
// back to `provider.outputPricePerMToken` — a single number for the whole
// provider. Measured on this install, every codex and zai model was unpriced, so
// the router costed them all at the provider default:
//
//   model            real $/MTok out    router believed
//   gpt-6-astra              50               6
//   gpt-5.5-pro             180               6
//   gpt-5.6-luna              1.20            6
//   glm-5.3-flash             0.50            4.4
//
// Frontier models were 8-30x underpriced, which makes any cost-weighted routing
// or budget planning invalid.
//
// The rule: a model is priced from the reference or reported UNPRICED. It is
// never guessed. An absent entry is a signal to research and add a row, not a
// licence to interpolate from a sibling — sibling models differ by 100x here
// (gpt-5.6-luna $1.20 vs gpt-5.6-cyber $75).
export type ReferencePricing = {
  inputPerMToken: number;
  outputPerMToken: number;
};

type PricingFile = {
  retrievedAt: string;
  sources: Record<string, string>;
  providerCostModel: Record<string, string>;
  models: Record<string, ReferencePricing>;
};

/**
 * Researched list prices, USD per million tokens. Retrieved 2026-09-16 from:
 *   OpenAI     https://developers.openai.com/api/docs/pricing
 *   Anthropic  https://platform.claude.com/docs/en/docs/about-claude/pricing
 *   Z.ai       https://docs.z.ai/guides/overview/pricing
 *
 * Add a row when a provider ships a model. An absent row reports UNPRICED —
 * that is the correct outcome, not a licence to interpolate from a sibling.
 */
const REFERENCE: PricingFile = {
  retrievedAt: "2026-09-16",
  sources: {
    openai: "https://developers.openai.com/api/docs/pricing",
    anthropic: "https://platform.claude.com/docs/en/docs/about-claude/pricing",
    zai: "https://docs.z.ai/guides/overview/pricing",
  },
  providerCostModel: {
    "anthropic-sub": "subscription",
    chatgpt: "subscription",
    local: "compute",
    codex: "token",
    zai: "token",
    "zai-coding": "token",
  },
  models: {
    "gpt-6-astra": { inputPerMToken: 10.0, outputPerMToken: 50.0 },
    "gpt-5.6-cyber": { inputPerMToken: 12.5, outputPerMToken: 75.0 },
    "gpt-5.6-sol": { inputPerMToken: 4.0, outputPerMToken: 20.0 },
    "gpt-5.6-terra": { inputPerMToken: 2.0, outputPerMToken: 12.0 },
    "gpt-5.6-luna": { inputPerMToken: 0.2, outputPerMToken: 1.2 },
    "gpt-5.5": { inputPerMToken: 5.0, outputPerMToken: 30.0 },
    "gpt-5.5-pro": { inputPerMToken: 30.0, outputPerMToken: 180.0 },
    "gpt-5.5-cyber": { inputPerMToken: 12.5, outputPerMToken: 75.0 },
    "gpt-5.4": { inputPerMToken: 2.5, outputPerMToken: 15.0 },
    "gpt-5.4-mini": { inputPerMToken: 0.75, outputPerMToken: 4.5 },
    "gpt-5.4-nano": { inputPerMToken: 0.2, outputPerMToken: 1.25 },
    "gpt-5.4-pro": { inputPerMToken: 30.0, outputPerMToken: 180.0 },
    "gpt-5.3-codex": { inputPerMToken: 1.75, outputPerMToken: 14.0 },
    "gpt-5.3-codex-spark": { inputPerMToken: 1.75, outputPerMToken: 14.0 },
    "gpt-5.2": { inputPerMToken: 1.75, outputPerMToken: 14.0 },
    "gpt-5.1": { inputPerMToken: 1.25, outputPerMToken: 10.0 },
    "gpt-5": { inputPerMToken: 1.25, outputPerMToken: 10.0 },
    "gpt-5-mini": { inputPerMToken: 0.25, outputPerMToken: 2.0 },
    "gpt-5-nano": { inputPerMToken: 0.05, outputPerMToken: 0.4 },
    "codex-mini-latest": { inputPerMToken: 1.5, outputPerMToken: 6.0 },

    "claude-fable-5-1": { inputPerMToken: 10.0, outputPerMToken: 50.0 },
    "claude-fable-5": { inputPerMToken: 10.0, outputPerMToken: 50.0 },
    "claude-opus-5": { inputPerMToken: 5.0, outputPerMToken: 25.0 },
    "claude-opus-4-8": { inputPerMToken: 5.0, outputPerMToken: 25.0 },
    "claude-opus-4-7": { inputPerMToken: 5.0, outputPerMToken: 25.0 },
    "claude-opus-4-6": { inputPerMToken: 5.0, outputPerMToken: 25.0 },
    "claude-opus-4-5-20251101": { inputPerMToken: 5.0, outputPerMToken: 25.0 },
    "claude-opus-4-1-20250805": { inputPerMToken: 15.0, outputPerMToken: 75.0 },
    "claude-sonnet-5": { inputPerMToken: 2.0, outputPerMToken: 10.0 },
    "claude-sonnet-4-6": { inputPerMToken: 3.0, outputPerMToken: 15.0 },
    "claude-sonnet-4-5-20250929": { inputPerMToken: 3.0, outputPerMToken: 15.0 },
    "claude-haiku-4-5-20251001": { inputPerMToken: 1.0, outputPerMToken: 5.0 },
    "claude-3-haiku-20240307": { inputPerMToken: 0.25, outputPerMToken: 1.25 },

    "glm-5.3": { inputPerMToken: 1.4, outputPerMToken: 4.4 },
    "glm-5.3-flash": { inputPerMToken: 0.15, outputPerMToken: 0.5 },
    "glm-5.2": { inputPerMToken: 1.4, outputPerMToken: 4.4 },
    "glm-5.1": { inputPerMToken: 1.4, outputPerMToken: 4.4 },
    "glm-5": { inputPerMToken: 1.0, outputPerMToken: 3.2 },
    "glm-4.7": { inputPerMToken: 0.6, outputPerMToken: 2.2 },
    "glm-4.7-flashx": { inputPerMToken: 0.07, outputPerMToken: 0.4 },
    "glm-4.6": { inputPerMToken: 0.6, outputPerMToken: 2.2 },
    "glm-4.5": { inputPerMToken: 0.6, outputPerMToken: 2.2 },
    "glm-4.5-air": { inputPerMToken: 0.2, outputPerMToken: 1.1 },
  },
};

const FILE = REFERENCE;

/**
 * Discovery quarantines a model by prefixing its id with
 * `__dpf_quarantined__<cuid>__`. The underlying model still has a real price, so
 * strip the marker before lookup rather than reporting it unpriced.
 */
export function normalizeModelIdForPricing(modelId: string): string {
  const unquarantined = modelId.replace(/^__dpf_quarantined__[^_]+__/, "");
  return unquarantined.trim().toLowerCase();
}

/** Look up researched pricing. Returns null when the model is not in the reference. */
export function referencePricingFor(modelId: string | null | undefined): ReferencePricing | null {
  if (!modelId) return null;
  const key = normalizeModelIdForPricing(modelId);
  const direct = FILE.models[key];
  if (direct) return { ...direct };
  // Exact match only. Prefix/family matching is deliberately NOT done: within one
  // family prices span two orders of magnitude, so a near-miss would be a guess
  // wearing a real number's clothes.
  return null;
}

/** The cost model a provider bills on — subscription, metered tokens, or local compute. */
export function providerCostModel(providerId: string | null | undefined): string | null {
  if (!providerId) return null;
  return FILE.providerCostModel[providerId] ?? null;
}

/** Provenance, so a price in the UI can say where it came from and when. */
export function pricingProvenance(): { retrievedAt: string; sources: Record<string, string> } {
  return { retrievedAt: FILE.retrievedAt, sources: { ...FILE.sources } };
}

/** Every model id the reference prices — used by the coverage report. */
export function pricedModelIds(): string[] {
  return Object.keys(FILE.models).sort();
}
