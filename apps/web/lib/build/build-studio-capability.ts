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
      // Configured-but-disabled CLI code runners (e.g. anthropic-sub, codex)
      // that the operator can switch on in place — no trip to
      // /platform/ai/providers. Empty when nothing is merely turned off.
      enableableRunners: ReadonlyArray<EnableableRunner>;
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

/**
 * A code-capable CLI runner that exists in ModelProvider with status
 * `inactive` — credentialed/configured but switched off. Surfaced on the
 * build gate with an inline "Enable" action (toggleProviderStatus) so the
 * operator never has to leave the screen for /platform/ai/providers.
 */
export interface EnableableRunner {
  providerId: string;
  /** Full provider display name, e.g. "Claude / Anthropic (OAuth Subscription)". */
  name: string;
  /** Short user-facing label for inline copy + the Enable button, e.g. "Claude" / "Codex". */
  shortLabel: string;
}

/** Raw DB shape for a configured-but-disabled CLI runner, fed to the pure decision fn. */
export interface ConfiguredInactiveRunner {
  providerId: string;
  name: string;
  /** "claude" | "codex" | null — which CLI dispatch engine, drives the short label. */
  cliEngine: string | null;
}

function shortRunnerLabel(runner: ConfiguredInactiveRunner): string {
  if (runner.cliEngine === "claude") return "Claude";
  if (runner.cliEngine === "codex") return "Codex";
  return runner.name;
}

export const SUGGESTED_PROVIDERS: ReadonlyArray<SuggestedProvider> = [
  {
    name: "ChatGPT / OpenAI Codex - Subscription sign-in",
    description: "Recommended: sign in with OpenAI OAuth. Build Studio uses the Codex CLI path; no API key needed.",
    recommended: true,
  },
  {
    name: "Claude - Subscription (CLI)",
    description: "Recommended: sign in with your Claude (Anthropic) subscription via OAuth. Build Studio runs code generation through the Claude CLI path; no API key needed.",
    recommended: true,
  },
  {
    name: "OpenAI API key",
    description: "Separate OpenAI platform billing. Use this when you want pay-per-token API usage instead of ChatGPT plan limits.",
  },
  {
    name: "Anthropic API key",
    description: "Separate Anthropic Console billing. Use this when Claude subscription limits are paused or exhausted.",
  },
  {
    name: "Google Gemini API key",
    description: "Useful for light or backup routing. Free-tier keys have lower quotas than paid API or subscription CLI paths.",
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
 * **Local-provider rule: local models satisfy the gate ONLY when a
 * deterministic tool-calling build engine (opencode) is available** to drive
 * them. The original blanket block (operator directive, Mark, 2026-05-23) was
 * grounded in raw local-model robustness on long tool sequences — small/local
 * models confabulate on this workload (cf. `project_mechanism_question_
 * grounding_gap.md`). That concern is addressed when the build dispatch runs
 * through opencode, which parses the model's native tool-call format and
 * supplies the tool loop itself rather than relying on the model's API
 * tool-use. Operator decision (Mark, 2026-06-15): with opencode proven on
 * qwen3-coder, enable local Build Studio gated on that engine's presence.
 * Without opencode, local still cannot satisfy the gate. Remote providers are
 * unchanged — they still require their own API tool-use.
 *
 * Nullable fields (supportsToolUse, maxInputTokens) are treated as "assumed
 * sufficient" so a freshly connected REMOTE provider isn't blocked while
 * model discovery is still running in the background. For LOCAL models the
 * API supportsToolUse flag is intentionally NOT required, because opencode —
 * not the model API — provides the tool-call loop.
 */
export function deriveBuildStudioCapability(
  models: ActiveProviderModel[],
  inactiveRunners: ConfiguredInactiveRunner[] = [],
  localBuildEngineAvailable = false,
): BuildStudioCapability {
  const enableableRunners: EnableableRunner[] = inactiveRunners.map((r) => ({
    providerId: r.providerId,
    name: r.name,
    shortLabel: shortRunnerLabel(r),
  }));

  if (models.length === 0) {
    return {
      ok: false,
      reason: "no_active_llm_providers",
      activeProviderNames: [],
      suggestedProviders: SUGGESTED_PROVIDERS,
      enableableRunners,
    };
  }

  const activeProviderNames = Array.from(new Set(models.map((m) => m.providerName)));

  const satisfying = models.filter((m) => {
    const isLocal = isLocalProviderName(m.providerName);
    // Local providers satisfy the gate only when opencode is available to
    // drive them (it supplies the tool-call loop the build workload needs).
    // Without that engine, local stays blocked — preserving the original
    // robustness safeguard.
    if (isLocal && !localBuildEngineAvailable) return false;
    // Remote providers must advertise API tool-use. Local models route their
    // tool-calls through opencode's parser, so the model's API supportsToolUse
    // flag (often false for local chat models) must NOT gate them out.
    if (!isLocal && m.supportsToolUse === false) return false;
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
    enableableRunners,
  };
}

/**
 * DB wrapper — fetches active providers + their profiled chat models, then
 * calls the pure decision function. Used at /build page render time.
 */
export async function loadBuildStudioCapability(): Promise<BuildStudioCapability> {
  const [profiles, inactiveProviders, localEngine] = await Promise.all([
    prisma.modelProfile.findMany({
      where: {
        modelClass: { in: ["chat", "code"] },
        modelStatus: { in: ["active", "degraded"] },
        provider: { status: "active" },
      },
      select: {
        providerId: true,
        modelId: true,
        supportsToolUse: true,
        maxInputTokens: true,
        provider: { select: { name: true } },
      },
    }),
    // Code runners that are configured/credentialed but switched off
    // (status="inactive"). cliEngine!=null means it dispatches the Claude or
    // Codex CLI path — exactly the runners the build orchestrator can drive.
    // These get an inline Enable action on the gate; "unconfigured" providers
    // (never set up) are intentionally excluded — they need the connect flow.
    prisma.modelProvider.findMany({
      where: { status: "inactive", cliEngine: { not: null } },
      select: { providerId: true, name: true, cliEngine: true },
      orderBy: { providerId: "asc" },
    }),
    // The opencode build engine — the deterministic tool-calling runner that
    // makes a local model viable for Build Studio. "Available" = its binary is
    // present in the sandbox (probed) OR it is baked into the image by default.
    prisma.buildEngine.findFirst({
      where: { engineId: "opencode" },
      select: { bakeInDefault: true, state: { select: { present: true } } },
    }),
  ]);

  const localBuildEngineAvailable =
    !!localEngine && (localEngine.state?.present === true || localEngine.bakeInDefault === true);

  const models: ActiveProviderModel[] = profiles.map((p) => ({
    providerId: p.providerId,
    providerName: p.provider.name,
    modelId: p.modelId,
    supportsToolUse: p.supportsToolUse,
    maxInputTokens: p.maxInputTokens,
  }));

  const inactiveRunners: ConfiguredInactiveRunner[] = inactiveProviders.map((p) => ({
    providerId: p.providerId,
    name: p.name,
    cliEngine: p.cliEngine,
  }));

  return deriveBuildStudioCapability(models, inactiveRunners, localBuildEngineAvailable);
}

/**
 * Convenience for agentic-loop's failure-message helpers — true when the
 * only active LLM provider on this install is a local one.
 */
export async function isOnlyLocalLLMActive(): Promise<boolean> {
  const result = await loadBuildStudioCapability();
  return !result.ok && result.reason === "only_local_provider_active";
}
