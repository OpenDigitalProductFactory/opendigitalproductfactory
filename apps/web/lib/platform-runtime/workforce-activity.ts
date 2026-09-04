// apps/web/lib/platform-runtime/workforce-activity.ts
//
// The workforce "right now" loader (BI-1A68257F). Answers, per AI coworker:
// what are they doing now, what did they get done today (outcome digest), what
// did it cost, and — for the quiet ones — how long since they last acted. The
// coworker is the unit; resources are a separate, secondary concern.
//
// All four reads are grouped aggregations keyed by agentId so the view scales
// with the roster, not the event volume. The Prisma client is injected so the
// loader is unit-testable with a double.

import { prisma as realPrisma } from "@dpf/db";
import { summarizeOutcomes, type Outcome } from "./action-outcome-map";
import { isLiveStatus, TASK_LIVE_STATES } from "@/lib/tak/task-states";

const QUIET_SIGNAL_DAYS = 5;
const LAST_ACTED_LOOKBACK_DAYS = 30;

export type WorkforceCoworker = {
  agentId: string;
  name: string;
  role: string | null;
  now: { title: string; status: string; taskRunId: string } | null;
  didToday: Outcome[];
  /** Any of today's actions touched sensitive data (aggregate flag — no detail). */
  handlesSensitive: boolean;
  sensitiveActionCount: number;
  tokensToday: number;
  costToday: number;
  lastActedAt: string | null;
  /** The human-in-the-loop accountable for this coworker; null = no owner (a gap). */
  humanSupervisorId: string | null;
  hitlTier: number;
};

/**
 * A live TaskRun that no roster coworker owns (BI-B3AB7FC9): proactive
 * deliberations, build-phase reviews, system jobs. These are what is actually
 * on the model runner when "Working now" reads 0, so the view names them
 * instead of hiding them behind an empty state.
 */
export type WorkforcePlatformRun = {
  taskRunId: string;
  title: string;
  status: string;
  /** TaskRun.source — coworker | build | skill | proactive. */
  source: string | null;
  buildId: string | null;
  routeContext: string | null;
  startedAt: string;
  lastHeartbeatAt: string | null;
};

export type WorkforceActivity = {
  capturedAt: string;
  working: WorkforceCoworker[];
  quiet: WorkforceCoworker[];
  /** Live runs with no coworker owner, newest first. */
  platformWork: WorkforcePlatformRun[];
  pulse: {
    workingCount: number;
    totalCount: number;
    actionsToday: number;
    /** Every TokenUsage row today — attributed or not. */
    tokensToday: number;
    costToday: number;
    /**
     * Tokens today whose agentId is not a roster coworker ("unknown", a
     * retired agent, a system caller). Non-zero means an inference path is
     * spending without saying who for (BI-B3AB7FC9).
     */
    tokensUnattributed: number;
    costUnattributed: number;
    platformWorkCount: number;
    quietOverThresholdCount: number;
    /** Coworkers with no human-in-the-loop owner assigned — a governance gap. */
    coworkersWithoutOwnerCount: number;
  };
};

// Minimal structural view of the Prisma client this loader touches — lets a
// test inject a double without dragging the full generated client type in.
type WorkforcePrisma = {
  agent: { findMany: (args: unknown) => Promise<AgentRow[]> };
  taskRun: { findMany: (args: unknown) => Promise<TaskRunRow[]> };
  toolExecution: { groupBy: (args: unknown) => Promise<GroupRow[]> };
  tokenUsage: { groupBy: (args: unknown) => Promise<GroupRow[]> };
  delegationChain: { groupBy: (args: unknown) => Promise<ActorCountRow[]> };
  phaseHandoff: { groupBy: (args: unknown) => Promise<ActorCountRow[]> };
  backlogItemActivity: { groupBy: (args: unknown) => Promise<ActorCountRow[]> };
};
/** A groupBy row keyed on the ACTING coworker for a non-tool source. */
type ActorCountRow = {
  fromAgentId?: string | null;
  recordedByAgentId?: string | null;
  _count?: { _all: number };
};
type AgentRow = {
  agentId: string;
  name: string;
  displayName: string | null;
  valueStream: string | null;
  humanSupervisorId: string | null;
  hitlTierDefault: number;
};
type TaskRunRow = {
  taskRunId: string;
  status: string;
  title: string | null;
  currentAgentId: string | null;
  startedAt: Date;
  lastHeartbeatAt: Date | null;
  source?: string | null;
  buildId?: string | null;
  routeContext?: string | null;
};
type GroupRow = {
  agentId: string;
  toolName?: string;
  _count?: { _all: number };
  _sum?: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null };
  _max?: { createdAt: Date | null };
};

export async function loadWorkforceActivity(
  deps: { prisma?: WorkforcePrisma; now?: () => number } = {},
): Promise<WorkforceActivity> {
  const prisma = deps.prisma ?? (realPrisma as unknown as WorkforcePrisma);
  const nowMs = (deps.now ?? (() => Date.now()))();
  const startOfDay = new Date(nowMs);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const lookbackFloor = new Date(nowMs - LAST_ACTED_LOOKBACK_DAYS * 86_400_000);

  const [
    agents,
    liveRuns,
    toolByAgentTool,
    lastActedByAgent,
    tokensByAgent,
    delegatedRows,
    handoffRows,
    evidenceRows,
  ] = await Promise.all([
    prisma.agent.findMany({
      where: { archived: false, type: "coworker" },
      select: {
        agentId: true,
        name: true,
        displayName: true,
        valueStream: true,
        humanSupervisorId: true,
        hitlTierDefault: true,
      },
      orderBy: [{ tier: "asc" }, { name: "asc" }],
    }),
    prisma.taskRun.findMany({
      where: { archivedAt: null, status: { in: [...TASK_LIVE_STATES] } },
      orderBy: { startedAt: "desc" },
      select: {
        taskRunId: true,
        status: true,
        title: true,
        currentAgentId: true,
        startedAt: true,
        lastHeartbeatAt: true,
        source: true,
        buildId: true,
        routeContext: true,
      },
    }),
    prisma.toolExecution.groupBy({
      by: ["agentId", "toolName"],
      // ToolExecution is a general governed-tool ledger: it also records background
      // system jobs (executionMode "background") and permission/access AUDIT events
      // (executionMode "permission"). Those are not coworker accomplishments, so
      // they never count toward "did today" / "actions today" (BI-A1B4BE05).
      where: {
        createdAt: { gte: startOfDay },
        success: true,
        executionMode: { notIn: ["background", "permission"] },
      },
      _count: { _all: true },
    }),
    prisma.toolExecution.groupBy({
      by: ["agentId"],
      where: { createdAt: { gte: lookbackFloor } },
      _max: { createdAt: true },
    }),
    prisma.tokenUsage.groupBy({
      by: ["agentId"],
      where: { createdAt: { gte: startOfDay } },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    }),
    // Non-tool accomplishments so a coworker deep in delegation/lifecycle work
    // doesn't read as under-busy (BI-3D37CE9D): A2A delegations it initiated,
    // phase handoffs it made, and backlog evidence it logged — all keyed on the
    // ACTING coworker (fromAgentId / recordedByAgentId), today.
    prisma.delegationChain.groupBy({
      by: ["fromAgentId"],
      where: { startedAt: { gte: startOfDay } },
      _count: { _all: true },
    }),
    prisma.phaseHandoff.groupBy({
      by: ["fromAgentId"],
      where: { createdAt: { gte: startOfDay } },
      _count: { _all: true },
    }),
    prisma.backlogItemActivity.groupBy({
      by: ["recordedByAgentId"],
      where: { kind: "evidence", recordedAt: { gte: startOfDay } },
      _count: { _all: true },
    }),
  ]);

  const rosterIds = new Set(agents.map((a) => a.agentId));

  // First live task per agent (rows are newest-first). Live runs that no
  // roster coworker owns are platform work — listed, never dropped.
  const liveByAgent = new Map<string, TaskRunRow>();
  const platformWork: WorkforcePlatformRun[] = [];
  for (const run of liveRuns) {
    // Keep the projection fail-closed if an injected adapter or future query
    // returns a non-live row despite the canonical DB filter.
    if (!isLiveStatus(run.status)) continue;
    if (run.currentAgentId && rosterIds.has(run.currentAgentId)) {
      if (!liveByAgent.has(run.currentAgentId)) liveByAgent.set(run.currentAgentId, run);
      continue;
    }
    platformWork.push({
      taskRunId: run.taskRunId,
      title: run.title ?? "Untitled run",
      status: run.status,
      source: run.source ?? null,
      buildId: run.buildId ?? null,
      routeContext: run.routeContext ?? null,
      startedAt: run.startedAt.toISOString(),
      lastHeartbeatAt: run.lastHeartbeatAt ? run.lastHeartbeatAt.toISOString() : null,
    });
  }

  // toolName counts per agent.
  const toolCountsByAgent = new Map<string, Record<string, number>>();
  for (const row of toolByAgentTool) {
    if (!row.toolName) continue;
    const counts = toolCountsByAgent.get(row.agentId) ?? {};
    counts[row.toolName] = row._count?._all ?? 0;
    toolCountsByAgent.set(row.agentId, counts);
  }

  const lastActedMap = new Map<string, Date | null>(
    lastActedByAgent.map((r) => [r.agentId, r._max?.createdAt ?? null]),
  );
  const tokensMap = new Map<string, { tokens: number; cost: number }>(
    tokensByAgent.map((r) => [
      r.agentId,
      {
        tokens: (r._sum?.inputTokens ?? 0) + (r._sum?.outputTokens ?? 0),
        cost: r._sum?.costUsd ?? 0,
      },
    ]),
  );

  const delegatedByAgent = countByActor(delegatedRows, "fromAgentId");
  const handoffsByAgent = countByActor(handoffRows, "fromAgentId");
  const evidenceByAgent = countByActor(evidenceRows, "recordedByAgentId");

  // Tokens today is the whole ledger. What the roster loop below cannot claim
  // is reported as unattributed rather than silently dropped — the
  // reviewDesignDoc fan-out was 30% of a day's spend under agentId "unknown"
  // while this card said nothing (BI-B3AB7FC9).
  let tokensToday = 0;
  let costToday = 0;
  let tokensUnattributed = 0;
  let costUnattributed = 0;
  for (const [agentId, tok] of tokensMap) {
    tokensToday += tok.tokens;
    costToday += tok.cost;
    if (!rosterIds.has(agentId)) {
      tokensUnattributed += tok.tokens;
      costUnattributed += tok.cost;
    }
  }

  const working: WorkforceCoworker[] = [];
  const quiet: WorkforceCoworker[] = [];
  let actionsToday = 0;
  let quietOverThreshold = 0;
  let withoutOwner = 0;
  const quietFloor = new Date(nowMs - QUIET_SIGNAL_DAYS * 86_400_000);

  for (const agent of agents) {
    const toolCounts = toolCountsByAgent.get(agent.agentId) ?? {};
    const didToday = summarizeOutcomes(
      toolCounts,
      4,
      activityOutcomes(agent.agentId, delegatedByAgent, handoffsByAgent, evidenceByAgent),
    );
    const tok = tokensMap.get(agent.agentId) ?? { tokens: 0, cost: 0 };
    const live = liveByAgent.get(agent.agentId);
    const lastActed = live
      ? (live.lastHeartbeatAt ?? live.startedAt)
      : (lastActedMap.get(agent.agentId) ?? null);
    const sensitiveActionCount = didToday
      .filter((o) => o.sensitive)
      .reduce((sum, o) => sum + o.count, 0);
    const humanSupervisorId = agent.humanSupervisorId ?? null;

    actionsToday += didToday.reduce((sum, o) => sum + o.count, 0);
    if (!humanSupervisorId) withoutOwner += 1;

    const coworker: WorkforceCoworker = {
      agentId: agent.agentId,
      name: agent.displayName || agent.name,
      role: agent.valueStream,
      now: live ? { title: live.title ?? "Untitled task", status: live.status, taskRunId: live.taskRunId } : null,
      didToday,
      handlesSensitive: sensitiveActionCount > 0,
      sensitiveActionCount,
      tokensToday: tok.tokens,
      costToday: tok.cost,
      lastActedAt: lastActed ? lastActed.toISOString() : null,
      humanSupervisorId,
      hitlTier: agent.hitlTierDefault,
    };

    if (live) {
      working.push(coworker);
    } else {
      quiet.push(coworker);
      if (!lastActed || lastActed < quietFloor) quietOverThreshold += 1;
    }
  }

  // Working: busiest (most tokens today) first. Quiet: most-recently-active first,
  // never-acted last, so the freshest gaps read before the long-dormant ones.
  working.sort((a, b) => b.tokensToday - a.tokensToday);
  quiet.sort((a, b) => (b.lastActedAt ?? "").localeCompare(a.lastActedAt ?? ""));

  return {
    capturedAt: new Date(nowMs).toISOString(),
    working,
    quiet,
    platformWork,
    pulse: {
      workingCount: working.length,
      totalCount: agents.length,
      actionsToday,
      tokensToday,
      costToday,
      tokensUnattributed,
      costUnattributed,
      platformWorkCount: platformWork.length,
      quietOverThresholdCount: quietOverThreshold,
      coworkersWithoutOwnerCount: withoutOwner,
    },
  };
}

/** Count grouped rows by the acting-coworker field into a per-agent map. */
function countByActor(
  rows: ActorCountRow[],
  key: "fromAgentId" | "recordedByAgentId",
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const id = row[key];
    if (id) map.set(id, row._count?._all ?? 0);
  }
  return map;
}

/** A coworker's non-tool accomplishments today, as ranked-in outcome chips. */
function activityOutcomes(
  agentId: string,
  delegatedByAgent: Map<string, number>,
  handoffsByAgent: Map<string, number>,
  evidenceByAgent: Map<string, number>,
): Outcome[] {
  const out: Outcome[] = [];
  const delegated = delegatedByAgent.get(agentId) ?? 0;
  const handoffs = handoffsByAgent.get(agentId) ?? 0;
  const evidence = evidenceByAgent.get(agentId) ?? 0;
  if (delegated > 0) {
    out.push({ label: delegated === 1 ? "delegation" : "delegations", count: delegated, sensitive: false });
  }
  if (handoffs > 0) {
    out.push({ label: handoffs === 1 ? "handoff" : "handoffs", count: handoffs, sensitive: false });
  }
  if (evidence > 0) {
    out.push({ label: "evidence logged", count: evidence, sensitive: false });
  }
  return out;
}
