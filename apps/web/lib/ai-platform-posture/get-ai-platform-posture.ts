// apps/web/lib/ai-platform-posture/get-ai-platform-posture.ts
//
// BI-5903D447 — the scheduled task that refreshes AI platform posture
// knowledge articles needs one authoritative, real-time read of AI-layer
// state: provider status/config, ModelProfile tiers/capabilities/toolFidelity,
// token spend per provider and per agent, failover-chain integrity,
// agent-to-provider assignment, and scheduled-task status.
// mcp__dpf__list_all_capability_needs and mcp__dpf__search_tool_marketplace
// only surface partial/derived capability-needs feedback — this reads the
// authoritative Prisma tables directly so posture articles are grounded in
// real data rather than inference.
//
// Read-only aggregation. No mutation of ModelProvider / ModelProfile /
// ScheduledAgentTask / ScheduledJob / RouteDecisionLog / RouteOutcome.
//
// Reuses the existing per-domain readers rather than re-deriving:
//   - getTokenSpendByProvider / getTokenSpendByAgent (apps/web/lib/inference/
//     ai-provider-data.ts) already groupBy TokenUsage by providerId/agentId —
//     the token-spend section delegates to them verbatim.
//   - providerFromEndpoint (apps/web/lib/ai-operations-map/projection-helpers.ts)
//     already knows how to recover a providerId out of a `provider:model`
//     selectedEndpointId — used to resolve agent-to-provider assignment.
// Providers, model profiles, failover-chain integrity, and scheduled-task
// status have no existing single-purpose reader (confirmed by grep before
// writing this), so those sections run their own scoped, secret-free selects.

import { prisma } from "@dpf/db";
import { getTokenSpendByProvider, getTokenSpendByAgent } from "@/lib/inference/ai-provider-data";
import { providerFromEndpoint } from "@/lib/ai-operations-map/projection-helpers";

export type AiPlatformPostureOptions = {
  /** Lookback window, in hours, for the failover-chain and agent-assignment signals. Default 24, max 168 (7 days). */
  windowHours?: number;
  /** Include retired providers/models in the result. Default false. */
  includeRetired?: boolean;
};

export type AiPlatformPostureProvider = {
  providerId: string;
  name: string;
  status: string;
  category: string;
  capabilityTier: string;
  costBand: string;
  cliEngine: string | null;
  endpointType: string;
  avgLatencyMs: number | null;
  recentFailureRate: number;
  maxConcurrency: number | null;
  toolFidelity: number;
  reasoning: number;
  codegen: number;
  retiredAt: string | null;
};

export type AiPlatformPostureModel = {
  providerId: string;
  modelId: string;
  friendlyName: string;
  capabilityCategory: string;
  costTier: string;
  qualityTier: string | null;
  modelStatus: string;
  toolFidelity: number;
  evalCount: number;
  lastEvalAt: string | null;
  stabilityScore: number | null;
  retiredAt: string | null;
};

export type AiPlatformPostureSpend = {
  period: { year: number; month: number };
  byProvider: Array<{ providerId: string; providerName: string; inputTokens: number; outputTokens: number; costUsd: number }>;
  byAgent: Array<{ agentId: string; agentName: string; inputTokens: number; outputTokens: number; costUsd: number }>;
};

export type AiPlatformPostureFailover = {
  windowStart: string;
  windowEnd: string;
  decisionCount: number;
  fallbacksUsedCount: number;
  fallbackRate: number;
  outcomeCount: number;
  outcomeFallbackCount: number;
  outcomeFallbackRate: number;
  distinctProviderErrorCodes: string[];
  recentFallbackChains: Array<{ agentId: string | null; taskType: string; chain: string[]; occurredAt: string }>;
};

export type AiPlatformPostureAssignment = {
  agentId: string;
  currentProviderId: string;
  currentModelId: string | null;
  decisionCount: number;
  lastDecisionAt: string;
};

export type AiPlatformPostureScheduledTasks = {
  agentTasks: Array<{
    taskId: string;
    agentId: string;
    title: string;
    isActive: boolean;
    nextRunAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
  }>;
  jobs: Array<{
    jobId: string;
    name: string;
    schedule: string;
    enabled: boolean;
    nextRunAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
  }>;
  counts: { activeAgentTasks: number; failingAgentTasks: number; enabledJobs: number; failingJobs: number };
};

export type AiPlatformPosture = {
  generatedAt: string;
  windowHours: number;
  providers: AiPlatformPostureProvider[];
  modelProfiles: AiPlatformPostureModel[];
  tokenSpend: AiPlatformPostureSpend;
  failoverChain: AiPlatformPostureFailover;
  agentProviderAssignments: AiPlatformPostureAssignment[];
  scheduledTasks: AiPlatformPostureScheduledTasks;
};

const ROUTE_ROW_LIMIT = 500;
const RECENT_FALLBACK_CHAIN_SAMPLE = 10;
const MAX_WINDOW_HOURS = 168;

export async function loadAiPlatformPosture(
  options?: AiPlatformPostureOptions,
): Promise<AiPlatformPosture> {
  const requestedHours = options?.windowHours;
  const windowHours =
    typeof requestedHours === "number" && requestedHours > 0
      ? Math.min(requestedHours, MAX_WINDOW_HOURS)
      : 24;
  const includeRetired = options?.includeRetired ?? false;

  const now = new Date();
  const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const createdAtWindow = { createdAt: { gte: windowStart, lte: now } };
  const spendPeriod = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };

  const [
    providerRows,
    modelProfileRows,
    spendByProvider,
    spendByAgent,
    routeDecisions,
    routeOutcomes,
    scheduledAgentTasks,
    scheduledJobs,
  ] = await Promise.all([
    prisma.modelProvider.findMany({
      where: includeRetired ? {} : { retiredAt: null },
      orderBy: { name: "asc" },
      select: {
        providerId: true,
        name: true,
        status: true,
        category: true,
        capabilityTier: true,
        costBand: true,
        cliEngine: true,
        endpointType: true,
        avgLatencyMs: true,
        recentFailureRate: true,
        maxConcurrency: true,
        toolFidelity: true,
        reasoning: true,
        codegen: true,
        retiredAt: true,
      },
    }),
    prisma.modelProfile.findMany({
      where: includeRetired ? {} : { retiredAt: null },
      orderBy: [{ providerId: "asc" }, { modelId: "asc" }],
      select: {
        providerId: true,
        modelId: true,
        friendlyName: true,
        capabilityCategory: true,
        costTier: true,
        qualityTier: true,
        modelStatus: true,
        toolFidelity: true,
        evalCount: true,
        lastEvalAt: true,
        stabilityScore: true,
        retiredAt: true,
      },
    }),
    getTokenSpendByProvider(spendPeriod),
    getTokenSpendByAgent(spendPeriod),
    prisma.routeDecisionLog.findMany({
      where: createdAtWindow,
      orderBy: { createdAt: "desc" },
      take: ROUTE_ROW_LIMIT,
      select: {
        agentId: true,
        selectedEndpointId: true,
        selectedModelId: true,
        taskType: true,
        fallbackChain: true,
        fallbacksUsed: true,
        createdAt: true,
      },
    }),
    prisma.routeOutcome.findMany({
      where: createdAtWindow,
      select: { fallbackOccurred: true, providerErrorCode: true },
    }),
    prisma.scheduledAgentTask.findMany({
      orderBy: { nextRunAt: "asc" },
      select: {
        taskId: true,
        agentId: true,
        title: true,
        isActive: true,
        nextRunAt: true,
        lastStatus: true,
        lastError: true,
      },
    }),
    prisma.scheduledJob.findMany({
      orderBy: { nextRunAt: "asc" },
      select: {
        jobId: true,
        name: true,
        schedule: true,
        enabled: true,
        nextRunAt: true,
        lastStatus: true,
        lastError: true,
      },
    }),
  ]);

  // ── Providers ────────────────────────────────────────────────────────────
  const providers: AiPlatformPostureProvider[] = providerRows.map((p) => ({
    providerId: p.providerId,
    name: p.name,
    status: p.status,
    category: p.category,
    capabilityTier: p.capabilityTier,
    costBand: p.costBand,
    cliEngine: p.cliEngine,
    endpointType: p.endpointType,
    avgLatencyMs: p.avgLatencyMs,
    recentFailureRate: p.recentFailureRate,
    maxConcurrency: p.maxConcurrency,
    toolFidelity: p.toolFidelity,
    reasoning: p.reasoning,
    codegen: p.codegen,
    retiredAt: p.retiredAt?.toISOString() ?? null,
  }));

  // ── Model profiles ──────────────────────────────────────────────────────
  const modelProfiles: AiPlatformPostureModel[] = modelProfileRows.map((m) => ({
    providerId: m.providerId,
    modelId: m.modelId,
    friendlyName: m.friendlyName,
    capabilityCategory: m.capabilityCategory,
    costTier: m.costTier,
    qualityTier: m.qualityTier,
    modelStatus: m.modelStatus,
    toolFidelity: m.toolFidelity,
    evalCount: m.evalCount,
    lastEvalAt: m.lastEvalAt?.toISOString() ?? null,
    stabilityScore: m.stabilityScore,
    retiredAt: m.retiredAt?.toISOString() ?? null,
  }));

  // ── Token spend (current calendar month; reuses the existing groupBy readers) ──
  const tokenSpend: AiPlatformPostureSpend = {
    period: spendPeriod,
    byProvider: spendByProvider.map((r) => ({
      providerId: r.providerId,
      providerName: r.providerName,
      inputTokens: r.totalInputTokens,
      outputTokens: r.totalOutputTokens,
      costUsd: r.totalCostUsd,
    })),
    byAgent: spendByAgent.map((r) => ({
      agentId: r.agentId,
      agentName: r.agentName,
      inputTokens: r.totalInputTokens,
      outputTokens: r.totalOutputTokens,
      costUsd: r.totalCostUsd,
    })),
  };

  // ── Failover chain integrity ────────────────────────────────────────────
  const fallbacksUsedCount = routeDecisions.filter(
    (d) => Array.isArray(d.fallbacksUsed) ? d.fallbacksUsed.length > 0 : Boolean(d.fallbacksUsed),
  ).length;
  const outcomeFallbackCount = routeOutcomes.filter((o) => o.fallbackOccurred).length;
  const distinctProviderErrorCodes = Array.from(
    new Set(routeOutcomes.map((o) => o.providerErrorCode).filter((code): code is string => Boolean(code))),
  ).sort();
  const recentFallbackChains = routeDecisions
    .filter((d) => d.fallbackChain.length > 0)
    .slice(0, RECENT_FALLBACK_CHAIN_SAMPLE)
    .map((d) => ({
      agentId: d.agentId,
      taskType: d.taskType,
      chain: d.fallbackChain,
      occurredAt: d.createdAt.toISOString(),
    }));

  const failoverChain: AiPlatformPostureFailover = {
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    decisionCount: routeDecisions.length,
    fallbacksUsedCount,
    fallbackRate: routeDecisions.length > 0 ? fallbacksUsedCount / routeDecisions.length : 0,
    outcomeCount: routeOutcomes.length,
    outcomeFallbackCount,
    outcomeFallbackRate: routeOutcomes.length > 0 ? outcomeFallbackCount / routeOutcomes.length : 0,
    distinctProviderErrorCodes,
    recentFallbackChains,
  };

  // ── Agent-to-provider assignment ────────────────────────────────────────
  // No dedicated assignment table exists — derive the de-facto current
  // assignment per agent from the most recent routing decisions in the
  // window: the provider each agent was routed to most often, with the
  // timestamp of its latest decision.
  type Tally = { providerId: string; modelId: string | null; count: number; lastDecisionAt: Date };
  const byAgent = new Map<string, Map<string, Tally>>();
  for (const decision of routeDecisions) {
    const agentId = decision.agentId;
    if (!agentId) continue;
    const providerId = providerFromEndpoint(decision.selectedEndpointId, decision.selectedEndpointId);
    if (!providerId || providerId === "none") continue;
    const perAgent = byAgent.get(agentId) ?? new Map<string, Tally>();
    const existing = perAgent.get(providerId);
    if (existing) {
      existing.count += 1;
      if (decision.createdAt > existing.lastDecisionAt) {
        existing.lastDecisionAt = decision.createdAt;
        existing.modelId = decision.selectedModelId ?? existing.modelId;
      }
    } else {
      perAgent.set(providerId, {
        providerId,
        modelId: decision.selectedModelId ?? null,
        count: 1,
        lastDecisionAt: decision.createdAt,
      });
    }
    byAgent.set(agentId, perAgent);
  }
  const agentProviderAssignments: AiPlatformPostureAssignment[] = Array.from(byAgent.entries())
    .map(([agentId, perAgent]) => {
      const top = Array.from(perAgent.values()).sort((a, b) => b.count - a.count)[0]!;
      return {
        agentId,
        currentProviderId: top.providerId,
        currentModelId: top.modelId,
        decisionCount: top.count,
        lastDecisionAt: top.lastDecisionAt.toISOString(),
      };
    })
    .sort((a, b) => a.agentId.localeCompare(b.agentId));

  // ── Scheduled-task status ───────────────────────────────────────────────
  const agentTasks = scheduledAgentTasks.map((t) => ({
    taskId: t.taskId,
    agentId: t.agentId,
    title: t.title,
    isActive: t.isActive,
    nextRunAt: t.nextRunAt?.toISOString() ?? null,
    lastStatus: t.lastStatus,
    lastError: t.lastError,
  }));
  const jobs = scheduledJobs.map((j) => ({
    jobId: j.jobId,
    name: j.name,
    schedule: j.schedule,
    enabled: j.enabled,
    nextRunAt: j.nextRunAt?.toISOString() ?? null,
    lastStatus: j.lastStatus,
    lastError: j.lastError,
  }));
  const scheduledTasks: AiPlatformPostureScheduledTasks = {
    agentTasks,
    jobs,
    counts: {
      activeAgentTasks: agentTasks.filter((t) => t.isActive).length,
      failingAgentTasks: agentTasks.filter((t) => t.lastStatus === "error").length,
      enabledJobs: jobs.filter((j) => j.enabled).length,
      failingJobs: jobs.filter((j) => j.lastStatus === "error").length,
    },
  };

  return {
    generatedAt: now.toISOString(),
    windowHours,
    providers,
    modelProfiles,
    tokenSpend,
    failoverChain,
    agentProviderAssignments,
    scheduledTasks,
  };
}
