// The deterministic executor for the daily `acceptance-sweep` scheduled task
// (BI-DF255666). Extracted so the dispatcher stays a thin discriminator,
// mirroring executeDecisionEngineReviewTask.
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.3.
// Plan:   docs/superpowers/plans/2026-09-24-acceptance-accountability-plan.md, phase 2.
//
// Off the LLM path. The acceptance-specific lease claims before cadence is
// changed; every mutation validates that owner inside a task-row transaction.

import {
  prisma,
  ACCEPTANCE_AGED_DAYS,
  ACCEPTANCE_SWEEP_AGENT_ID,
  ACCEPTANCE_SWEEP_PAGE_SIZE,
  ACCEPTANCE_SWEEP_ROUTE_LIMIT,
  ACCEPTANCE_SWEEP_ROUTING,
  ACCEPTANCE_TREND_DAYS,
} from "@dpf/db";

import type { SweepClaim } from "./acceptance-sweep-checkpoint";
import type { TerminalTransitionClient } from "@/lib/backlog/initiative-readiness/terminal-transition-repository";
import { withAcceptanceSweepWrite, type SweepFenceDb } from "./acceptance-sweep-fence";
import { claimAcceptanceSweep, finishAcceptanceSweep, renewAcceptanceSweep, type SweepLeaseClient } from "./acceptance-sweep-lease";
import { resolveWorkOwner, type AccountableOwnerDb } from "@/lib/portfolio/accountable-owner";

import { loadAcceptancePoolAges, type AcceptancePoolAgeDb } from "./acceptance-pool-age";
import { closeAllowedAcceptanceItem, type AcceptanceSweepCloseDb } from "./acceptance-sweep-close";
import { evaluateOwedAcceptance, productionSweepEvaluateDeps } from "./acceptance-sweep-evaluate";
import { selectAcceptanceSweepPage, type AcceptanceSweepPageDb } from "./acceptance-sweep-page";
import { runAcceptanceSweep, type AcceptanceSweepConfig, type AcceptanceSweepPorts, type AcceptanceSweepSummary } from "./acceptance-sweep-run";
import type { InPlatformOwnerDb } from "./in-platform-owners";
import type { AgedSweepCandidate } from "./acceptance-sweep-routing";
import type { DeliveryActorDb } from "./delivery-actors";
import { issueAcceptanceObjectiveMappingPacket, type IssuePacketDb } from "./issue-objective-mapping-packet";
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

type SweepDb = RoomDb & AcceptancePoolAgeDb & AcceptanceSweepPageDb & OwedSnapshotDb & InPlatformOwnerDb
  & AcceptanceSweepCloseDb & PlatformConfigDb & AcceptanceRouteDb & AccountableOwnerDb & RouteTextDb & IssuePacketDb
  & DeliveryActorDb & TerminalTransitionClient;

/**
 * Give this run's aged, non-closable items a steward room each (BI-C1781121).
 * The room brief quotes the item's title and acceptance criteria, read here
 * because the page selects ids only. The room's owner is the person
 * accountable for the platform's automatic work (resolveWorkOwner, Foundational).
 * A routed medium or large item's live room is issued the owner's
 * objective-mapping packet (BI-099A0BA3, issue-objective-mapping-packet.ts).
 */
export async function routeAgedSweepCandidates(
  db: AcceptanceRouteDb & AccountableOwnerDb & RouteTextDb & IssuePacketDb,
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
    issuePacket: (args) => issueAcceptanceObjectiveMappingPacket({ db, now, ...args }),
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

export function productionAcceptanceSweepPorts(db: SweepDb, now: Date, agentId: string, taskId: string, claim: SweepClaim): AcceptanceSweepPorts {
  const evaluateDeps = productionSweepEvaluateDeps(db);
  const leaseDb = db as unknown as SweepFenceDb<SweepDb & SweepLeaseClient>;
  const write = <T>(callback: (tx: SweepDb & SweepLeaseClient) => Promise<T>) =>
    withAcceptanceSweepWrite(leaseDb, taskId, claim, callback);
  return {
    now,
    loadPoolAges: () => loadAcceptancePoolAges(db, now),
    loadLastCursor: () => loadLastSweepCursor(db),
    selectPage: (args) => selectAcceptanceSweepPage(db, args),
    evaluate: (item) => evaluateOwedAcceptance(item, evaluateDeps),
    recordSnapshot: (item, projection) => write(tx => recordOwedAcceptanceSnapshot({ db: tx, backlogItemId: item.id, projection, recordedByAgentId: agentId })),
    recordRun: (summary) => write(tx => recordSweepRun(tx, summary, agentId)),
    route: async (candidates, limit) => {
      const outcomes: RouteOutcome[] = [];
      let remaining = limit;
      const ordered = [...candidates].sort((a, b) => b.ageDays - a.ageDays || a.item.itemId.localeCompare(b.item.itemId));
      for (const candidate of ordered) {
        const routed = await write(tx => routeAgedSweepCandidates(tx, now, [candidate], remaining));
        remaining -= routed.filter(row => row.outcome === "routed").length;
        outcomes.push(...routed);
      }
      return outcomes;
    },
    confirm: async (item) => {
      const { advanceSubmitterConfirmation } = await import("./submitter-confirmation");
      return advanceSubmitterConfirmation(item, productionSubmitterConfirmationPorts(db, now, agentId, write));
    },
    resolveCloseAuthorisation: (): Promise<CloseAuthorisation> =>
      resolveCloseAuthorisation(agentId, productionCloseAuthorisationPorts(db)),
    close: async (item, decision, authorisation) => {
      const { completeBacklogItemTransition } = await import("@/lib/backlog/initiative-readiness/backlog-terminal-transition");
      const { prepareSweepCompletionSignals } = await import("./prepare-completion-signals");
      const prepared = await prepareSweepCompletionSignals(db as unknown as Parameters<typeof prepareSweepCompletionSignals>[0], item.id);
      return closeAllowedAcceptanceItem({ item, decision, authorisation, agentId, now, db,
        complete: args => completeBacklogItemTransition({ ...args, dependencies: prepared.dependencies, db: {
          // Normal mutation AND CAS-conflict audit retry revalidate the owner
          // and signal inputs. No Git, network or global-client read under lock.
          $transaction: callback => write(async tx => {
            await prepared.assertCurrent(tx as unknown as Parameters<typeof prepared.assertCurrent>[0]);
            return callback(tx);
          }),
        } }),
      });
    },
  };
}

type ConfirmationActivityRow = { kind: string; recordedAt: Date; payload: unknown };
type ConfirmationClient = {
  backlogItem: { findUnique(args: unknown): Promise<{ itemId: string; body: string | null; lifecycleTags: string[];
    activities: ConfirmationActivityRow[] } | null> };
  backlogItemActivity: { create(args: unknown): Promise<unknown> };
};

/**
 * The submitter question's I/O (BI-C899BB40). Reads one item's closure,
 * confirmation rows and source changes; posts through the existing forge
 * adapter with the managed-repository controller login only; notifies a
 * founder demand cluster through the existing disposition notices; files a
 * miss through fileAcceptanceMiss; records each step inside the sweep fence.
 */
export function productionSubmitterConfirmationPorts(
  db: SweepDb,
  now: Date,
  agentId: string,
  write: <T>(callback: (tx: SweepDb & SweepLeaseClient) => Promise<T>) => Promise<T>,
): import("./submitter-confirmation").SubmitterConfirmationPorts {
  const client = db as unknown as ConfirmationClient;
  return {
    now,
    loadState: async (item) => {
      const { SUBMITTER_CONFIRMATION_ACTIVITY_KIND } = await import("./acceptance-sweep-page");
      const row = await client.backlogItem.findUnique({
        where: { id: item.id },
        select: { itemId: true, body: true, lifecycleTags: true,
          activities: { where: { kind: { in: ["status_change", SUBMITTER_CONFIRMATION_ACTIVITY_KIND, "intake_origin"] } },
            orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 200,
            select: { kind: true, recordedAt: true, payload: true } } },
      });
      const closure = row?.activities.find((activity) => activity.kind === "status_change");
      if (!row || !closure || !closure.payload || typeof closure.payload !== "object" || Array.isArray(closure.payload)) return null;
      const after = (activity: ConfirmationActivityRow) => activity.recordedAt.getTime() >= closure.recordedAt.getTime();
      return {
        itemId: row.itemId,
        body: row.body,
        lifecycleTags: row.lifecycleTags ?? [],
        closure: { recordedAt: closure.recordedAt, payload: closure.payload as Record<string, unknown> },
        records: row.activities.filter((activity) => activity.kind === SUBMITTER_CONFIRMATION_ACTIVITY_KIND && after(activity)),
        sourceChanges: row.activities.flatMap((activity) => {
          if (activity.kind !== "intake_origin" || !after(activity)) return [];
          const change = (activity.payload as { change?: { kind?: unknown } } | null)?.change;
          return typeof change?.kind === "string" ? [{ recordedAt: activity.recordedAt, kind: change.kind }] : [];
        }),
      };
    },
    postIssueComment: async (repository, number, body) => {
      const { resolveRepositoryControllerToken } = await import("@/lib/contributor-change-lanes/github-rest-reader");
      const token = await resolveRepositoryControllerToken(db as never);
      if (!token) return { sent: false, reason: "no-credential", message: "No managed-repository controller login is connected." };
      const { GitHubForgeAdapter } = await import("@/lib/forge/github-adapter");
      const posted = await new GitHubForgeAdapter({ token }).commentOnIssue({ repository, number, body, egressClass: "own-repo" });
      return posted.ok ? { sent: true, url: posted.commentUrl } : { sent: false, reason: "error", message: `${posted.category}: ${posted.message}` };
    },
    notifyCluster: async (clusterId, message) => {
      try {
        const { prisma: client } = await import("@dpf/db");
        const cluster = await client.founderDemandCluster.findUnique({ where: { clusterId }, include: { members: true } });
        if (!cluster) return { sent: true, queued: 0 };
        const { queueFounderDispositionNotices } = await import("@/lib/federation/demand-disposition");
        // Its own notice identity, so the peer does not dedupe it against the
        // cluster's original acceptance notice.
        const result = await queueFounderDispositionNotices(client as never, {
          clusterId: `${cluster.clusterId}:delivered`, decision: "accepted", message,
          members: cluster.members.map((member) => ({ originInstallationId: member.originInstallationId,
            envelopeId: member.envelopeId, mirrorRefs: member.mirrorRefs })),
        });
        return { sent: true, queued: result.queued };
      } catch (error) {
        return { sent: false, reason: "error", message: error instanceof Error ? error.message : "unknown error" };
      }
    },
    fileCorrective: async (args) => {
      const { fileAcceptanceMiss } = await import("@/lib/backlog/pr-submit-awaiting-acceptance");
      return fileAcceptanceMiss(args);
    },
    record: async (item, payload, summary) => {
      const { SUBMITTER_CONFIRMATION_ACTIVITY_KIND } = await import("./acceptance-sweep-page");
      await write((tx) => (tx as unknown as ConfirmationClient).backlogItemActivity.create({ data: {
        backlogItemId: item.id, kind: SUBMITTER_CONFIRMATION_ACTIVITY_KIND, summary: summary.slice(0, 500),
        payload, recordedByAgentId: agentId,
      } }));
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
  const leaseDb = db as unknown as SweepFenceDb<SweepDb & SweepLeaseClient>;
  const claim = await claimAcceptanceSweep(leaseDb, task.taskId);
  if (!claim) return;
  let renewalError: unknown = null;
  const heartbeat = setInterval(() => {
    void renewAcceptanceSweep(leaseDb, task.taskId, claim).catch(error => { renewalError = error; });
  }, 60_000);
  let failure: string | null = null;
  try {
    const summary = await run(productionAcceptanceSweepPorts(db, startedAt, agentId, task.taskId, claim), {
      pageSize: ACCEPTANCE_SWEEP_PAGE_SIZE,
      agedDays: ACCEPTANCE_AGED_DAYS,
      trendDays: ACCEPTANCE_TREND_DAYS,
      routing: ACCEPTANCE_SWEEP_ROUTING,
      routeLimit: ACCEPTANCE_SWEEP_ROUTE_LIMIT,
      recordedByAgentId: agentId,
    });
    if (renewalError) throw renewalError;
    console.info("[acceptance-sweep] %s", summary.headline);
  } catch (err) {
    failure = err instanceof Error ? err.message : "unknown error";
  } finally {
    clearInterval(heartbeat);
  }
  // Ownership loss refuses this write too. Never fall back to an unconditional
  // status/cadence update that could overwrite a recovered worker's progress.
  await finishAcceptanceSweep(leaseDb, task.taskId, claim, { startedAt, schedule: task.schedule, error: failure });
}
