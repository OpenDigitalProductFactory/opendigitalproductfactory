import { prisma } from "@dpf/db";
import { getMapTemplate } from "./templates";
import {
  projectAgentsToStations,
  projectBacklogEvidence,
  projectExternalEvidence,
  projectTaskRun,
  projectToolExecution,
  projectToolExecutionReceipt,
} from "./project-events";
import { projectRoutingTopology } from "./project-routing-topology";
import {
  projectA2aInteractions,
  type A2aDelegationSourceRow,
  type A2aPhaseHandoffSourceRow,
  type A2aTaskLineageSourceRow,
} from "./project-a2a-interactions";
import {
  projectDeliberations,
  type DeliberationSourceRow,
} from "./project-deliberations";
import type {
  OperationsMapRoutingTopology,
  OperationsMapAgent,
  OperationsMapBacklogEvidence,
  OperationsMapExternalEvidence,
  OperationsMapProjection,
  OperationsMapTaskRun,
  OperationsMapTemplate,
  OperationsMapToolExecution,
  OperationsMapToolExecutionReceipt,
  StationedOperationsMapAgent,
} from "./types";

export const RECENT_TOOL_LIMIT = 40;

/**
 * Cap on how many stalled TaskRuns are lifted into the projection set
 * regardless of the recent-40 cutoff. The operator-recovery UI (Retry /
 * Abandon / Escalate) needs every stalled row to be clickable; without
 * this independent fetch, rows that age out of the recent-40 window
 * become orphaned — the server actions still work but no tile renders
 * in any station inspector. See BI-OPS-MAP-STALLED-WINDOW (2026-05-21,
 * surfaced during the F2 cleanup-pass dogfooding).
 *
 * 200 is intentionally generous: stalled is operator-actionable and
 * shouldn't silently drop off; in practice we'd expect well under that
 * once the spawn-loop concurrency issue is fixed.
 */
export const STALLED_TASK_RUN_LIMIT = 200;

export type OperationsMapData = {
  template: OperationsMapTemplate;
  agents: StationedOperationsMapAgent[];
  projections: OperationsMapProjection[];
  routingTopology: OperationsMapRoutingTopology;
  recentWindowLabel: string;
};

export async function loadOperationsMapData(): Promise<OperationsMapData> {
  const [
    storefrontConfig,
    agents,
    recentTaskRuns,
    stalledTaskRuns,
    toolExecutions,
    toolReceipts,
    backlogEvidence,
    externalEvidence,
    routeDecisions,
    providers,
    modelProfiles,
    tokenUsage,
    routeOutcomes,
    scheduledAgentTasks,
    scheduledJobs,
    delegationChains,
    phaseHandoffs,
    a2aTaskRuns,
    deliberationRuns,
  ] = await Promise.all([
    prisma.storefrontConfig.findFirst({
      include: {
        archetype: {
          select: {
            archetypeId: true,
            activationProfile: true,
          },
        },
      },
    }),
    prisma.agent.findMany({
      where: { archived: false },
      orderBy: [{ tier: "asc" }, { name: "asc" }],
      select: {
        id: true,
        agentId: true,
        slugId: true,
        name: true,
        tier: true,
        type: true,
        description: true,
        status: true,
        valueStream: true,
        it4itSections: true,
        sensitivity: true,
        lifecycleStage: true,
        _count: {
          select: {
            skills: true,
            toolGrants: true,
          },
        },
      },
    }),
    prisma.taskRun.findMany({
      where: {
        archivedAt: null,
        source: "proactive",
      },
      orderBy: { startedAt: "desc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        taskRunId: true,
        status: true,
        source: true,
        currentAgentId: true,
        routeContext: true,
        title: true,
        startedAt: true,
        completedAt: true,
      },
    }),
    // BI-OPS-MAP-STALLED-WINDOW (2026-05-21): lift stalled rows into the
    // projection set independently of the recent-40 cap. The operator
    // needs every stalled TaskRun to render as a clickable tile so Retry/
    // Abandon/Escalate stay reachable through the UI. Without this query,
    // stalled rows older than the 40th-most-recent proactive task were
    // silently dropped from the inspector list. We dedupe in app code
    // after merging — a row stalled AND in the recent-40 appears once.
    prisma.taskRun.findMany({
      where: {
        archivedAt: null,
        status: "stalled",
      },
      orderBy: { startedAt: "desc" },
      take: STALLED_TASK_RUN_LIMIT,
      select: {
        id: true,
        taskRunId: true,
        status: true,
        source: true,
        currentAgentId: true,
        routeContext: true,
        title: true,
        startedAt: true,
        completedAt: true,
      },
    }),
    prisma.toolExecution.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        threadId: true,
        agentId: true,
        userId: true,
        toolName: true,
        success: true,
        executionMode: true,
        routeContext: true,
        durationMs: true,
        createdAt: true,
        auditClass: true,
        capabilityId: true,
        summary: true,
      },
    }),
    prisma.toolExecutionReceipt.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        toolExecutionId: true,
        buildId: true,
        receiptKind: true,
        receiptStatus: true,
        executionStatus: true,
        expiresAt: true,
        createdAt: true,
        toolExecution: {
          select: {
            id: true,
            threadId: true,
            agentId: true,
            userId: true,
            toolName: true,
            success: true,
            executionMode: true,
            routeContext: true,
            durationMs: true,
            createdAt: true,
            auditClass: true,
            capabilityId: true,
            summary: true,
          },
        },
      },
    }),
    prisma.backlogItemActivity.findMany({
      where: { kind: "evidence" },
      orderBy: { recordedAt: "desc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        backlogItemId: true,
        kind: true,
        summary: true,
        payload: true,
        recordedAt: true,
        recordedById: true,
        recordedByAgentId: true,
        toolExecutionId: true,
        backlogItem: {
          select: {
            itemId: true,
          },
        },
      },
    }),
    prisma.externalEvidenceRecord.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        actorUserId: true,
        routeContext: true,
        operationType: true,
        target: true,
        provider: true,
        resultSummary: true,
        createdAt: true,
      },
    }),
    prisma.routeDecisionLog.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        agentMessageId: true,
        actorKind: true,
        actorId: true,
        agentId: true,
        selectedEndpointId: true,
        taskType: true,
        sensitivity: true,
        reason: true,
        fitnessScore: true,
        candidateTrace: true,
        excludedTrace: true,
        policyRulesApplied: true,
        fallbackChain: true,
        fallbacksUsed: true,
        shadowMode: true,
        createdAt: true,
        selectedModelId: true,
      },
    }),
    prisma.modelProvider.findMany({
      orderBy: { name: "asc" },
      select: {
        providerId: true,
        name: true,
        status: true,
        category: true,
        baseUrl: true,
        endpointType: true,
        serviceKind: true,
        mcpTransport: true,
        cliEngine: true,
        recentFailureRate: true,
      },
    }),
    prisma.modelProfile.findMany({
      select: {
        id: true,
        providerId: true,
        modelId: true,
        friendlyName: true,
        modelStatus: true,
      },
    }),
    prisma.tokenUsage.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        agentId: true,
        providerId: true,
        contextKey: true,
        inputTokens: true,
        outputTokens: true,
        inferenceMs: true,
        costUsd: true,
        createdAt: true,
      },
    }),
    prisma.routeOutcome.findMany({
      where: {
        OR: [
          { providerErrorCode: { not: null } },
          { fallbackOccurred: true },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        agentId: true,
        providerId: true,
        modelId: true,
        taskType: true,
        fallbackOccurred: true,
        providerErrorCode: true,
        createdAt: true,
      },
    }),
    prisma.scheduledAgentTask.findMany({
      where: { isActive: true },
      orderBy: { nextRunAt: "asc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        taskId: true,
        agentId: true,
        title: true,
        routeContext: true,
        isActive: true,
        nextRunAt: true,
        lastStatus: true,
      },
    }),
    prisma.scheduledJob.findMany({
      orderBy: { nextRunAt: "asc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        jobId: true,
        name: true,
        nextRunAt: true,
        lastStatus: true,
      },
    }),
    // ── A2A interaction sources (BI-65B0D697) ──────────────────────────
    // Coworker-to-coworker interactions projected migration-free from
    // existing substrate. DelegationChain + PhaseHandoff carry explicit
    // from/toAgentId; TaskRun lineage carries initiating/current/parent.
    // Deliberation fan-out is deferred until branch-persona identity is
    // captured (TaskNode has no agentId column today) — see Slice 4.
    prisma.delegationChain.findMany({
      orderBy: { startedAt: "desc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        chainId: true,
        depth: true,
        fromAgentId: true,
        toAgentId: true,
        skillId: true,
        authorityScope: true,
        status: true,
        reason: true,
        startedAt: true,
        completedAt: true,
      },
    }),
    prisma.phaseHandoff.findMany({
      orderBy: { createdAt: "desc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        buildId: true,
        fromPhase: true,
        toPhase: true,
        fromAgentId: true,
        toAgentId: true,
        summary: true,
        gateResult: true,
        tokenBudgetUsed: true,
        createdAt: true,
      },
    }),
    prisma.taskRun.findMany({
      where: {
        archivedAt: null,
        OR: [
          { parentTaskRunId: { not: null } },
          {
            AND: [
              { initiatingAgentId: { not: null } },
              { currentAgentId: { not: null } },
            ],
          },
        ],
      },
      orderBy: { startedAt: "desc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        taskRunId: true,
        initiatingAgentId: true,
        currentAgentId: true,
        parentTaskRunId: true,
        title: true,
        objective: true,
        status: true,
        buildId: true,
        startedAt: true,
      },
    }),
    // Deliberation lens (Option B): coordinator-internal fan. Branches are not
    // distinct coworkers, so we render a coordinator-side summary (role + model/
    // provider from each branch's routeDecision) rather than A2A edges. The
    // coordinator is the parent TaskRun's current/initiating agent.
    prisma.deliberationRun.findMany({
      orderBy: { startedAt: "desc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        id: true,
        diversityMode: true,
        consensusState: true,
        startedAt: true,
        taskRun: { select: { currentAgentId: true, initiatingAgentId: true } },
        pattern: { select: { name: true } },
        branchNodes: {
          select: { id: true, workerRole: true, status: true, routeDecision: true },
        },
      },
    }),
  ]);

  const routeDecisionAgentMessageIds = [
    ...new Set(routeDecisions.map((decision) => decision.agentMessageId).filter((id): id is string => Boolean(id))),
  ];
  const routeDecisionAgentMessages = routeDecisionAgentMessageIds.length > 0
    ? await prisma.agentMessage.findMany({
      where: { id: { in: routeDecisionAgentMessageIds } },
      select: {
        id: true,
        agentId: true,
      },
    })
    : [];
  const routeDecisionAgentIdByMessageId = new Map(
    routeDecisionAgentMessages.map((message) => [message.id, message.agentId]),
  );

  const template = getMapTemplate({
    archetypeId: storefrontConfig?.archetype?.archetypeId ?? null,
    activationProfileType: getActivationProfileType(storefrontConfig?.archetype?.activationProfile),
  });

  const mapAgents: OperationsMapAgent[] = agents.map((agent) => ({
    id: agent.id,
    agentId: agent.agentId,
    slugId: agent.slugId,
    name: agent.name,
    tier: agent.tier,
    type: agent.type,
    description: agent.description,
    status: agent.status,
    valueStream: agent.valueStream,
    it4itSections: agent.it4itSections,
    sensitivity: agent.sensitivity,
    lifecycleStage: agent.lifecycleStage,
    counts: {
      skills: agent._count.skills,
      toolGrants: agent._count.toolGrants,
    },
  }));

  // Merge recent + stalled task-runs, deduping by cuid id. A row that is
  // both stalled AND in the recent-40 (typical case) appears once. Order
  // doesn't matter for the projection set — the final sort by occurredAt
  // below handles display order.
  const taskRuns = mergeTaskRunsDedupeById(recentTaskRuns, stalledTaskRuns);

  const projections = [
    ...taskRuns.map((row) => projectTaskRun(row as OperationsMapTaskRun, template)),
    ...toolExecutions.map((row) => projectToolExecution(row as OperationsMapToolExecution, template)),
    ...toolReceipts.map((row) => projectToolExecutionReceipt(row as OperationsMapToolExecutionReceipt, template)),
    ...backlogEvidence.map((row) => projectBacklogEvidence(row as OperationsMapBacklogEvidence, template)),
    ...externalEvidence.map((row) => projectExternalEvidence(row as OperationsMapExternalEvidence, template)),
  ].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));

  const stationedAgents = projectAgentsToStations(mapAgents, template);
  const routingTopology = projectRoutingTopology({
    agents: stationedAgents.map((agent) => ({
      agentId: agent.agentId,
      name: agent.name,
      stationLabel: agent.stationLabel,
    })),
    providers,
    endpointProfiles: modelProfiles.map((profile) => ({
      endpointId: profile.id,
      providerId: profile.providerId,
      modelId: profile.modelId,
      friendlyName: profile.friendlyName,
      modelStatus: profile.modelStatus,
    })),
    routeDecisions: routeDecisions.map((decision) => ({
      ...decision,
      agentId: decision.agentId ?? (decision.agentMessageId ? routeDecisionAgentIdByMessageId.get(decision.agentMessageId) ?? null : null),
    })),
    tokenUsage,
    routeOutcomes,
    scheduledAgentTasks,
    scheduledJobs,
  });

  // ── Compose coworker-to-coworker (A2A) interactions ──────────────────
  // Project A2A edges from existing substrate and merge them into the
  // provider routing topology. Coworker nodes contributed by A2A edges are
  // unioned in so an agent that only ever *received* an interaction still
  // appears. See project-a2a-interactions.ts + BI-65B0D697.
  const a2aTaskRunAgentById = new Map<string, string | null>();
  for (const row of a2aTaskRuns) {
    a2aTaskRunAgentById.set(row.id, row.currentAgentId);
    a2aTaskRunAgentById.set(row.taskRunId, row.currentAgentId);
  }
  const coworkerSourceRows = stationedAgents.map((agent) => ({
    agentId: agent.agentId,
    name: agent.name,
    stationLabel: agent.stationLabel,
  }));
  const a2aProjection = projectA2aInteractions({
    agents: coworkerSourceRows,
    delegationChains: delegationChains.map((row): A2aDelegationSourceRow => ({
      id: row.id,
      chainId: row.chainId,
      depth: row.depth,
      fromAgentId: row.fromAgentId,
      toAgentId: row.toAgentId,
      skillId: row.skillId,
      authorityScope: row.authorityScope,
      status: row.status,
      reason: row.reason,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    })),
    phaseHandoffs: phaseHandoffs.map((row): A2aPhaseHandoffSourceRow => {
      const gate = resolveGateResult(row.gateResult);
      return {
        id: row.id,
        buildId: row.buildId,
        fromPhase: row.fromPhase,
        toPhase: row.toPhase,
        fromAgentId: row.fromAgentId,
        toAgentId: row.toAgentId,
        summary: row.summary,
        gatePassed: gate.passed,
        gateLabel: gate.label ?? `${row.fromPhase} → ${row.toPhase} gate`,
        tokenBudgetUsed: row.tokenBudgetUsed,
        createdAt: row.createdAt,
      };
    }),
    taskLineage: a2aTaskRuns.map((row): A2aTaskLineageSourceRow => ({
      id: row.id,
      taskRunId: row.taskRunId,
      initiatingAgentId: row.initiatingAgentId,
      currentAgentId: row.currentAgentId,
      parentTaskRunId: row.parentTaskRunId,
      parentAgentId: row.parentTaskRunId
        ? a2aTaskRunAgentById.get(row.parentTaskRunId) ?? null
        : null,
      title: row.title,
      objective: row.objective,
      status: row.status,
      buildId: row.buildId,
      startedAt: row.startedAt,
    })),
    // Deliberation fan-out deferred: TaskNode branch personas carry no
    // agentId column yet. Wired once the A2A-capture thread records it.
    deliberations: [],
  });

  const mergedCoworkers = mergeCoworkersById(routingTopology.coworkers, a2aProjection.coworkers);
  const mergedTimeline = [...routingTopology.timeline, ...a2aProjection.timeline].sort(
    (left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
  );

  // Deliberation lens (Option B). Coordinator = parent TaskRun's current/
  // initiating agent; per-branch model/provider recovered from routeDecision.
  const deliberations = projectDeliberations({
    agents: coworkerSourceRows,
    deliberations: deliberationRuns.map((run): DeliberationSourceRow => ({
      id: run.id,
      coordinatorAgentId: run.taskRun?.currentAgentId ?? run.taskRun?.initiatingAgentId ?? null,
      pattern: run.pattern?.name ?? null,
      diversityMode: run.diversityMode,
      consensusState: run.consensusState,
      startedAt: run.startedAt,
      branches: run.branchNodes.map((node) => {
        const { modelId, providerId } = extractBranchModelProvider(node.routeDecision);
        return {
          nodeId: node.id,
          role: node.workerRole,
          modelId,
          providerId,
          status: node.status,
        };
      }),
    })),
  });

  return {
    template,
    agents: stationedAgents,
    projections,
    routingTopology: {
      ...routingTopology,
      coworkers: mergedCoworkers,
      a2aEdges: a2aProjection.a2aEdges,
      deliberations,
      timeline: mergedTimeline,
    },
    recentWindowLabel: `Last ${RECENT_TOOL_LIMIT} records per evidence source`,
  };
}

/**
 * Recover a deliberation branch's model/provider from its persisted
 * `TaskNode.routeDecision` JSON. Provider falls back to the endpoint-id prefix
 * ("provider:model") when not stored explicitly — consistent with the routing
 * topology projector's provider resolution. Returns nulls for non-diverse runs
 * (single-model-multi-persona branches share one model and may carry neither).
 */
function extractBranchModelProvider(value: unknown): { modelId: string | null; providerId: string | null } {
  const parsed = typeof value === "string" ? safeJsonObject(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { modelId: null, providerId: null };
  }
  const record = parsed as Record<string, unknown>;
  const modelId = typeof record.selectedModelId === "string" ? record.selectedModelId : null;
  let providerId = typeof record.providerId === "string" ? record.providerId : null;
  if (!providerId && typeof record.selectedEndpoint === "string" && record.selectedEndpoint.includes(":")) {
    providerId = record.selectedEndpoint.split(":")[0] || null;
  }
  return { modelId, providerId };
}

function safeJsonObject(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/**
 * Resolve a PhaseHandoff.gateResult JSON blob into a pass/fail signal + a
 * short label. Conservative: an explicit boolean wins; otherwise a status
 * string is pattern-matched; otherwise the gate state is unknown (null).
 */
function resolveGateResult(value: unknown): { passed: boolean | null; label: string | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { passed: null, label: null };
  }
  const record = value as Record<string, unknown>;
  const explicit = record.passed ?? record.allowed ?? record.advanced;
  const statusText = [record.result, record.status, record.outcome, record.decision]
    .find((entry): entry is string => typeof entry === "string");

  let passed: boolean | null = null;
  if (typeof explicit === "boolean") {
    passed = explicit;
  } else if (statusText) {
    if (/pass|advanc|approv|ok|success/i.test(statusText)) passed = true;
    else if (/fail|block|reject|deny|error/i.test(statusText)) passed = false;
  }

  return { passed, label: statusText ?? null };
}

/**
 * Union two coworker-node lists by agentId, preserving the provider-topology
 * entry when an agent appears in both. Keeps a stable label sort.
 */
function mergeCoworkersById<T extends { agentId: string; label: string }>(
  primary: T[],
  secondary: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const coworker of primary) byId.set(coworker.agentId, coworker);
  for (const coworker of secondary) {
    if (!byId.has(coworker.agentId)) byId.set(coworker.agentId, coworker);
  }
  return [...byId.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function getActivationProfileType(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const profileType = (value as { profileType?: unknown }).profileType;
  return typeof profileType === "string" ? profileType : null;
}

/**
 * Merge the recent-40 task-run window with the stalled-200 window,
 * keeping each cuid id once. Exported so the unit test can lock in the
 * dedup behavior — the AI Operations Map's correctness depends on a row
 * appearing exactly once in the projection set.
 *
 * Both inputs share the same row shape (the Prisma select clauses match).
 * Recent rows are inserted first, then stalled rows that haven't already
 * appeared — this keeps existing test snapshots stable and matches the
 * mental model "stalled is added on top of recent."
 */
export function mergeTaskRunsDedupeById<T extends { id: string }>(
  recent: T[],
  stalled: T[],
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const row of recent) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  for (const row of stalled) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}
