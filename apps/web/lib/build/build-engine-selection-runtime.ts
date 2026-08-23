import { prisma } from "@dpf/db";

import { getLocalOnlyInference } from "@/lib/inference/local-only";
import { previewRoute } from "@/lib/inference/routed-inference";
import { resolveCredentialProviderId } from "@/lib/inference/ai-provider-internals";
import { loadProviderHealthBatch } from "@/lib/routing/provider-health-loader";
import { cliAdapterTypeForProvider } from "@/lib/routing/provider-routing-eligibility";
import type { SensitivityLevel } from "@/lib/routing/types";
import {
  qualifyBuildEngineCandidates,
  selectBuildEngineFromCandidates,
  type BuildEngineCandidate,
  type BuildEngineId,
  type BuildEnginePolicy,
  type BuildEngineRouteResult,
  type BuildEngineSelection,
} from "./build-engine-selection";

export type BuildEnginePreferenceConfig = {
  claudeProviderId: string;
  codexProviderId: string;
  grokProviderId: string;
  opencodeProviderId: string;
  claudeModel: string;
  codexModel: string;
  grokModel: string;
  opencodeModel: string;
};

type ResolveOptions = {
  policy: BuildEnginePolicy;
  modelTier?: "local" | "robust";
  sensitivity?: SensitivityLevel;
  nowMs?: number;
};

function configuredProviderForEngine(
  engine: Exclude<BuildEngineId, "agentic">,
  config: BuildEnginePreferenceConfig,
): string {
  switch (engine) {
    case "claude": return config.claudeProviderId;
    case "codex": return config.codexProviderId;
    case "grok": return config.grokProviderId;
    case "opencode": return config.opencodeProviderId;
  }
}

function configuredModelForEngine(
  engine: BuildEngineId,
  config: BuildEnginePreferenceConfig,
): string | null {
  switch (engine) {
    case "claude": return config.claudeModel || null;
    case "codex": return config.codexModel || null;
    case "grok": return config.grokModel || null;
    case "opencode": return config.opencodeModel || null;
    case "agentic": return null;
  }
}

function providerIsLocal(provider: { providerId: string; category: string | null; authMethod: string }): boolean {
  return provider.authMethod === "none"
    || provider.category === "local"
    || provider.providerId === "local"
    || provider.providerId === "ollama";
}

function fallbackProviderOrder(decision: {
  fallbackChain: string[];
  candidates: Array<{ endpointId: string; providerId: string }>;
  selectedEndpoint: string | null;
}): string[] {
  const providerByEndpoint = new Map(
    decision.candidates.map((candidate) => [candidate.endpointId, candidate.providerId]),
  );
  const seen = new Set<string>();
  const providers: string[] = [];
  for (const endpointId of decision.fallbackChain) {
    if (endpointId === decision.selectedEndpoint) continue;
    const providerId = providerByEndpoint.get(endpointId);
    if (!providerId || seen.has(providerId)) continue;
    seen.add(providerId);
    providers.push(providerId);
  }
  return providers;
}

export async function resolveBuildEngineSelection(
  config: BuildEnginePreferenceConfig,
  opts: ResolveOptions,
): Promise<BuildEngineSelection> {
  const nowMs = opts.nowMs ?? Date.now();
  const providers = await prisma.modelProvider.findMany({
    where: {
      retiredAt: null,
      endpointType: { not: "service" },
    },
    select: {
      providerId: true,
      status: true,
      authMethod: true,
      cliEngine: true,
      category: true,
    },
  });

  const preferredProviderIds = new Map<Exclude<BuildEngineId, "agentic">, string>(
    (["claude", "codex", "grok", "opencode"] as const)
      .map((engine) => [engine, configuredProviderForEngine(engine, config)] as const)
      .filter((entry) => entry[1].length > 0),
  );
  const structuralProviders = providers.filter((provider) => {
    if (provider.cliEngine === "claude" || provider.cliEngine === "codex" || provider.cliEngine === "grok" || provider.cliEngine === "opencode") {
      const preferred = preferredProviderIds.get(provider.cliEngine);
      return !preferred || preferred === provider.providerId;
    }
    return provider.cliEngine === null;
  });
  const providerIds = structuralProviders.map((provider) => provider.providerId);
  const credentialIds = [...new Set(providerIds.map(resolveCredentialProviderId))];

  const [credentials, engines, capacities, cliPools, healthByProvider, localOnlySetting] = await Promise.all([
    prisma.credentialEntry.findMany({
      where: { providerId: { in: credentialIds } },
      select: {
        providerId: true,
        status: true,
        tokenExpiresAt: true,
        secretRef: true,
        cachedToken: true,
        clientId: true,
        clientSecret: true,
      },
    }),
    prisma.buildEngine.findMany({
      select: { engineId: true, state: { select: { present: true } } },
    }),
    prisma.providerCapacityStatus.findMany({
      where: { providerId: { in: providerIds } },
      select: { providerId: true, state: true, retryAt: true },
    }),
    prisma.cliPoolStatus.findMany({
      select: { adapterType: true, resetAt: true },
    }),
    loadProviderHealthBatch(providerIds, { now: nowMs }),
    getLocalOnlyInference(),
  ]);

  const credentialById = new Map(credentials.map((row) => [row.providerId, row]));
  const engineById = new Map(engines.map((row) => [row.engineId, row]));
  const capacityByProvider = new Map(capacities.map((row) => [row.providerId, row]));
  const cliRetryByAdapter = new Map(cliPools.map((row) => [row.adapterType, row.resetAt?.getTime() ?? null]));

  const candidates: BuildEngineCandidate[] = structuralProviders.flatMap((provider) => {
    const engine: BuildEngineId =
      provider.cliEngine === "claude"
      || provider.cliEngine === "codex"
      || provider.cliEngine === "grok"
      || provider.cliEngine === "opencode"
        ? provider.cliEngine
        : "agentic";
    const engineRow = engine === "agentic" ? null : engineById.get(engine);
    const credential = credentialById.get(resolveCredentialProviderId(provider.providerId));
    const hasCredentialMaterial = provider.authMethod === "none"
      || Boolean(
        credential?.secretRef
        || credential?.cachedToken
        || (credential?.clientId && credential?.clientSecret),
      );
    const capacity = capacityByProvider.get(provider.providerId);
    const cliAdapter = cliAdapterTypeForProvider(provider.providerId);
    const healthEntry = healthByProvider.get(provider.providerId);
    const providerHealth = healthEntry?.status === "fulfilled"
      ? healthEntry.value.status
      : "unknown";
    return [{
      engine,
      providerId: provider.providerId,
      modelId: configuredModelForEngine(engine, config),
      local: providerIsLocal(provider),
      registered: engine === "agentic" || engineRow !== undefined,
      present: engine === "agentic" || engineRow?.state?.present === true,
      providerStatus: provider.status,
      authMethod: provider.authMethod,
      credentialStatus: hasCredentialMaterial ? credential?.status ?? null : null,
      credentialExpiresAt: credential?.tokenExpiresAt?.getTime() ?? null,
      providerCapacityState: capacity?.state ?? null,
      providerRetryAt: capacity?.retryAt?.getTime() ?? null,
      cliRetryAt: cliAdapter ? cliRetryByAdapter.get(cliAdapter) ?? null : null,
      providerHealth,
    }];
  });

  // Only the explicit platform local-only switch is a hard residency boundary.
  // A `modelTier === "local"` build is sized to PREFER the on-box model (cost),
  // not to FORBID cloud — so cloud engines stay qualified as fallbacks. Without
  // this, every trivial-tail build was local-only and starved whenever local-CI
  // fenced the local model on a single host (BI-8B4359DE). Local is still
  // preferred by cost ranking when available; sensitivity clearance still gates.
  const localOnly = localOnlySetting;
  const qualification = qualifyBuildEngineCandidates({
    policy: opts.policy,
    candidates,
    localOnly,
    nowMs,
  });
  let route: BuildEngineRouteResult;
  if (qualification.eligible.length === 0) {
    route = {
      selectedProviderId: null,
      selectedModelId: null,
      reason: "No engine passed Build Studio readiness and policy qualification.",
      fallbackProviderIds: [],
      rejectedProviders: [],
    };
  } else {
    try {
      const preview = await previewRoute(
        [{ role: "user", content: "Generate and modify source code for a Build Studio task." }],
        // Source-code generation is development work, not internal business data
        // (founder ruling 2026-08-12) — default to the development clearance class.
        opts.sensitivity ?? "development",
        {
          taskType: "code-gen",
          tools: [{ name: "edit_sandbox_file" }, { name: "run_sandbox_tests" }],
          requireTools: true,
          budgetClass: "quality_first",
          allowedProviders: [...new Set(qualification.eligible.map((candidate) => candidate.providerId))],
          residencyPolicy: localOnly ? "local_only" : "any_enabled",
          ...(opts.modelTier ? { modelTier: opts.modelTier } : {}),
        },
      );
      route = {
        selectedProviderId: preview.selectedManifest?.providerId ?? null,
        selectedModelId: preview.decision.selectedModelId,
        reason: preview.decision.reason,
        fallbackProviderIds: fallbackProviderOrder(preview.decision),
        rejectedProviders: preview.decision.candidates
          .filter((candidate) => candidate.excluded)
          .map((candidate) => ({
            providerId: candidate.providerId,
            reason: candidate.excludedReason ?? "Excluded by the Build Studio route contract.",
          })),
      };
    } catch (error) {
      route = {
        selectedProviderId: null,
        selectedModelId: null,
        reason: error instanceof Error ? error.message : "Build Studio route preview failed.",
        fallbackProviderIds: [],
        rejectedProviders: [],
      };
    }
  }

  return selectBuildEngineFromCandidates({
    policy: opts.policy,
    candidates,
    route,
    localOnly,
    nowMs,
  });
}

export function formatBuildEngineSelectionEvidence(selection: BuildEngineSelection): string {
  const selected = selection.selected
    ? `${selection.selected.engine} (provider=${selection.selected.providerId}, model=${selection.selected.modelId || "provider default"})`
    : "none";
  const fallbacks = selection.fallbackChain.length > 0
    ? selection.fallbackChain.map((entry) => `${entry.engine}:${entry.providerId}`).join(" -> ")
    : "none";
  const rejected = selection.rejected.length > 0
    ? selection.rejected.map((entry) => `${entry.engine}:${entry.providerId} [${entry.code}: ${entry.reason}]`).join(", ")
    : "none";
  return `Build engine selection: ${selected}. Reason: ${selection.reason} Fallback chain: ${fallbacks}. Rejected: ${rejected}.`;
}
