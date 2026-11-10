// apps/web/lib/routing/vendor-sampling-catalog.ts
//
// BI-1F5DAABC: curated vendor sampling guidance, keyed by model family.
//
// THIS IS THE ONE TABLE IN THIS FEATURE THAT DECAYS. Qwen, DeepSeek, Hermes and
// the rest publish required sampling settings per release, and running at engine
// defaults instead is a documented cause of repetition loops and degraded
// reasoning. It is data, not logic, and it is keyed by family so a new point
// release inherits its family's guidance without a code change.
//
// It is a SEED, in the platform's usual sense: a curated catalog baseline that a
// discovered or operator value outranks (see ModelCardSampling.source). Per
// `commons-are-curated-not-just-appended` it needs an owner and a review cadence
// — a family whose vendor has since changed its guidance is a stale row, not a
// permanent fact.
//
// Sources are vendor model cards / release notes for each family. Where a vendor
// publishes nothing, the family is ABSENT rather than guessed: an omission leaves
// provider defaults in place, which is the honest behaviour.
//
// Spec: docs/superpowers/specs/2026-09-18-situational-llm-call-parameterization-design.md §1

import type { ModelCardSampling, SamplingProfile } from "./model-card-types";

function profile(
  temperature: number | null,
  topP: number | null,
  topK: number | null = null,
  minP: number | null = null,
  repeatPenalty: number | null = null,
): SamplingProfile {
  return { temperature, topP, topK, minP, repeatPenalty };
}

/**
 * Family key → guidance. Keys are lowercase family names as
 * `extractModelFamily` / `modelFamily` produce them; matching is prefix-based so
 * "qwen3.8" and "qwen3-coder" both resolve to the qwen3 entry.
 */
const CATALOG: Array<{ prefixes: string[]; sampling: Omit<ModelCardSampling, "source"> }> = [
  {
    // Qwen3 / Qwen3-Coder. Thinking mode is materially stricter than the default
    // mode, and the vendor is explicit that greedy decoding must not be used.
    prefixes: ["qwen3", "qwen2.5", "qwen"],
    sampling: {
      default: profile(0.7, 0.8, 20),
      thinking: profile(0.6, 0.95, 20, 0),
      unsupported: [],
    },
  },
  {
    // DeepSeek-R1 and its distills: reasoning-only guidance. The vendor warns
    // that higher temperatures produce endless repetition or incoherence.
    prefixes: ["deepseek-r1", "deepseek"],
    sampling: {
      default: profile(0.6, 0.95),
      thinking: profile(0.6, 0.95),
      unsupported: [],
    },
  },
  {
    // Hermes 4 follows Qwen3's guidance for non-creative work.
    prefixes: ["hermes"],
    sampling: {
      default: profile(0.7, 0.8, 20),
      thinking: profile(0.6, 0.95, 20),
      unsupported: [],
    },
  },
  {
    prefixes: ["gemma"],
    sampling: {
      default: profile(1.0, 0.95, 64),
      thinking: null,
      unsupported: [],
    },
  },
  {
    prefixes: ["llama"],
    sampling: {
      default: profile(0.6, 0.9),
      thinking: null,
      unsupported: [],
    },
  },
  {
    // Anthropic rejects temperature outright when extended thinking is enabled —
    // the adapter already deletes it, and declaring it here means the resolver
    // never proposes it in the first place.
    prefixes: ["claude"],
    sampling: {
      default: null,
      thinking: null,
      unsupported: ["temperature", "top_p", "top_k"],
    },
  },
];

/** Normalise a model or family id to a comparable family key. */
export function samplingFamilyKey(modelOrFamily: string): string {
  const bare = modelOrFamily.includes("/")
    ? modelOrFamily.split("/").pop() ?? modelOrFamily
    : modelOrFamily;
  const colon = bare.indexOf(":");
  return (colon > 0 ? bare.slice(0, colon) : bare).trim().toLowerCase();
}

/**
 * The curated guidance for a model family, or null when the vendor publishes
 * none. Null leaves provider defaults in place — it never means "use zero".
 *
 * Longest matching prefix wins, so "deepseek-r1" beats "deepseek" and
 * "qwen3" is not shadowed by a shorter "qwen".
 */
export function vendorSamplingForFamily(
  modelOrFamily: string | null | undefined,
): ModelCardSampling | null {
  if (!modelOrFamily) return null;
  const key = samplingFamilyKey(modelOrFamily);
  if (!key) return null;

  let best: { length: number; sampling: Omit<ModelCardSampling, "source"> } | null = null;
  for (const entry of CATALOG) {
    for (const prefix of entry.prefixes) {
      if (key.startsWith(prefix) && (best === null || prefix.length > best.length)) {
        best = { length: prefix.length, sampling: entry.sampling };
      }
    }
  }
  if (!best) return null;
  return { ...best.sampling, source: "catalog" };
}

/**
 * The sampling guidance to use for a card: whatever the card already carries
 * (discovered or operator-set) wins; otherwise the curated catalog fills in.
 * A card carrying only a `seed` placeholder is treated as carrying nothing,
 * exactly as `provider-routing-rollup` treats seed dimension scores.
 */
export function effectiveSampling(card: {
  modelId: string;
  modelFamily?: string | null;
  sampling?: ModelCardSampling | null;
}): ModelCardSampling | null {
  const existing = card.sampling;
  if (existing && existing.source !== "seed") return existing;
  return (
    vendorSamplingForFamily(card.modelFamily) ??
    vendorSamplingForFamily(card.modelId) ??
    existing ??
    null
  );
}
