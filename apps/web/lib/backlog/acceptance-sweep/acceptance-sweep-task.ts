// The deterministic executor for the daily `acceptance-sweep` scheduled task
// (BI-DF255666). Extracted so the dispatcher stays a thin discriminator,
// mirroring executeDecisionEngineReviewTask.
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.3.
// Plan:   docs/superpowers/plans/2026-09-24-acceptance-accountability-plan.md, phase 2.
//
// Off the LLM path entirely. One run at a time is guaranteed upstream: the
// scheduler's guarded claim (executeScheduledAgentTask, BI-D1CD3A11) advances
// nextRunAt with a conditional update before any branch runs, so exactly one
// dispatcher wins a due tick and a concurrent poll or retry returns without
// running. This executor adds no lock of its own.

import {
  prisma,
  ACCEPTANCE_AGED_DAYS,
  ACCEPTANCE_SWEEP_AGENT_ID,
  ACCEPTANCE_SWEEP_PAGE_SIZE,
  ACCEPTANCE_SWEEP_ROUTE_LIMIT,
  ACCEPTANCE_SWEEP_ROUTING,
  ACCEPTANCE_TREND_DAYS,
} from "@dpf/db";

import { computeNextCronRun } from "@/lib/operate/cron-next-run";
import { resolveWorkOwner, type AccountableOwnerDb } from "@/lib/portfolio/accountable-owner";

import { loadAcceptancePoolAges, type AcceptancePoolAgeDb } from "./acceptance-pool-age";
import { closeAllowedAcceptanceItem, type AcceptanceSweepCloseDb } from "./acceptance-sweep-close";
import { evaluateOwedAcceptance, productionSweepEvaluateDeps } from "./acceptance-sweep-evaluate";
import { selectAcceptanceSweepPage, type AcceptanceSweepPageDb } from "./acceptance-sweep-page";
import { runAcceptanceSweep, type AcceptanceSweepConfig, type AcceptanceSweepPorts, type AcceptanceSweepSummary } from "./acceptance-sweep-run";
import type { InPlatformOwnerDb } from "./in-platform-owners";
import type { AgedSweepCandidate } from "./acceptance-sweep-routing";
import { routeAgedItems, type AcceptanceRouteDb, type RouteOutcome } from "./route-aged-item";
import {
  COMPLETION_TRANSITION_TOOL,
  resolveCloseAuthorisation,
  type CloseAuthorisation,
  type CloseAuthorisationPorts,
} from "./close-authorisation";
import { recordOwedAcceptanceSnapshot, type OwedSnapshotDb } from "./owed-snapshot";

/** Stable identity of the standing Acceptance steward room. */
export const ACCEPTANCE_ROOM_KEY = "acceptance-standing-room";
export const ACCEPTANCE_SWEEP_RUN_ACTIVITY_KIND = "acceptance-sweep";

/** The scheduled-task fields this branch reads. */
export interface AcceptanceSweepTask {
  taskId: string;
  schedule: string;
  agentId: string;
}

type RoomDb = {
  workroom: {
    findUnique(args: { where: { idempotencyKey: string }; select: { id: true } }): Promise<{ id: string } | null>;
    upsert(args: {
      where: { idempotencyKey: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
      select: { id: true };
    }): Promise<{ id: string }>;
  };
  workroomActivity: {
    findFirst(args: {
      where: { workCapsuleId: string; kind: string };
      orderBy: Array<{ recordedAt: "desc" } | { id: "desc" }>;
      select: { payload: true };
    }): Promise<{ payload: unknown } | null>;
    create(args: {
      data: { workCapsuleId: string; kind: string; summary: string; payload: Record<string, unknown>; recordedByAgentId: string };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
};

type TaskStatusDb = {
  scheduledAgentTask: { update(args: { where: { taskId: string }; data: Record<string, unknown> }): Promise<unknown> };
  scheduledJob: { update(args: { where: { jobId: string }; data: Record<string, unknown> }): Promise<unknown> };
};

/** The cursor the previous run recorded. A lost cursor only restarts the round-robin. */
export async function loadLastSweepCursor(db: RoomDb): Promise<string | null> {
  const room = await db.workroom.findUnique({ where: { idempotencyKey: ACCEPTANCE_ROOM_KEY }, select: { id: true } });
  if (!room) return null;
  const last = await db.workroomActivity.findFirst({
    where: { workCapsuleId: room.id, kind: ACCEPTANCE_SWEEP_RUN_ACTIVITY_KIND },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    select: { payload: true },
  });
  const payload = last?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const cursor = (payload as { cursor?: unknown }).cursor;
  return typeof cursor === "string" && cursor ? cursor : null;
}

/**
 * Append the run to the standing room, convening it the first time. The
 * standing-room pattern (concierge-sweep-runner.ts): one room for an ongoing
 * activity, never closed, each pass appended as activity. It names no backlog
 * item: a steward room verifies work and never holds an item's ownership.
 */
export async function recordSweepRun(db: RoomDb, summary: AcceptanceSweepSummary, agentId: string): Promise<{ activityId: string }> {
  const room = await db.workroom.upsert({
    where: { idempotencyKey: ACCEPTANCE_ROOM_KEY },
    update: { lastSyncedAt: new Date(summary.ranAt), executorKind: "dpf-native", executorRef: "acceptance-sweep" },
    create: {
      capsuleId: "WC-ACCEPTANCE",
      idempotencyKey: ACCEPTANCE_ROOM_KEY,
      title: "Acceptance",
      objective:
        "Keep delivered work from waiting unseen for acceptance: record who owes each awaiting-acceptance item's "
        + "acceptance, measure how long items have waited, and say which items no coworker can be named for.",
      status: "working",
      source: "scheduled-steward",
      executorKind: "dpf-native",
      executorRef: "acceptance-sweep",
      activityKind: "governance",
      decisionScope: "wwmd",
      portfolioRole: "foundational",
      servedPersona: "Operator who needs delivered work proven, not just merged",
    },
    select: { id: true },
  });
  const { headline, ...payload } = summary;
  const activity = await db.workroomActivity.create({
    data: {
      workCapsuleId: room.id,
      kind: ACCEPTANCE_SWEEP_RUN_ACTIVITY_KIND,
      summary: headline,
      payload: payload as unknown as Record<string, unknown>,
      recordedByAgentId: agentId,
    },
    select: { id: true },
  });
  return { activityId: activity.id };
}

type PlatformConfigDb = {
  platformConfig: { findUnique(args: { where: { key: string }; select: { value: true } }): Promise<{ value: unknown } | null> };
};

type RouteTextDb = {
  backlogItem: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; title: true; body: true };
    }): Promise<Array<{ id: string; title: string; body: string | null }>>;
  };
};

type SweepDb = RoomDb & TaskStatusDb & AcceptancePoolAgeDb & AcceptanceSweepPageDb & OwedSnapshotDb & InPlatformOwnerDb
  & AcceptanceSweepCloseDb & PlatformConfigDb & AcceptanceRouteDb & AccountableOwnerDb & RouteTextDb;

/**
 * Give this run's aged, non-closable items a steward room each (BI-C1781121).
 * The room brief quotes the item's title and acceptance criteria, read here
 * because the page selects ids only. The room's owner is the person
 * accountable for the platform's automatic work (resolveWorkOwner, Foundational).
 */
export async function routeAgedSweepCandidates(
  db: AcceptanceRouteDb & AccountableOwnerDb & RouteTextDb,
  now: Date,
  candidates: readonly AgedSweepCandidate[],
  limit: number,
): Promise<RouteOutcome[]> {
  const rows = await db.backlogItem.findMany({
    where: { id: { in: candidates.map((candidate) => candidate.item.id) } },
    select: { id: true, title: true, body: true },
  });
  const text = new Map(rows.map((row) => [row.id, row]));
  return routeAgedItems({
    db,
    now,
    limit,
    candidates: candidates.map(({ item, ageDays, projection }) => ({
      rowId: item.id,
      itemId: item.itemId,
      title: text.get(item.id)?.title ?? item.itemId,
      body: text.get(item.id)?.body ?? null,
      ageDays,
      projection,
    })),
    resolveOwnerUserId: async () => (await resolveWorkOwner(db, {})).userId,
  });
}

/**
 * Current authority behind the pre-authorisation (BI-45D3BBF4): the operator's
 * live membership, and the coworker's stored grants (never the registry
 * defaults). Lazy imports keep both off the scheduler's import graph.
 */
export function productionCloseAuthorisationPorts(db: PlatformConfigDb): CloseAuthorisationPorts {
  return {
    readConfig: async (key) => (await db.platformConfig.findUnique({ where: { key }, select: { value: true } }))?.value ?? null,
    operatorMayCloseBacklog: async (userId) => {
      const { currentUserContext } = await import("@/lib/govern/current-user-context");
      const { can } = await import("@/lib/permissions");
      const context = await currentUserContext(userId);
      return context !== null && can(context, "manage_backlog");
    },
    agentCompletionGrant: async (agentId) => {
      const { expandGrants, getAgentToolGrantsAsync, getToolGrantMapping } = await import("@/lib/tak/agent-grants");
      const held = new Set(expandGrants(await getAgentToolGrantsAsync(agentId)));
      // Required grants are alternatives (grantsSatisfyRequirement); cite the one actually held.
      return (getToolGrantMapping()[COMPLETION_TRANSITION_TOOL] ?? []).find((grant) => held.has(grant)) ?? null;
    },
  };
}

function productionPorts(db: SweepDb, now: Date, agentId: string): AcceptanceSweepPorts {
  const evaluateDeps = productionSweepEvaluateDeps(db);
  return {
    now,
    loadPoolAges: () => loadAcceptancePoolAges(db, now),
    loadLastCursor: () => loadLastSweepCursor(db),
    selectPage: (args) => selectAcceptanceSweepPage(db, args),
    evaluate: (item) => evaluateOwedAcceptance(item, evaluateDeps),
    recordSnapshot: (item, projection) => recordOwedAcceptanceSnapshot({ db, backlogItemId: item.id, projection, recordedByAgentId: agentId }),
    recordRun: (summary) => recordSweepRun(db, summary, agentId),
    route: (candidates, limit) => routeAgedSweepCandidates(db, now, candidates, limit),
    resolveCloseAuthorisation: (): Promise<CloseAuthorisation> =>
      resolveCloseAuthorisation(agentId, productionCloseAuthorisationPorts(db)),
    close: async (item, decision, authorisation) => {
      const { completeBacklogItemTransition } = await import("@/lib/backlog/initiative-readiness/backlog-terminal-transition");
      return closeAllowedAcceptanceItem({ item, decision, authorisation, agentId, now, db, complete: completeBacklogItemTransition });
    },
  };
}

export async function executeAcceptanceSweepTask(
  task: AcceptanceSweepTask,
  deps: {
    now?: Date;
    db?: SweepDb;
    run?: (ports: AcceptanceSweepPorts, config: AcceptanceSweepConfig) => Promise<AcceptanceSweepSummary>;
  } = {},
): Promise<void> {
  const startedAt = deps.now ?? new Date();
  const db = deps.db ?? (prisma as unknown as SweepDb);
  const run = deps.run ?? runAcceptanceSweep;
  const agentId = task.agentId || ACCEPTANCE_SWEEP_AGENT_ID;
  const nextRunAt = computeNextCronRun(task.schedule, startedAt);
  const record = async (data: { lastStatus: "ok" | "error"; lastError: string | null }) => {
    const fields = { lastRunAt: startedAt, ...data, nextRunAt };
    await db.scheduledAgentTask.update({ where: { taskId: task.taskId }, data: fields });
    await db.scheduledJob.update({ where: { jobId: task.taskId }, data: fields }).catch(() => {});
  };
  try {
    const summary = await run(productionPorts(db, startedAt, agentId), {
      pageSize: ACCEPTANCE_SWEEP_PAGE_SIZE,
      agedDays: ACCEPTANCE_AGED_DAYS,
      trendDays: ACCEPTANCE_TREND_DAYS,
      routing: ACCEPTANCE_SWEEP_ROUTING,
      routeLimit: ACCEPTANCE_SWEEP_ROUTE_LIMIT,
      recordedByAgentId: agentId,
    });
    console.info("[acceptance-sweep] %s", summary.headline);
    await record({ lastStatus: "ok", lastError: null });
  } catch (err) {
    await record({ lastStatus: "error", lastError: err instanceof Error ? err.message : "unknown error" });
  }
}
