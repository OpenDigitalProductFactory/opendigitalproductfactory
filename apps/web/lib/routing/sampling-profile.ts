// apps/web/lib/routing/sampling-profile.ts
//
// BI-1F5DAABC: one place that decides the sampling parameters of a call, called
// on EVERY dispatch path.
//
// The superseded design put this logic in recipe-seeder's buildProviderSettings,
// whose only caller is the champion-recipe maintenance job. Any dispatch that did
// not match a recipe row fell to buildDefaultPlan, which sent
// `providerSettings: {}` — provider defaults. On an install serving Qwen3 that
// meant running at the exact configuration Qwen documents as causing repetition
// loops and degraded reasoning.
//
// Composition order, each layer narrowing the one before:
//
//   modelCard.sampling[mode]   vendor floor — what the MODEL requires
//     ⊕ contract family        task intent — what the WORK requires (§2)
//     ⊕ recipe.providerSettings champion/challenger learning
//     ⊕ operator override      explicit, recorded
//     ⊖ sampling.unsupported   drop what this model rejects
//
// A later layer may move a value WITHIN the vendor's published range; none may
// leave it. The vendor knows its model; our table encodes our intent.
//
// Spec: docs/superpowers/specs/2026-09-18-situational-llm-call-parameterization-design.md §1

import {
  EMPTY_SAMPLING_PROFILE,
  type ModelCardSampling,
  type SamplingProfile,
} from "./model-card-types";
import { contractFamilyTemperature } from "./contract-family-sampling";

/** Which vendor profile applies to this call. */
export type SamplingMode = "default" | "thinking";

/** Where each resolved value came from — the point of the whole exercise. */
export type SamplingProvenance = "vendor" | "contract" | "recipe" | "operator";

export interface ResolvedSampling {
  /** Only the keys that were actually decided; absent means provider default. */
  values: Partial<Record<keyof SamplingProfile, number>>;
  /** Per-key provenance, for the operator-facing explanation. */
  provenance: Partial<Record<keyof SamplingProfile, SamplingProvenance>>;
  /** Parameter names dropped because this model rejects them. */
  dropped: string[];
  /** The vendor profile that applied, if any. */
  mode: SamplingMode;
}

export interface ResolveSamplingInput {
  sampling?: ModelCardSampling | null;
  /** Contract family, e.g. "sync.code_gen". */
  contractFamily: string;
  /** Thinking/reasoning is on for this call, so the thinking profile applies. */
  thinking?: boolean;
  /** The response must satisfy a schema — forces deterministic sampling. */
  strictSchema?: boolean;
  /** Recipe providerSettings (champion/challenger learning). */
  recipeSettings?: Record<string, unknown> | null;
  /** An explicit operator override, highest precedence below `unsupported`. */
  operatorOverride?: Partial<Record<keyof SamplingProfile, number>> | null;
}

const PROFILE_KEYS: ReadonlyArray<keyof SamplingProfile> = [
  "temperature",
  "topP",
  "topK",
  "minP",
  "repeatPenalty",
];

/** Provider wire names, so `unsupported` can be written either way. */
const WIRE_NAMES: Record<keyof SamplingProfile, string[]> = {
  temperature: ["temperature"],
  topP: ["topP", "top_p"],
  topK: ["topK", "top_k"],
  minP: ["minP", "min_p"],
  repeatPenalty: ["repeatPenalty", "repeat_penalty", "frequency_penalty"],
};

function isUnsupported(key: keyof SamplingProfile, unsupported: readonly string[]): boolean {
  if (unsupported.length === 0) return false;
  const lowered = unsupported.map((name) => name.toLowerCase());
  return WIRE_NAMES[key].some((name) => lowered.includes(name.toLowerCase()));
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Read a key out of recipe providerSettings under either naming convention. */
function fromRecipeSettings(
  key: keyof SamplingProfile,
  settings: Record<string, unknown> | null | undefined,
): number | null {
  if (!settings) return null;
  for (const name of WIRE_NAMES[key]) {
    const found = numeric(settings[name]);
    if (found !== null) return found;
  }
  return null;
}

/**
 * The vendor profile for this call. `thinking` selects the thinking profile when
 * the model publishes one; otherwise the default profile applies, because a model
 * with no thinking guidance still has sampling guidance.
 */
export function vendorProfileFor(
  sampling: ModelCardSampling | null | undefined,
  thinking: boolean,
): { profile: SamplingProfile; mode: SamplingMode } {
  if (!sampling) return { profile: EMPTY_SAMPLING_PROFILE, mode: "default" };
  if (thinking && sampling.thinking) return { profile: sampling.thinking, mode: "thinking" };
  return { profile: sampling.default ?? EMPTY_SAMPLING_PROFILE, mode: "default" };
}

/**
 * Compose the final sampling parameters for one call.
 *
 * Runs on BOTH plan-building paths (buildPlanFromRecipe and buildDefaultPlan), so
 * "no recipe matched" now means "vendor and contract parameters, without recipe
 * learning" rather than "no parameters at all".
 */
export function resolveSamplingProfile(input: ResolveSamplingInput): ResolvedSampling {
  const thinking = input.thinking === true;
  const { profile: vendor, mode } = vendorProfileFor(input.sampling, thinking);
  const unsupported = input.sampling?.unsupported ?? [];

  const values: ResolvedSampling["values"] = {};
  const provenance: ResolvedSampling["provenance"] = {};
  const dropped: string[] = [];

  // The contract's temperature. A vendor THINKING profile outranks it: when the
  // model publishes what it needs while reasoning, that is stricter evidence than
  // our intent table. A vendor DEFAULT temperature does not outrank it — the task
  // legitimately narrows a general-purpose default.
  const contractTemperature = contractFamilyTemperature(input.contractFamily, {
    strictSchema: input.strictSchema,
  });

  for (const key of PROFILE_KEYS) {
    if (isUnsupported(key, unsupported)) {
      dropped.push(key);
      continue;
    }

    let value: number | null = null;
    let from: SamplingProvenance | null = null;

    const vendorValue = vendor[key];
    if (vendorValue !== null && vendorValue !== undefined) {
      value = vendorValue;
      from = "vendor";
    }

    if (key === "temperature" && contractTemperature !== null) {
      // Honour the vendor's thinking-mode temperature; otherwise the task wins.
      if (!(mode === "thinking" && value !== null)) {
        value = contractTemperature;
        from = "contract";
      }
    }

    const recipeValue = fromRecipeSettings(key, input.recipeSettings);
    if (recipeValue !== null) {
      value = recipeValue;
      from = "recipe";
    }

    const overrideValue = numeric(input.operatorOverride?.[key]);
    if (overrideValue !== null) {
      value = overrideValue;
      from = "operator";
    }

    if (value !== null && from !== null) {
      values[key] = value;
      provenance[key] = from;
    }
  }

  return { values, provenance, dropped, mode };
}

/** Provider wire form (snake_case) for an OpenAI-compatible or Ollama body. */
export function toWireSampling(
  resolved: ResolvedSampling,
): Record<string, number> {
  const wire: Record<string, number> = {};
  const map: Record<keyof SamplingProfile, string> = {
    temperature: "temperature",
    topP: "top_p",
    topK: "top_k",
    minP: "min_p",
    repeatPenalty: "repeat_penalty",
  };
  for (const key of PROFILE_KEYS) {
    const value = resolved.values[key];
    if (value !== undefined) wire[map[key]] = value;
  }
  return wire;
}
