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
import type { RoutingEvidenceConformanceProjection } from "./routing-evidence-conformance";
import { projectLoadedRoutingEvidence } from "./routing-evidence-loader-projection";
import { resolveModelSelectionByPhase } from "@/lib/inference/phase-model-resolution";
import { projectActivityRoutingFromLiveState } from "./activity-routing-live-state";
import {
  ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
} from "@/lib/routing/activity-harness-approval-source";
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
import {
  extractBranchModelProvider,
  getActivationProfileType,
  mergeCoworkersById,
  mergeTaskRunsDedupeById,
  resolveEvidenceRange,
  resolveGateResult,
} from "./load-map-support";
import { OPERATIONS_RUN_SELECT } from "./operations-run-read-model";
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
 * Per-source row budget when the caller scopes the load to an explicit
 * evidence window (BI-40EFC7DE). The flat RECENT_TOOL_LIMIT cap silently
 * discarded months of routing history — a 37-day timeline rendered only the
 * newest 40 rows of each source. Windowed loads trade the global cap for a
 * bounded per-window budget: newest-first within [start, end], so a dense
 * window degrades to "most recent N inside the window" rather than an
 * unbounded payload. Raw route-decision traces never leave the server (the
 * projectors distill them into markers), so the budget bounds marker count,
 * not trace bytes.
 */
export const WINDOWED_SOURCE_LIMIT = 400;

export type OperationsMapEvidenceWindow = { start: Date; end: Date };

export type LoadOperationsMapDataOptions = {
  window?: OperationsMapEvidenceWindow | null;
};

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
  routingEvidence: RoutingEvidenceConformanceProjection;
  recentWindowLabel: string;
  /**
   * Global min/max evidence timestamps across the routing evidence tables,
   * independent of the queried window. The timeline anchors its base range
   * to this so windowed refetches can't shrink the scrubber's span, and the
   * "data begins here" boundary marker is honest about how far back this
   * install's history actually goes.
   */
  evidenceRange: { earliest: string | null; latest: string | null };
  queriedWindow: { start: string; end: string } | null;
};

export async function loadOperationsMapData(
  options?: LoadOperationsMapDataOptions,
): Promise<OperationsMapData> {
  const evidenceWindow = options?.window ?? null;
  const evidenceTake = evidenceWindow ? WINDOWED_SOURCE_LIMIT : RECENT_TOOL_LIMIT;
  const createdAtWindow = evidenceWindow
    ? { createdAt: { gte: evidenceWindow.start, lte: evidenceWindow.end } }
    : {};
  const startedAtWindow = evidenceWindow
    ? { startedAt: { gte: evidenceWindow.start, lte: evidenceWindow.end } }
    : {};
  const recordedAtWindow = evidenceWindow
    ? { recordedAt: { gte: evidenceWindow.start, lte: evidenceWindow.end } }
    : {};

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
    adapterRuns,
    providerCapacity,
    scheduledAgentTasks,
    scheduledJobs,
    delegationChains,
    phaseHandoffs,
    a2aTaskRuns,
    deliberationRuns,
    activityHarnessApprovalProposals,
    phaseModelSelection,
    evidenceRange,
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
        ...startedAtWindow,
      },
      orderBy: { startedAt: "desc" },
      take: evidenceTake,
      select: OPERATIONS_RUN_SELECT,
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
      select: OPERATIONS_RUN_SELECT,
    }),
    prisma.toolExecution.findMany({
      where: { ...createdAtWindow },
      orderBy: { createdAt: "desc" },
      take: evidenceTake,
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
      where: { ...createdAtWindow },
      orderBy: { createdAt: "desc" },
      take: evidenceTake,
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
      where: { kind: "evidence", ...recordedAtWindow },
      orderBy: { recordedAt: "desc" },
      take: evidenceTake,
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
      where: { ...createdAtWindow },
      orderBy: { createdAt: "desc" },
      take: evidenceTake,
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
      where: { ...createdAtWindow },
      orderBy: { createdAt: "desc" },
      take: evidenceTake,
      select: {
        id: true,
        traceId: true,
        designRevision: true,
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
      where: { ...createdAtWindow },
      orderBy: { createdAt: "desc" },
      take: evidenceTake,
      select: {
        id: true,
        traceId: true,
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
      where: { ...createdAtWindow },
      orderBy: { createdAt: "desc" },
      take: evidenceTake,
      select: {
        id: true,
        traceId: true,
        agentId: true,
        providerId: true,
        modelId: true,
        taskType: true,
        fallbackOccurred: true,
        providerErrorCode: true,
        latencyMs: true,
        inputTokens: true,
        outputTokens: true,
        costUsd: true,
        createdAt: true,
      },
    }),
    prisma.adapterRunTelemetry.findMany({
      where: { ...startedAtWindow },
      orderBy: { startedAt: "desc" },
      take: evidenceTake,
      select: {
        id: true,
        traceId: true,
        providerId: true,
        modelId: true,
        adapterKind: true,
        status: true,
        durationMs: true,
        inputTokens: true,
        outputTokens: true,
        estimatedCostUsd: true,
        startedAt: true,
      },
    }),
    prisma.providerCapacityStatus.findMany({
      where: evidenceWindow
        ? { lastObservedAt: { gte: evidenceWindow.start, lte: evidenceWindow.end } }
        : {},
      orderBy: { lastObservedAt: "desc" },
      select: {
        providerId: true,
        state: true,
        lastObservedAt: true,
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
      where: { ...startedAtWindow },
      orderBy: { startedAt: "desc" },
      take: evidenceTake,
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
      where: { ...createdAtWindow },
      orderBy: { createdAt: "desc" },
      take: evidenceTake,
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
        ...startedAtWindow,
      },
      orderBy: { startedAt: "desc" },
      take: evidenceTake,
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
      where: { ...startedAtWindow },
      orderBy: { startedAt: "desc" },
      take: evidenceTake,
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
    prisma.agentActionProposal.findMany({
      where: {
        actionType: ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
        status: { in: ["approve", "approved", "executed"] },
      },
      orderBy: { decidedAt: "desc" },
      take: RECENT_TOOL_LIMIT,
      select: {
        proposalId: true,
        actionType: true,
        parameters: true,
        status: true,
        decidedById: true,
        decidedAt: true,
      },
    }),
    resolveModelSelectionByPhase(),
    // Global evidence bounds (window-independent): anchors the client
    // timeline's base range so windowed refetches can't shrink the scrubber,
    // and powers the "data begins here" boundary marker (BI-40EFC7DE).
    Promise.all([
      prisma.routeDecisionLog.aggregate({ _min: { createdAt: true }, _max: { createdAt: true } }),
      prisma.tokenUsage.aggregate({ _min: { createdAt: true }, _max: { createdAt: true } }),
      prisma.routeOutcome.aggregate({ _min: { createdAt: true }, _max: { createdAt: true } }),
      prisma.toolExecution.aggregate({ _min: { createdAt: true }, _max: { createdAt: true } }),
      prisma.taskRun.aggregate({
        _min: { startedAt: true },
        _max: { startedAt: true },
        where: { archivedAt: null },
      }),
    ]).then((aggregates) =>
      resolveEvidenceRange(
        aggregates.map((aggregate) => {
          const bounds = aggregate as {
            _min: Record<string, Date | null>;
            _max: Record<string, Date | null>;
          };
          return {
            min: Object.values(bounds._min)[0] ?? null,
            max: Object.values(bounds._max)[0] ?? null,
          };
        }),
      ),
    ),
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
  const routeDecisionRows = routeDecisions.map((decision) => ({
    ...decision,
    agentId: decision.agentId ?? (decision.agentMessageId ? routeDecisionAgentIdByMessageId.get(decision.agentMessageId) ?? null : null),
  }));
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
    routeDecisions: routeDecisionRows,
    tokenUsage,
    routeOutcomes,
    scheduledAgentTasks,
    scheduledJobs,
  });
  const routingEvidence = projectLoadedRoutingEvidence({
    window: evidenceWindow,
    decisions: routeDecisionRows,
    adapterRuns,
    outcomes: routeOutcomes,
    tokenUsage,
    capacity: providerCapacity,
    providers,
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
      activityRouting: projectActivityRoutingFromLiveState({
        providers,
        taskRuns,
        routeDecisions: routeDecisionRows,
        tokenUsage,
        routeOutcomes,
        activityHarnessApprovalProposals,
        phaseModelSelection,
      }),
      coworkers: mergedCoworkers,
      a2aEdges: a2aProjection.a2aEdges,
      deliberations,
      timeline: mergedTimeline,
    },
    routingEvidence,
    recentWindowLabel: evidenceWindow
      ? `Up to ${WINDOWED_SOURCE_LIMIT} records per evidence source in the selected window`
      : `Last ${RECENT_TOOL_LIMIT} records per evidence source`,
    evidenceRange,
    queriedWindow: evidenceWindow
      ? { start: evidenceWindow.start.toISOString(), end: evidenceWindow.end.toISOString() }
      : null,
  };
}

export { mergeTaskRunsDedupeById, resolveEvidenceRange } from "./load-map-support";
