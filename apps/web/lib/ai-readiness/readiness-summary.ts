import { prisma } from "@dpf/db";

import { getProviders, getProviderModelSummaries } from "@/lib/ai-provider-data";
import {
  buildEngineLabel,
  resolveModelSelectionByPhase,
} from "@/lib/inference/phase-model-resolution";
import { getBuildStudioConfig } from "@/lib/build/build-studio-config";
import type { RoutingEligibility } from "@/lib/routing/provider-routing-eligibility";
import {
  cliAdapterTypeForProvider,
  deriveRoutingEligibility,
} from "@/lib/routing/provider-routing-eligibility";
import { getAllCliPoolStatuses, type CliPoolState } from "@/lib/routing/cli-pool-status";
import {
  getContributorMcpReadiness,
  type ContributorMcpReadiness,
} from "@/lib/mcp/contributor-readiness";
import {
  CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS,
  getMcpTokenTemplate,
} from "@/lib/mcp-token-scopes";
import type { ModelSelectionOverview } from "@/lib/inference/phase-model-resolution";

export type ReadinessState = "ready" | "attention" | "blocked" | "diagnostic";

export type AiReadinessDomainId =
  | "model-supply"
  | "build-execution"
  | "tool-access"
  | "routing-confidence";

export interface AiReadinessEvidence {
  label: string;
  value: string;
  at?: string;
}

export interface AiReadinessBlocker {
  code: string;
  message: string;
  primaryActionLabel: string;
  href?: string;
}

export interface AiReadinessDomain {
  id: AiReadinessDomainId;
  label: string;
  state: ReadinessState;
  summary: string;
  evidence: AiReadinessEvidence[];
  blocker?: AiReadinessBlocker;
  diagnosticsHref: string;
}

export interface AiReadinessSummary {
  state: Exclude<ReadinessState, "diagnostic">;
  summary: string;
  generatedAt: string;
  domains: AiReadinessDomain[];
}

export interface AiReadinessProviderInput {
  providerId: string;
  name: string;
  eligibility: RoutingEligibility;
  supportsToolUse?: boolean;
}

export interface AiReadinessBuildExecutionInput {
  selectedEngineId: string;
  selectedEngineLabel: string;
  selectedEnginePresent: boolean | null;
  readyEngineCount: number;
  fallbackEngineLabel: string | null;
}

export function summarizeAiReadinessState(
  domains: AiReadinessDomain[],
): AiReadinessSummary["state"] {
  if (domains.some((domain) => domain.state === "blocked")) {
    return "blocked";
  }
  if (domains.some((domain) => domain.state === "attention")) {
    return "attention";
  }
  return "ready";
}

export function projectModelSupplyDomain(
  providers: AiReadinessProviderInput[],
): AiReadinessDomain {
  const routable = providers.filter((provider) => provider.eligibility.eligible);
  const nonToolRoutable = routable.filter((provider) => provider.supportsToolUse === false);

  if (providers.length === 0) {
    return {
      id: "model-supply",
      label: "Model Supply",
      state: "blocked",
      summary: "No AI model providers are configured.",
      evidence: [{ label: "Providers", value: "0 configured" }],
      blocker: {
        code: "no-model-providers",
        message: "DPF cannot route model work until at least one provider is connected.",
        primaryActionLabel: "Connect provider",
        href: "/platform/ai/providers",
      },
      diagnosticsHref: "/platform/ai/providers",
    };
  }

  if (routable.length > 0) {
    const providerLabel = providers.length === 1 ? "provider" : "providers";
    return {
      id: "model-supply",
      label: "Model Supply",
      state: "ready",
      summary: `${routable.length} routable of ${providers.length} ${providerLabel}.`,
      evidence: [
        { label: "Routable", value: String(routable.length) },
        { label: "Registered", value: String(providers.length) },
        ...(nonToolRoutable.length > 0
          ? [
              {
                label: "Model supply",
                value: `${nonToolRoutable.length} routable non-tool provider(s) stay out of build-engine selection.`,
              },
            ]
          : []),
      ],
      diagnosticsHref: "/platform/ai/providers",
    };
  }

  const firstActionable = providers.find((provider) =>
    ["needs_credentials", "no_models", "unconfigured", "disabled"].includes(
      provider.eligibility.state,
    ),
  );
  return {
    id: "model-supply",
    label: "Model Supply",
    state: "attention",
    summary: `${providers.length} provider${providers.length === 1 ? "" : "s"} registered, none routable yet.`,
    evidence: providers.slice(0, 3).map((provider) => ({
      label: provider.name,
      value: provider.eligibility.label,
    })),
    blocker: firstActionable
      ? {
          code: firstActionable.eligibility.state,
          message: firstActionable.eligibility.reason,
          primaryActionLabel: "Open providers",
          href: "/platform/ai/providers",
        }
      : undefined,
    diagnosticsHref: "/platform/ai/providers",
  };
}

export function projectBuildExecutionDomain(
  input: AiReadinessBuildExecutionInput,
): AiReadinessDomain {
  const evidence = [
    { label: "Selected engine", value: input.selectedEngineLabel },
    { label: "Ready engines", value: String(input.readyEngineCount) },
  ];

  if (input.selectedEnginePresent === true) {
    return {
      id: "build-execution",
      label: "Build Execution",
      state: "ready",
      summary: `${input.selectedEngineLabel} ready for Build Studio work.`,
      evidence,
      diagnosticsHref: "/platform/ai/build-studio",
    };
  }

  if (input.selectedEnginePresent === false && input.readyEngineCount === 0) {
    return {
      id: "build-execution",
      label: "Build Execution",
      state: "blocked",
      summary: `${input.selectedEngineLabel} is unavailable and no fallback engine is ready.`,
      evidence,
      blocker: {
        code: "build-engine-unavailable",
        message:
          "The selected Build Studio execution engine is not available, and no ready fallback was found.",
        primaryActionLabel: "Review execution policy",
        href: "/platform/ai/build-studio",
      },
      diagnosticsHref: "/platform/ai/build-studio",
    };
  }

  const fallbackCopy = input.fallbackEngineLabel
    ? ` ${input.fallbackEngineLabel} fallback can be used.`
    : " Probe the selected engine or choose a ready fallback.";
  return {
    id: "build-execution",
    label: "Build Execution",
    state: "attention",
    summary: `${input.selectedEngineLabel} readiness is not fully proven.${fallbackCopy}`,
    evidence,
    blocker: {
      code: input.selectedEnginePresent === null ? "build-engine-unprobed" : "build-engine-fallback",
      message: fallbackCopy.trim(),
      primaryActionLabel: "Review execution policy",
      href: "/platform/ai/build-studio",
    },
    diagnosticsHref: "/platform/ai/build-studio",
  };
}

function mcpActionLabel(action: ContributorMcpReadiness["recommendedAction"]): string {
  switch (action) {
    case "issue_development_token":
      return "Issue development token";
    case "rotate_development_token":
      return "Rotate development token";
    case "test_connection":
      return "Test connection";
    case "none":
      return "Review token details";
  }
}

export function projectToolAccessDomain(
  readiness: ContributorMcpReadiness,
): AiReadinessDomain {
  const evidence = [
    { label: "Required grants", value: String(readiness.requiredGrants.length) },
    { label: "Missing grants", value: String(readiness.missingGrants.length) },
  ];

  if (readiness.status === "ready") {
    return {
      id: "tool-access",
      label: "Tool Access",
      state: "ready",
      summary: "MCP token ready for contributor and Build Studio tool access.",
      evidence,
      diagnosticsHref: "/admin/platform-development",
    };
  }

  if (readiness.status === "needs_identity_binding") {
    return {
      id: "tool-access",
      label: "Tool Access",
      state: "attention",
      summary: "MCP token grants are present, but identity binding is not fully projected.",
      evidence,
      diagnosticsHref: "/admin/platform-development",
    };
  }

  return {
    id: "tool-access",
    label: "Tool Access",
    state: "blocked",
    summary:
      readiness.status === "needs_grants"
        ? `MCP token is missing ${readiness.missingGrants.length} required grant(s).`
        : "No usable MCP development token is available.",
    evidence,
    blocker: {
      code: readiness.status,
      message:
        readiness.status === "needs_grants"
          ? readiness.missingGrants.join(", ")
          : "Issue or refresh a governed development token before agents use DPF tools.",
      primaryActionLabel: mcpActionLabel(readiness.recommendedAction),
      href: "/admin/platform-development",
    },
    diagnosticsHref: "/admin/platform-development",
  };
}

export function projectRoutingConfidenceDomain(
  overview: ModelSelectionOverview,
): AiReadinessDomain {
  const errors = overview.flags.filter((flag) => flag.severity === "error");
  const warnings = overview.flags.filter((flag) => flag.severity === "warning");
  const infos = overview.flags.filter((flag) => flag.severity === "info");
  const evidence = [
    { label: "Build engine", value: overview.buildEngineLabel },
    { label: "Phase flags", value: String(overview.flags.length), at: overview.generatedAt },
  ];

  if (errors.length > 0) {
    const first = errors[0]!;
    return {
      id: "routing-confidence",
      label: "Routing Confidence",
      state: "blocked",
      summary: `${errors.length} routing blocker${errors.length === 1 ? "" : "s"} found in phase preview.`,
      evidence,
      blocker: {
        code: first.code,
        message: first.message,
        primaryActionLabel: "Open runtime diagnostics",
        href: "/platform/ai/runtime-health",
      },
      diagnosticsHref: "/platform/ai/runtime-health",
    };
  }

  const advisoryCount = warnings.length + infos.length;
  if (advisoryCount > 0) {
    return {
      id: "routing-confidence",
      label: "Routing Confidence",
      state: "attention",
      summary: `${advisoryCount} routing warning${advisoryCount === 1 ? "" : "s"} from phase preview.`,
      evidence,
      diagnosticsHref: "/platform/ai/runtime-health",
    };
  }

  return {
    id: "routing-confidence",
    label: "Routing Confidence",
    state: "ready",
    summary: `Phase preview passes. ${overview.summary}`,
    evidence,
    diagnosticsHref: "/platform/ai/runtime-health",
  };
}

export function composeAiReadinessSummary(args: {
  domains: AiReadinessDomain[];
  generatedAt: string;
}): AiReadinessSummary {
  const state = summarizeAiReadinessState(args.domains);
  const blocked = args.domains.filter((domain) => domain.state === "blocked").length;
  const attention = args.domains.filter((domain) => domain.state === "attention").length;
  let summary: string;
  if (state === "blocked") {
    summary = `AI readiness is blocked by ${blocked} domain${blocked === 1 ? "" : "s"}.`;
  } else if (state === "attention") {
    summary = `AI readiness needs attention in ${attention} domain${attention === 1 ? "" : "s"}.`;
  } else {
    summary = "AI is ready for governed work.";
  }
  return {
    state,
    summary,
    generatedAt: args.generatedAt,
    domains: args.domains,
  };
}

function unauthenticatedMcpReadiness(): ContributorMcpReadiness {
  const requiredGrants = [...CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS];
  return {
    status: "needs_authorization",
    recommendedAction: "issue_development_token",
    identityBinding: "not_available",
    token: null,
    missingGrants: [...requiredGrants],
    requiredGrants,
    recommendedScopes: [...(getMcpTokenTemplate("development")?.grants ?? requiredGrants)],
    probe: { status: "not_run" },
  };
}

function poolResetHint(pool: CliPoolState): string | null {
  const seconds = pool.secondsUntilReset;
  if (seconds == null) return null;
  if (seconds <= 0) return "any moment";
  if (seconds < 60) return `in ~${seconds}s`;
  return `in ~${Math.ceil(seconds / 60)}min`;
}

function supportsToolUseFromScore(toolFidelity: number | null | undefined): boolean | undefined {
  if (toolFidelity == null) return undefined;
  return toolFidelity > 0;
}

async function loadModelSupplyProviders(): Promise<AiReadinessProviderInput[]> {
  const [providers, modelSummaries, cliPoolStatuses] = await Promise.all([
    getProviders(),
    getProviderModelSummaries(),
    getAllCliPoolStatuses(),
  ]);
  const cliPoolByAdapter = new Map(cliPoolStatuses.map((pool) => [pool.adapterType, pool] as const));
  const nowMs = Date.now();

  return providers
    .filter((row) => row.provider.endpointType !== "service")
    .map((row) => {
      const provider = row.provider;
      const adapterType = cliAdapterTypeForProvider(provider.providerId);
      const pool = adapterType ? cliPoolByAdapter.get(adapterType) : undefined;
      const summary = modelSummaries.get(provider.providerId);
      const credentialExpired =
        !!row.credential?.tokenExpiresAt &&
        new Date(row.credential.tokenExpiresAt).getTime() < nowMs;
      return {
        providerId: provider.providerId,
        name: provider.name,
        supportsToolUse: supportsToolUseFromScore(summary?.routingScores?.toolFidelity),
        eligibility: deriveRoutingEligibility({
          status: provider.status,
          endpointType: provider.endpointType,
          category: provider.category,
          serviceKind: provider.serviceKind ?? null,
          authMethod: provider.authMethod,
          hasCredential: !!row.credential,
          credentialExpired,
          discoveredModelCount: summary?.totalModels ?? 0,
          cliPoolExhausted: pool?.isExhausted ?? false,
          cliPoolResetHint: pool ? poolResetHint(pool) : null,
        }),
      };
    });
}

async function loadBuildExecutionInput(): Promise<AiReadinessBuildExecutionInput> {
  const [config, engineRows] = await Promise.all([
    getBuildStudioConfig(),
    prisma.buildEngine.findMany({
      select: {
        engineId: true,
        state: { select: { present: true } },
      },
    }),
  ]);
  const selectedEngineId = config.provider;
  const readyEngines = engineRows.filter((engine) => engine.state?.present === true);
  const selected = engineRows.find((engine) => engine.engineId === selectedEngineId);
  const fallback = readyEngines.find((engine) => engine.engineId !== selectedEngineId);
  return {
    selectedEngineId,
    selectedEngineLabel: buildEngineLabel(selectedEngineId),
    selectedEnginePresent:
      selectedEngineId === "agentic"
        ? true
        : selected
          ? selected.state?.present ?? null
          : null,
    readyEngineCount: readyEngines.length + (selectedEngineId === "agentic" ? 1 : 0),
    fallbackEngineLabel: fallback
      ? buildEngineLabel(fallback.engineId as typeof selectedEngineId)
      : null,
  };
}

export async function getAiReadinessSummary(userId?: string): Promise<AiReadinessSummary> {
  const [providers, buildExecution, mcpReadiness, routingConfidence] = await Promise.all([
    loadModelSupplyProviders(),
    loadBuildExecutionInput(),
    userId ? getContributorMcpReadiness(userId, { probe: false }) : unauthenticatedMcpReadiness(),
    resolveModelSelectionByPhase(),
  ]);

  return composeAiReadinessSummary({
    generatedAt: new Date().toISOString(),
    domains: [
      projectModelSupplyDomain(providers),
      projectBuildExecutionDomain(buildExecution),
      projectToolAccessDomain(mcpReadiness),
      projectRoutingConfidenceDomain(routingConfidence),
    ],
  });
}
