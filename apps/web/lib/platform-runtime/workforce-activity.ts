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

const LIVE_TASK_STATUSES = ["working", "active", "input-required", "auth-required", "stalled"];
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

export type WorkforceActivity = {
  capturedAt: string;
  working: WorkforceCoworker[];
  quiet: WorkforceCoworker[];
  pulse: {
    workingCount: number;
    totalCount: number;
    actionsToday: number;
    tokensToday: number;
    costToday: number;
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

  const [agents, liveRuns, toolByAgentTool, lastActedByAgent, tokensByAgent] = await Promise.all([
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
      where: { archivedAt: null, status: { in: LIVE_TASK_STATUSES } },
      orderBy: { startedAt: "desc" },
      select: { taskRunId: true, status: true, title: true, currentAgentId: true, startedAt: true, lastHeartbeatAt: true },
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
  ]);

  // First live task per agent (rows are newest-first).
  const liveByAgent = new Map<string, TaskRunRow>();
  for (const run of liveRuns) {
    if (run.currentAgentId && !liveByAgent.has(run.currentAgentId)) {
      liveByAgent.set(run.currentAgentId, run);
    }
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

  const working: WorkforceCoworker[] = [];
  const quiet: WorkforceCoworker[] = [];
  let actionsToday = 0;
  let tokensToday = 0;
  let costToday = 0;
  let quietOverThreshold = 0;
  let withoutOwner = 0;
  const quietFloor = new Date(nowMs - QUIET_SIGNAL_DAYS * 86_400_000);

  for (const agent of agents) {
    const toolCounts = toolCountsByAgent.get(agent.agentId) ?? {};
    const didToday = summarizeOutcomes(toolCounts);
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
    tokensToday += tok.tokens;
    costToday += tok.cost;
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
    pulse: {
      workingCount: working.length,
      totalCount: agents.length,
      actionsToday,
      tokensToday,
      costToday,
      quietOverThresholdCount: quietOverThreshold,
      coworkersWithoutOwnerCount: withoutOwner,
    },
  };
}
