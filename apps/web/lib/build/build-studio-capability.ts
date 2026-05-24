// apps/web/lib/build/build-studio-capability.ts
//
// Build Studio capability pre-check.
//
// The build-specialist agent (chat displayName "Software Engineer") requires
// minimumTier=strong, minimumContextTokens=32000, minimumCapabilities.toolUse.
// On an install where no active provider satisfies those requirements,
// letting the user into the intake flow produces opaque agent failures
// (meta-self-talk from underpowered local models, or the prior dishonest
// "I'll route through a different model" promise that never re-routed).
//
// This helper answers a single question: "can Build Studio actually serve
// this user right now?" It is consumed by:
//   - apps/web/app/(shell)/build/page.tsx — render a hard gate when ok=false
//   - apps/web/lib/tak/agentic-loop.ts    — pick honest failure copy
//
// Pure decision function + thin DB wrapper, so the logic is unit-testable
// without touching Prisma.

import { prisma } from "@dpf/db";
import { assignTierFromModelId, type QualityTier } from "@/lib/routing/quality-tiers";

export const BUILD_STUDIO_REQUIRED_CONTEXT_TOKENS = 32_000;
export const BUILD_STUDIO_REQUIRED_TIERS: ReadonlySet<QualityTier> = new Set(["strong", "frontier"]);

export type BuildStudioCapability =
  | { ok: true; satisfyingProviderNames: string[] }
  | {
      ok: false;
      reason:
        | "no_active_llm_providers"
        | "only_local_provider_active"
        | "no_strong_tier_model_available";
      activeProviderNames: string[];
      suggestedProviders: ReadonlyArray<SuggestedProvider>;
    };

export interface ActiveProviderModel {
  providerId: string;
  providerName: string;
  modelId: string;
  // Null when discovery has not yet confirmed; treated as "assumed true"
  // so a freshly connected provider isn't gated waiting on discovery.
  supportsToolUse: boolean | null;
  maxInputTokens: number | null;
}

export interface SuggestedProvider {
  name: string;
  description: string;
  recommended?: boolean;
}

export const SUGGESTED_PROVIDERS: ReadonlyArray<SuggestedProvider> = [
  {
    name: "Claude (Anthropic) — Subscription sign-in",
    description: "Easiest path: sign in with an existing Claude account. No API key needed.",
    recommended: true,
  },
  {
    name: "Google Gemini",
    description: "Generous free tier; quick API-key setup.",
  },
  {
    name: "OpenAI",
    description: "Widely used; API-key setup.",
  },
];

/**
 * Treat a provider as "local-only" when its name signals on-host inference.
 * Used to choose between "only_local_provider_active" (clearer call-to-action:
 * connect a remote) and "no_strong_tier_model_available" (something else is
 * off — admin should investigate provider config).
 */
function isLocalProviderName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("local") || lower.includes("ollama") || lower.includes("docker model runner");
}

/**
 * Pure decision function — no DB. Given the set of active-provider models,
 * decide whether Build Studio's build-specialist agent can be served by at
 * least one of them.
 *
 * **Hard rule: local-provider models never satisfy the gate**, regardless
 * of tier classification. Operator directive (Mark, 2026-05-23): Build Studio
 * does code generation + long tool sequences + complex reasoning that exceed
 * even strong-tier local model robustness (cf. `project_mechanism_question_
 * grounding_gap.md` — small/local models confabulate on this workload).
 * Local stays valid for less demanding coworkers; Build Studio specifically
 * requires a remote provider.
 *
 * Nullable fields (supportsToolUse, maxInputTokens) are treated as "assumed
 * sufficient" so a freshly connected REMOTE provider isn't blocked while
 * model discovery is still running in the background.
 */
export function deriveBuildStudioCapability(models: ActiveProviderModel[]): BuildStudioCapability {
  if (models.length === 0) {
    return {
      ok: false,
      reason: "no_active_llm_providers",
      activeProviderNames: [],
      suggestedProviders: SUGGESTED_PROVIDERS,
    };
  }

  const activeProviderNames = Array.from(new Set(models.map((m) => m.providerName)));

  const satisfying = models.filter((m) => {
    // Hard rule: local providers never satisfy Build Studio's gate, even when
    // the tier classifier rates the model as strong (e.g. Qwen3 14B). The
    // workload exceeds even strong-tier local robustness.
    if (isLocalProviderName(m.providerName)) return false;
    if (m.supportsToolUse === false) return false;
    const tier = assignTierFromModelId(m.modelId);
    if (!BUILD_STUDIO_REQUIRED_TIERS.has(tier)) return false;
    if (m.maxInputTokens !== null && m.maxInputTokens < BUILD_STUDIO_REQUIRED_CONTEXT_TOKENS) {
      return false;
    }
    return true;
  });

  if (satisfying.length > 0) {
    return {
      ok: true,
      satisfyingProviderNames: Array.from(new Set(satisfying.map((m) => m.providerName))),
    };
  }

  const onlyLocal = activeProviderNames.every(isLocalProviderName);

  return {
    ok: false,
    reason: onlyLocal ? "only_local_provider_active" : "no_strong_tier_model_available",
    activeProviderNames,
    suggestedProviders: SUGGESTED_PROVIDERS,
  };
}

/**
 * DB wrapper — fetches active providers + their profiled chat models, then
 * calls the pure decision function. Used at /build page render time.
 */
export async function loadBuildStudioCapability(): Promise<BuildStudioCapability> {
  const profiles = await prisma.modelProfile.findMany({
    where: {
      modelClass: "chat",
      provider: { status: "active" },
    },
    select: {
      providerId: true,
      modelId: true,
      supportsToolUse: true,
      maxInputTokens: true,
      provider: { select: { name: true } },
    },
  });

  const models: ActiveProviderModel[] = profiles.map((p) => ({
    providerId: p.providerId,
    providerName: p.provider.name,
    modelId: p.modelId,
    supportsToolUse: p.supportsToolUse,
    maxInputTokens: p.maxInputTokens,
  }));

  return deriveBuildStudioCapability(models);
}

/**
 * Convenience for agentic-loop's failure-message helpers — true when the
 * only active LLM provider on this install is a local one.
 */
export async function isOnlyLocalLLMActive(): Promise<boolean> {
  const result = await loadBuildStudioCapability();
  return !result.ok && result.reason === "only_local_provider_active";
}
