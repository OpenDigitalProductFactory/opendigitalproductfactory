import type {
  OperationsMapRoutingCoworker,
  OperationsMapRoutingLegendItem,
  OperationsMapRoutingMarker,
  OperationsMapRoutingProvider,
  OperationsMapRoutingProviderKind,
  OperationsMapRoutingProviderType,
  OperationsMapRoutingRoute,
  OperationsMapRoutingTimelineMarker,
  OperationsMapRoutingTopology,
} from "./types";
import { A2A_INTERACTION_LEGEND } from "./project-a2a-interactions";

export type RoutingCoworkerSourceRow = {
  agentId: string;
  name: string;
  stationLabel?: string | null;
};

export type RoutingProviderSourceRow = {
  providerId: string;
  name: string;
  status: string;
  category: string | null;
  baseUrl: string | null;
  endpointType: string | null;
  serviceKind: string | null;
  mcpTransport: string | null;
  cliEngine: string | null;
  recentFailureRate: number | null;
};

export type RoutingEndpointProfileSourceRow = {
  endpointId: string;
  providerId: string;
  modelId: string;
  friendlyName: string;
  modelStatus: string;
};

export type RoutingDecisionSourceRow = {
  id: string;
  agentMessageId: string | null;
  actorKind: string | null;
  actorId: string | null;
  agentId: string | null;
  selectedEndpointId: string;
  taskType: string;
  sensitivity: string;
  reason: string;
  fitnessScore: number | null;
  candidateTrace: unknown;
  excludedTrace: unknown;
  policyRulesApplied: string[];
  fallbackChain: string[];
  fallbacksUsed: unknown;
  shadowMode: boolean;
  createdAt: Date;
  selectedModelId: string | null;
};

export type RoutingTokenUsageSourceRow = {
  id: string;
  agentId: string;
  providerId: string;
  contextKey: string;
  inputTokens: number;
  outputTokens: number;
  inferenceMs: number | null;
  costUsd: number;
  createdAt: Date;
};

export type RoutingRouteOutcomeSourceRow = {
  id: string;
  agentId?: string | null;
  providerId: string;
  modelId: string;
  taskType: string;
  fallbackOccurred: boolean;
  providerErrorCode: string | null;
  createdAt: Date;
};

export type RoutingScheduledAgentTaskSourceRow = {
  id: string;
  taskId: string;
  agentId: string;
  title: string;
  routeContext: string;
  isActive: boolean;
  nextRunAt: Date | null;
  lastStatus: string | null;
};

export type RoutingScheduledJobSourceRow = {
  id: string;
  jobId: string;
  name: string;
  nextRunAt: Date | null;
  lastStatus: string | null;
};

export type RoutingTopologyInput = {
  agents: RoutingCoworkerSourceRow[];
  providers: RoutingProviderSourceRow[];
  endpointProfiles: RoutingEndpointProfileSourceRow[];
  routeDecisions: RoutingDecisionSourceRow[];
  tokenUsage: RoutingTokenUsageSourceRow[];
  routeOutcomes?: RoutingRouteOutcomeSourceRow[];
  scheduledAgentTasks: RoutingScheduledAgentTaskSourceRow[];
  scheduledJobs: RoutingScheduledJobSourceRow[];
  now?: Date;
};

type CandidateLike = {
  endpointId?: string;
  providerId?: string;
  modelId?: string;
  excluded?: boolean;
  excludedReason?: string;
};

type FallbackLike = {
  endpointId?: string;
  error?: string;
  timestamp?: string;
};

export const ROUTING_TOPOLOGY_LEGEND: OperationsMapRoutingLegendItem[] = [
  {
    state: "active",
    label: "Selected active route",
    description: "The provider selected by the latest route decision.",
  },
  {
    state: "secondary",
    label: "Normal secondary traffic",
    description: "A healthy provider considered or used for adjacent traffic.",
  },
  {
    state: "failover",
    label: "Failover or degraded route",
    description: "A provider path involved in fallback, error, or degraded operation.",
  },
  {
    state: "scheduled",
    label: "Scheduled or forecast route",
    description: "A future coworker task or timed event likely to trigger provider routing when it runs.",
  },
  {
    state: "historical",
    label: "Historical route",
    description: "A past route shown in replay context.",
  },
];

export function projectRoutingTopology(input: RoutingTopologyInput): OperationsMapRoutingTopology {
  const sourceCoworkerById = new Map(input.agents.map((agent) => [agent.agentId, agent]));
  const coworkers: OperationsMapRoutingCoworker[] = [];
  const coworkerById = new Map(coworkers.map((coworker) => [coworker.agentId, coworker]));
  const providerSourceById = new Map(input.providers.map((provider) => [provider.providerId, provider]));
  const endpointProfileById = new Map(input.endpointProfiles.map((profile) => [profile.endpointId, profile]));
  const providerIds = new Set<string>(
    input.providers
      .filter(isConfiguredProviderSource)
      .map((provider) => provider.providerId),
  );
  const providerStats = summarizeProviderUsage(input.tokenUsage);
  const decisionCounts = new Map<string, number>();
  const routes: OperationsMapRoutingRoute[] = [];
  const markers: OperationsMapRoutingMarker[] = [];
  const timeline: OperationsMapRoutingTimelineMarker[] = [];

  for (const decision of input.routeDecisions) {
    const candidates = parseCandidates(decision.candidateTrace);
    const excludedCandidates = [
      ...parseCandidates(decision.excludedTrace),
      ...candidates.filter((candidate) => candidate.excluded),
    ];
    const selectedProviderId = resolveProviderId(decision.selectedEndpointId, candidates, providerIds, endpointProfileById);
    const coworkerId = resolveDecisionCoworkerId(decision, sourceCoworkerById);
    const selectedProviderVisible = ensureProvider(providerIds, providerSourceById, selectedProviderId);
    const selectedRouteId = coworkerId && selectedProviderVisible ? `route:${decision.id}:${selectedProviderId}` : null;

    if (coworkerId) ensureCoworker(coworkers, coworkerById, coworkerId, sourceCoworkerById);
    for (const candidate of candidates) {
      const candidateProviderId = candidate.providerId
        ?? resolveProviderId(candidate.endpointId ?? candidate.modelId ?? "", candidates, providerIds, endpointProfileById);
      ensureProvider(providerIds, providerSourceById, candidateProviderId);
    }
    if (selectedProviderVisible) increment(decisionCounts, selectedProviderId);

    const decisionMarkerId = `marker:${decision.id}:decision`;
    const routeMarkerIds = [decisionMarkerId];

    markers.push({
      id: decisionMarkerId,
      type: "decision",
      label: decisionMarkerLabel(decision, coworkerId),
      summary: decisionMarkerSummary(decision, coworkerId),
      routeId: selectedRouteId,
      coworkerId,
      actorKind: decision.actorKind,
      actorId: decision.actorId,
      providerId: selectedProviderVisible ? selectedProviderId : null,
      occurredAt: decision.createdAt.toISOString(),
    });

    if (isGovernedSensitivity(decision.sensitivity) || decision.policyRulesApplied.length > 0) {
      const governanceMarkerId = `marker:${decision.id}:governance`;
      routeMarkerIds.push(governanceMarkerId);
      markers.push({
        id: governanceMarkerId,
        type: "governance",
        label: `${capitalize(decision.sensitivity)} route`,
        summary: decision.policyRulesApplied.length > 0
          ? `Policy rules applied: ${decision.policyRulesApplied.join(", ")}`
          : `Sensitivity boundary: ${decision.sensitivity}`,
        routeId: selectedRouteId,
        coworkerId,
        actorKind: decision.actorKind,
        actorId: decision.actorId,
        providerId: selectedProviderVisible ? selectedProviderId : null,
        occurredAt: decision.createdAt.toISOString(),
      });
    }

    if (selectedRouteId && coworkerId) {
      routes.push({
        id: selectedRouteId,
        coworkerId,
        providerId: selectedProviderId,
        state: "active",
        label: `${coworkerById.get(coworkerId)?.label ?? coworkerId} to ${providerLabel(selectedProviderId, providerSourceById)}`,
        summary: decision.selectedModelId
          ? `${decision.taskType} routed to ${decision.selectedModelId}`
          : `${decision.taskType} routed to ${decision.selectedEndpointId}`,
        occurredAt: decision.createdAt.toISOString(),
        decisionId: decision.id,
        trafficWeight: Math.max(1, Math.round((decision.fitnessScore ?? 0.5) * 4)),
        markerIds: routeMarkerIds,
      });
    }

    timeline.push({
      id: `timeline:${decision.id}`,
      lane: "history",
      label: decision.taskType,
      occurredAt: decision.createdAt.toISOString(),
      markerType: "decision",
    });

    for (const fallback of parseFallbacks(decision.fallbacksUsed)) {
      const fallbackProviderId = resolveProviderId(fallback.endpointId ?? "", candidates, providerIds, endpointProfileById);
      const fallbackRouteId = `route:${decision.id}:fallback:${fallbackProviderId}`;
      const fallbackProviderVisible = ensureProvider(providerIds, providerSourceById, fallbackProviderId);
      if (!fallbackProviderVisible) continue;
      if (coworkerId) {
        routes.push({
          id: fallbackRouteId,
          coworkerId,
          providerId: fallbackProviderId,
          state: "failover",
          label: `${coworkerById.get(coworkerId)?.label ?? coworkerId} failover via ${providerLabel(fallbackProviderId, providerSourceById)}`,
          summary: fallback.error ?? "Fallback route used",
          occurredAt: fallback.timestamp ?? decision.createdAt.toISOString(),
          decisionId: decision.id,
          trafficWeight: 1,
          markerIds: [`marker:${decision.id}:error:${fallbackProviderId}`],
        });
      }
      markers.push({
        id: `marker:${decision.id}:error:${fallbackProviderId}`,
        type: "error",
        label: "Error / outage",
        summary: fallback.error ?? "Provider fallback recorded",
        routeId: coworkerId ? fallbackRouteId : null,
        coworkerId,
        actorKind: decision.actorKind,
        actorId: decision.actorId,
        providerId: fallbackProviderId,
        occurredAt: fallback.timestamp ?? decision.createdAt.toISOString(),
      });
    }

    for (const candidate of excludedCandidates) {
      if (!candidate.excludedReason || !isQuotaReason(candidate.excludedReason)) continue;
      const quotaProviderId = candidate.providerId
        ?? resolveProviderId(candidate.endpointId ?? "", candidates, providerIds, endpointProfileById);
      const quotaProviderVisible = ensureProvider(providerIds, providerSourceById, quotaProviderId);
      if (!quotaProviderVisible) continue;
      markers.push({
        id: `marker:${decision.id}:quota:${quotaProviderId}`,
        type: "quota",
        label: "Limit / quota",
        summary: candidate.excludedReason,
        routeId: null,
        coworkerId,
        actorKind: decision.actorKind,
        actorId: decision.actorId,
        providerId: quotaProviderId,
        occurredAt: decision.createdAt.toISOString(),
      });
    }
  }

  for (const usage of input.tokenUsage) {
    const coworkerId = resolveUsageCoworkerId(usage.agentId);
    const providerVisible = ensureProvider(providerIds, providerSourceById, usage.providerId);
    if (!coworkerId || !providerVisible) continue;

    ensureCoworker(coworkers, coworkerById, coworkerId, sourceCoworkerById);
    const routeId = `route:usage:${usage.id}`;
    const markerId = `marker:usage:${usage.id}:spend`;
    const tokenTotal = usage.inputTokens + usage.outputTokens;

    routes.push({
      id: routeId,
      coworkerId,
      providerId: usage.providerId,
      state: "secondary",
      label: `${coworkerById.get(coworkerId)?.label ?? coworkerId} used ${providerLabel(usage.providerId, providerSourceById)}`,
      summary: `${usage.contextKey || "Recent workload"} used ${formatTokenCount(tokenTotal)} tokens${usage.costUsd > 0 ? ` at ${formatCurrency(usage.costUsd)}` : ""}.`,
      occurredAt: usage.createdAt.toISOString(),
      decisionId: null,
      trafficWeight: usageTrafficWeight(tokenTotal),
      markerIds: [markerId],
    });

    markers.push({
      id: markerId,
      type: "quota",
      label: "Token spend",
      summary: `${coworkerById.get(coworkerId)?.label ?? coworkerId} consumed ${formatTokenCount(tokenTotal)} tokens through ${providerLabel(usage.providerId, providerSourceById)}.`,
      routeId,
      coworkerId,
      providerId: usage.providerId,
      occurredAt: usage.createdAt.toISOString(),
    });

    timeline.push({
      id: `timeline:usage:${usage.id}`,
      lane: "history",
      label: `${coworkerById.get(coworkerId)?.label ?? coworkerId} usage`,
      occurredAt: usage.createdAt.toISOString(),
      markerType: "quota",
    });
  }

  for (const outcome of input.routeOutcomes ?? []) {
    if (!outcome.providerErrorCode && !outcome.fallbackOccurred) continue;
    const providerVisible = ensureProvider(providerIds, providerSourceById, outcome.providerId);
    if (!providerVisible) continue;

    const markerType = outcome.providerErrorCode ? "error" : "failover";
    const markerLabel = outcome.providerErrorCode ? "Provider error" : "Fallback destination";
    const providerName = providerLabel(outcome.providerId, providerSourceById);
    const outcomeCoworkerId = resolveUsageCoworkerId(outcome.agentId ?? "");
    const outcomeRouteId = outcomeCoworkerId ? `route:outcome:${outcome.id}:${outcome.providerId}` : null;
    const outcomeSummary = outcome.providerErrorCode
      ? `${providerName} reported ${outcome.providerErrorCode} while serving ${outcome.taskType} on ${outcome.modelId}.`
      : `${providerName} accepted fallback traffic for ${outcome.taskType} on ${outcome.modelId}.`;

    if (outcomeCoworkerId) {
      ensureCoworker(coworkers, coworkerById, outcomeCoworkerId, sourceCoworkerById);
      routes.push({
        id: outcomeRouteId!,
        coworkerId: outcomeCoworkerId,
        providerId: outcome.providerId,
        state: "failover",
        label: outcome.providerErrorCode
          ? `${coworkerById.get(outcomeCoworkerId)?.label ?? outcomeCoworkerId} provider error at ${providerName}`
          : `${coworkerById.get(outcomeCoworkerId)?.label ?? outcomeCoworkerId} failover via ${providerName}`,
        summary: outcomeSummary,
        occurredAt: outcome.createdAt.toISOString(),
        decisionId: null,
        trafficWeight: 1,
        markerIds: [`marker:outcome:${outcome.id}:${markerType}`],
      });
    }

    markers.push({
      id: `marker:outcome:${outcome.id}:${markerType}`,
      type: markerType,
      label: markerLabel,
      summary: outcomeSummary,
      routeId: outcomeRouteId,
      coworkerId: outcomeCoworkerId,
      providerId: outcome.providerId,
      occurredAt: outcome.createdAt.toISOString(),
    });

    timeline.push({
      id: `timeline:outcome:${outcome.id}`,
      lane: "history",
      label: outcome.providerErrorCode
        ? `${providerName} ${outcome.providerErrorCode}`
        : `${providerName} fallback`,
      occurredAt: outcome.createdAt.toISOString(),
      markerType,
    });
  }

  for (const task of input.scheduledAgentTasks) {
    if (!task.isActive || !task.nextRunAt) continue;
    ensureCoworker(coworkers, coworkerById, task.agentId, sourceCoworkerById);
    const coworkerLabel = coworkerById.get(task.agentId)?.label ?? task.agentId;
    markers.push({
      id: `marker:scheduled:${task.id}`,
      type: "scheduled",
      label: "Scheduled invocation",
      summary: `${task.title} invokes ${coworkerLabel} at ${task.nextRunAt.toISOString()}. Provider routing appears when execution starts.`,
      routeId: null,
      coworkerId: task.agentId,
      providerId: null,
      occurredAt: task.nextRunAt.toISOString(),
    });
    timeline.push({
      id: `timeline:${task.id}`,
      lane: "future",
      label: task.title,
      occurredAt: task.nextRunAt.toISOString(),
      markerType: "scheduled",
    });
  }

  for (const job of input.scheduledJobs) {
    if (!job.nextRunAt) continue;
    timeline.push({
      id: `timeline:${job.id}`,
      lane: "future",
      label: job.name,
      occurredAt: job.nextRunAt.toISOString(),
      markerType: "scheduled",
    });
  }

  const providers = buildProviders(providerIds, providerSourceById, providerStats, decisionCounts);
  addProviderOperationalMarkers(markers, providers);

  return {
    coworkers: sortByLabel(coworkers),
    providers,
    routes,
    // A2A interaction edges are contributed by `projectA2aInteractions` and
    // merged in `load-map-data.ts`. Default to empty here so the topology
    // shape is stable when only provider routing is projected.
    a2aEdges: [],
    markers,
    timeline: timeline.sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt)),
    legend: ROUTING_TOPOLOGY_LEGEND,
    a2aLegend: A2A_INTERACTION_LEGEND,
  };
}

function buildProviders(
  providerIds: Set<string>,
  sourceById: Map<string, RoutingProviderSourceRow>,
  statsById: Map<string, { costUsd: number; tokenTotal: number }>,
  decisionCounts: Map<string, number>,
): OperationsMapRoutingProvider[] {
  return [...providerIds].sort().map((providerId) => {
    const source = sourceById.get(providerId);
    const stats = statsById.get(providerId) ?? { costUsd: 0, tokenTotal: 0 };
    return {
      providerId,
      label: providerLabel(providerId, sourceById),
      status: source?.status ?? "unknown",
      kind: classifyProviderKind(source),
      providerType: classifyProviderType(source),
      costUsd: roundCurrency(stats.costUsd),
      tokenTotal: stats.tokenTotal,
      decisionCount: decisionCounts.get(providerId) ?? 0,
    };
  });
}

function addProviderOperationalMarkers(
  markers: OperationsMapRoutingMarker[],
  providers: OperationsMapRoutingProvider[],
) {
  for (const provider of providers) {
    if (!provider.providerId.trim()) continue;

    if (provider.costUsd > 0 || provider.tokenTotal > 0) {
      markers.push({
        id: `marker:provider:${provider.providerId}:spend`,
        type: "quota",
        label: "Spend watch",
        summary: provider.costUsd > 0
          ? `$${provider.costUsd.toFixed(2)} / ${formatTokenCount(provider.tokenTotal)} tokens in the recent window.`
          : `${formatTokenCount(provider.tokenTotal)} fixed-capacity tokens in the recent window.`,
        routeId: null,
        coworkerId: null,
        providerId: provider.providerId,
        occurredAt: null,
      });
    }

    if (provider.kind === "local") {
      markers.push({
        id: `marker:provider:${provider.providerId}:local`,
        type: "governance",
        label: "Local LLM route",
        summary: "Local provider is available for privacy, latency, or cost-control routing.",
        routeId: null,
        coworkerId: null,
        providerId: provider.providerId,
        occurredAt: null,
      });
    }

    if (provider.kind === "cli") {
      markers.push({
        id: `marker:provider:${provider.providerId}:native`,
        type: "governance",
        label: "Native / CLI route",
        summary: "Provider is reached through a native or CLI engine rather than a plain hosted API.",
        routeId: null,
        coworkerId: null,
        providerId: provider.providerId,
        occurredAt: null,
      });
    }

    if (isProviderAttentionStatus(provider.status)) {
      markers.push({
        id: `marker:provider:${provider.providerId}:status`,
        type: "error",
        label: "Provider status",
        summary: `${provider.label} is ${provider.status}; routing should avoid or fail over from it.`,
        routeId: null,
        coworkerId: null,
        providerId: provider.providerId,
        occurredAt: null,
      });
    }
  }
}

function isProviderAttentionStatus(status: string): boolean {
  return /disabled|unconfigured|error|degraded|inactive|failed|paused/i.test(status);
}

function isConfiguredProviderSource(provider: RoutingProviderSourceRow): boolean {
  const status = provider.status.trim().toLowerCase();
  if (!status) return false;
  return !/^(unconfigured|unknown)$|not[-_\s]?configured/i.test(status);
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

function parseCandidates(value: unknown): CandidateLike[] {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is CandidateLike => Boolean(item) && typeof item === "object");
}

function parseFallbacks(value: unknown): FallbackLike[] {
  const parsed = parseMaybeJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is FallbackLike => Boolean(item) && typeof item === "object");
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return [];
  }
}

function resolveProviderId(
  endpointId: string,
  candidates: CandidateLike[],
  knownProviderIds: Set<string>,
  endpointProfileById: Map<string, RoutingEndpointProfileSourceRow>,
): string {
  const endpointProfile = endpointProfileById.get(endpointId);
  if (endpointProfile) return endpointProfile.providerId;

  const matched = candidates.find((candidate) => candidate.endpointId === endpointId || candidate.modelId === endpointId);
  if (matched?.providerId) return matched.providerId;

  const prefix = endpointId.split(":")[0]?.trim();
  if (prefix && knownProviderIds.has(prefix)) return prefix;

  return "unrouted";
}

function resolveDecisionCoworkerId(
  decision: RoutingDecisionSourceRow,
  sourceCoworkerById: Map<string, RoutingCoworkerSourceRow>,
): string | null {
  const agentId = decision.agentId?.trim();
  if (agentId) return agentId;

  const messageId = decision.agentMessageId?.trim();
  if (messageId && sourceCoworkerById.has(messageId)) return messageId;

  return null;
}

function decisionMarkerLabel(decision: RoutingDecisionSourceRow, coworkerId: string | null): string {
  if (coworkerId) return "Route decision";
  if (decision.actorKind && decision.actorKind !== "legacy_unattributed" && decision.actorId) {
    return `${capitalize(decision.actorKind)} route decision`;
  }
  return "Unattributed route decision";
}

function decisionMarkerSummary(decision: RoutingDecisionSourceRow, coworkerId: string | null): string {
  if (coworkerId) return decision.reason;
  if (decision.actorKind && decision.actorKind !== "legacy_unattributed" && decision.actorId) {
    return `${decision.reason} Actor: ${decision.actorKind}/${decision.actorId}.`;
  }
  return `${decision.reason} RouteDecisionLog did not record the coworker for this decision, so it is shown as provider-side router audit only.`;
}

function resolveUsageCoworkerId(agentId: string): string | null {
  const normalized = agentId.trim();
  if (!normalized || /^unknown$/i.test(normalized)) return null;
  return normalized;
}

function ensureCoworker(
  coworkers: OperationsMapRoutingCoworker[],
  coworkerById: Map<string, OperationsMapRoutingCoworker>,
  agentId: string,
  sourceCoworkerById: Map<string, RoutingCoworkerSourceRow>,
) {
  if (coworkerById.has(agentId)) return;
  const source = sourceCoworkerById.get(agentId);
  const coworker = {
    agentId,
    label: source?.name ?? titleize(agentId),
    stationLabel: source?.stationLabel ?? null,
  };
  coworkers.push(coworker);
  coworkerById.set(agentId, coworker);
}

function ensureProvider(
  providerIds: Set<string>,
  providerSourceById: Map<string, RoutingProviderSourceRow>,
  providerId: string,
  source?: RoutingProviderSourceRow,
): boolean {
  if (!providerId.trim() || providerId === "unrouted") return false;
  const existingSource = source ?? providerSourceById.get(providerId);
  if (!existingSource || !isConfiguredProviderSource(existingSource)) return false;

  providerIds.add(providerId);
  if (source && !providerSourceById.has(providerId)) providerSourceById.set(providerId, source);
  return true;
}

function summarizeProviderUsage(tokenUsage: RoutingTokenUsageSourceRow[]) {
  const statsById = new Map<string, { costUsd: number; tokenTotal: number }>();
  for (const usage of tokenUsage) {
    const current = statsById.get(usage.providerId) ?? { costUsd: 0, tokenTotal: 0 };
    current.costUsd += usage.costUsd;
    current.tokenTotal += usage.inputTokens + usage.outputTokens;
    statsById.set(usage.providerId, current);
  }
  return statsById;
}

function classifyProviderKind(source: RoutingProviderSourceRow | undefined): OperationsMapRoutingProviderKind {
  if (!source) return "cloud";
  const haystack = `${source.providerId} ${source.name} ${source.category ?? ""} ${source.baseUrl ?? ""} ${source.endpointType ?? ""}`.toLowerCase();
  if (source.cliEngine) return "cli";
  if (haystack.includes("local") || haystack.includes("localhost") || haystack.includes("ollama") || haystack.includes("docker")) {
    return "local";
  }
  return "cloud";
}

function classifyProviderType(source: RoutingProviderSourceRow | undefined): OperationsMapRoutingProviderType {
  if (!source) return "other";
  const haystack = [
    source.providerId,
    source.name,
    source.category ?? "",
    source.endpointType ?? "",
    source.serviceKind ?? "",
    source.mcpTransport ?? "",
  ].join(" ").toLowerCase();

  if (haystack.includes("mcp") || source.endpointType === "service" || source.serviceKind === "mcp") {
    return "mcp";
  }

  if (source.endpointType === "llm" || source.cliEngine) return "llm";

  return "other";
}

function providerLabel(providerId: string, sourceById: Map<string, RoutingProviderSourceRow>): string {
  return sourceById.get(providerId)?.name ?? titleize(providerId);
}

function isGovernedSensitivity(sensitivity: string): boolean {
  return ["confidential", "restricted"].includes(sensitivity.toLowerCase());
}

function isQuotaReason(reason: string): boolean {
  return /quota|limit|rate|spend|budget|subscription|burn|ceiling|use-it|use it|loose it|lose it/i.test(reason);
}

function increment(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatCurrency(value: number): string {
  return `$${roundCurrency(value).toFixed(2)}`;
}

function usageTrafficWeight(tokens: number): number {
  if (tokens >= 100_000) return 5;
  if (tokens >= 25_000) return 4;
  if (tokens >= 5_000) return 3;
  if (tokens >= 500) return 2;
  return 1;
}

function sortByLabel<T extends { label: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.label.localeCompare(right.label));
}

function titleize(value: string): string {
  return value
    .split(/[-_:.\s]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(" ") || "Unknown";
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
