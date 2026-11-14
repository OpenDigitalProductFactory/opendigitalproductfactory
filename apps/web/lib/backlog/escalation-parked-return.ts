// BI-5BF1D4D0 (EP-8717D32C) — work parked behind a build escalation comes back
// when the escalation resolves.
//
// escalateBuildToHuman parks the originating item as `deferred` with the trigger
// "The escalation is answered (PIR-x resolved) …". Nothing ever read that
// trigger back. The escalation itself resolves through several paths: the
// hygiene sweep (usually `originating-build-abandoned`, minutes after birth,
// because the escalation abandons its own build), the owner's dismiss action,
// or triage suppression. Each one left the item waiting on a condition that had
// already happened. On 2026-11-13, 136 items were stranded this way, including
// BI-2A8A8FC8, the most common cause of stuck PRs.
//
// This module reconciles from the ITEM's side rather than hooking each resolve
// call site, so a new resolve path cannot re-create the gap. It runs inside the
// escalation hygiene sweep (every 15 minutes, plus /ops and inbox renders), right
// after the sweep's own resolves:
//   - first stall on a cause      → re-open: clear the deferral, status_change row;
//   - repeated stall, same cause  → never straight back to `open` (that is the
//     loop: open → build → stall → escalate → resolve → open …). Hand it to the
//     repeated-stall router. The routeToHuman seam (BI-5E067004) replaces the
//     default by passing `routeRepeatedStall`; until then the default re-defers
//     with a fresh, attributable deferral whose trigger names the routing
//     decision, not a PIR;
//   - peer-owned mirror           → skipped; the origin installation owns status
//     and runs this same code (BI-C5794F1D).
// Every write is fenced on `status = deferred` AND the unchanged trigger, and it
// commits with its activity row in one transaction. Re-runs are no-ops, and a
// person re-deferring the item mid-sweep wins.

import { prisma } from "@dpf/db";
import {
  CLEAR_DEFERRAL_PROJECTION,
  normalizeDeferralInput,
  type NormalizedDeferral,
} from "@/lib/backlog/deferral-contract";
import { peerOwnedStatusRefusal } from "@/lib/backlog/peer-owned-item";
import { ISSUE_REPORT_STATUS } from "@/lib/quality/issue-report-status";

/** Escalation statuses that mean "the escalation is answered" for a parked item. */
export const RESOLVED_ESCALATION_STATUSES: readonly string[] = [
  ISSUE_REPORT_STATUS.RESOLVED_LOCALLY,
  ISSUE_REPORT_STATUS.RESOLVED_UPSTREAM,
  ISSUE_REPORT_STATUS.SUPPRESSED,
];

/** Backstop review window for a repeated-stall re-deferral (matches the escalation's own). */
export const REPEATED_STALL_REVIEW_DAYS = 14;

const ACTUATOR = "escalation-parked-return";
const REPORT_ID_RE = /\b(PIR-[A-Z0-9]+)\b/;

/** The escalation report a deferral trigger waits on, or null. Pure. */
export function extractEscalationReportId(trigger: string | null | undefined): string | null {
  if (!trigger) return null;
  return REPORT_ID_RE.exec(trigger)?.[1] ?? null;
}

export type ParkedItemDecision =
  | { kind: "reopen" }
  | { kind: "repeated-stall" }
  | { kind: "skip"; reason: "peer-owned" | "escalation-not-resolved" };

/**
 * What a resolved escalation means for the item it parked. Pure.
 * `priorSameCauseEscalations` counts EARLIER escalations of this item with the
 * same trigger kind (for example `plan-review-exhausted`), not counting the one
 * that just resolved.
 */
export function decideParkedItemReturn(input: {
  reportStatus: string;
  cause: string | null;
  priorSameCauseEscalations: number;
  peerOwned: boolean;
}): ParkedItemDecision {
  if (input.peerOwned) return { kind: "skip", reason: "peer-owned" };
  if (!RESOLVED_ESCALATION_STATUSES.includes(input.reportStatus)) {
    return { kind: "skip", reason: "escalation-not-resolved" };
  }
  if (input.priorSameCauseEscalations > 0) return { kind: "repeated-stall" };
  return { kind: "reopen" };
}

export type RepeatedStallContext = {
  /** BacklogItem.id (cuid). */
  backlogItemPk: string;
  /** BacklogItem.itemId (BI-*). */
  itemId: string;
  reportId: string;
  cause: string | null;
  priorSameCauseEscalations: number;
  ownerPrincipalId: string | null;
  now: Date;
};

export type RepeatedStallRoute =
  | { kind: "reopen"; decisionRef?: string }
  | { kind: "redefer"; deferral: NormalizedDeferral; decisionRef?: string };

export type RepeatedStallRouter = (ctx: RepeatedStallContext) => Promise<RepeatedStallRoute | null>;

/**
 * Default repeated-stall route until the routeToHuman seam (BI-5E067004) plugs
 * in. It keeps the item off the loop by re-deferring it with a fresh reason, a
 * trigger naming the routing decision (never a PIR, so the item is not an
 * orphan), a review date and the same accountable owner. Returns null with no
 * owner. A deferral without one is a disappearance, so the item stays put and
 * the invariant reports it.
 */
export const deferRepeatedStallPendingRouting: RepeatedStallRouter = async (ctx) => {
  if (!ctx.ownerPrincipalId) return null;
  const reviewAt = new Date(ctx.now.getTime() + REPEATED_STALL_REVIEW_DAYS * 24 * 60 * 60 * 1000);
  const cause = ctx.cause ?? "an unrecorded cause";
  const normalized = normalizeDeferralInput(
    {
      reason:
        `${ctx.itemId} stalled again on ${cause} (escalation ${ctx.reportId}, after ` +
        `${ctx.priorSameCauseEscalations} earlier escalation(s) on the same cause). ` +
        `Re-opening it would rebuild into the same stall, so it waits for a routing decision ` +
        `instead of looping.`,
      trigger:
        `A routeToHuman decision (BI-5E067004) is recorded for ${ctx.itemId}'s repeated ` +
        `${cause} stall — repair by an agent, independent review, or an owner answer.`,
      reviewAt: reviewAt.toISOString(),
      ownerPrincipalId: ctx.ownerPrincipalId,
    },
    ctx.now,
  );
  return normalized.ok ? { kind: "redefer", deferral: normalized.value } : null;
};

// ─── DB surface (structural, so the reconciler is testable without Postgres) ──

type ParkedItemRow = {
  id: string;
  itemId: string;
  status: string;
  body: string | null;
  deferTrigger: string | null;
  deferOwnerPrincipalId: string | null;
};

export type EscalationParkedReturnDb = {
  backlogItem: {
    findMany(args: { where: { status: string; deferTrigger: { contains: string } }; select?: unknown }): Promise<ParkedItemRow[]>;
    updateMany(args: { where: { id: string; status: string; deferTrigger: string }; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  platformIssueReport: {
    findMany(args: { where: { reportId: { in: string[] } }; select?: unknown }): Promise<Array<{ reportId: string; status: string; triggerKind: string | null }>>;
  };
  backlogItemActivity: {
    findMany(args: { where: { backlogItemId: { in: string[] }; kind: string }; select?: unknown }): Promise<Array<{ backlogItemId: string; payload: unknown }>>;
    create(args: { data: { backlogItemId: string; kind: string; summary: string; payload: Record<string, unknown> } }): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: EscalationParkedReturnDb) => Promise<T>): Promise<T>;
};

const defaultDb = (): EscalationParkedReturnDb => prisma as unknown as EscalationParkedReturnDb;

type Candidate = {
  item: ParkedItemRow & { deferTrigger: string };
  reportId: string;
  report: { status: string; triggerKind: string | null } | null;
  peerOwned: boolean;
};

async function loadCandidates(db: EscalationParkedReturnDb): Promise<Candidate[]> {
  const items = await db.backlogItem.findMany({
    where: { status: "deferred", deferTrigger: { contains: "PIR-" } },
    select: { id: true, itemId: true, status: true, body: true, deferTrigger: true, deferOwnerPrincipalId: true },
  });
  const parked = items.flatMap((item) => {
    const reportId = extractEscalationReportId(item.deferTrigger);
    return reportId && item.deferTrigger ? [{ item: { ...item, deferTrigger: item.deferTrigger }, reportId }] : [];
  });
  if (parked.length === 0) return [];

  const reports = await db.platformIssueReport.findMany({
    where: { reportId: { in: Array.from(new Set(parked.map((p) => p.reportId))) } },
    select: { reportId: true, status: true, triggerKind: true },
  });
  const reportById = new Map(reports.map((r) => [r.reportId, r]));

  return parked.map(({ item, reportId }) => ({
    item,
    reportId,
    report: reportById.get(reportId) ?? null,
    peerOwned: peerOwnedStatusRefusal(item.itemId, item.body) !== null,
  }));
}

/**
 * Locally owned deferred items whose named escalation has resolved. AC-1 is that
 * this count stays 0. Peer mirrors are excluded because the origin owns their
 * status and runs this same check.
 */
export async function countEscalationParkedOrphans(db: EscalationParkedReturnDb = defaultDb()): Promise<number> {
  const candidates = await loadCandidates(db);
  return candidates.filter(
    (c) => !c.peerOwned && c.report && RESOLVED_ESCALATION_STATUSES.includes(c.report.status),
  ).length;
}

/** Earlier escalations of each item, keyed by item pk, as escalation report ids. */
async function priorEscalationReportIds(
  db: EscalationParkedReturnDb,
  itemPks: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (itemPks.length === 0) return out;
  const rows = await db.backlogItemActivity.findMany({
    where: { backlogItemId: { in: itemPks }, kind: "status_change" },
    select: { backlogItemId: true, payload: true },
  });
  for (const row of rows) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const reportId = payload.escalationReportId;
    if (payload.to !== "deferred" || typeof reportId !== "string") continue;
    const list = out.get(row.backlogItemId) ?? [];
    if (!list.includes(reportId)) list.push(reportId);
    out.set(row.backlogItemId, list);
  }
  return out;
}

export type EscalationParkedReturnResult = {
  /** Deferred items whose trigger names an escalation report. */
  scanned: number;
  reopened: number;
  redeferred: number;
  /** Repeated stalls the router could not place (no owner); they stay counted by the invariant. */
  unrouted: number;
};

export async function reconcileEscalationParkedItems(opts: {
  db?: EscalationParkedReturnDb;
  now?: Date;
  routeRepeatedStall?: RepeatedStallRouter;
  /** Decide and count, but write nothing (operator preview for the one-time run). */
  dryRun?: boolean;
} = {}): Promise<EscalationParkedReturnResult> {
  const db = opts.db ?? defaultDb();
  const now = opts.now ?? new Date();
  const route = opts.routeRepeatedStall ?? deferRepeatedStallPendingRouting;

  const candidates = await loadCandidates(db);
  const actionable = candidates.filter(
    (c) => !c.peerOwned && c.report && RESOLVED_ESCALATION_STATUSES.includes(c.report.status),
  );
  const result: EscalationParkedReturnResult = { scanned: candidates.length, reopened: 0, redeferred: 0, unrouted: 0 };
  if (actionable.length === 0) return result;

  // The cause of each earlier escalation is its report's trigger kind.
  const priorByItem = await priorEscalationReportIds(db, actionable.map((c) => c.item.id));
  const priorReportIds = Array.from(new Set(Array.from(priorByItem.values()).flat()));
  const priorReports = priorReportIds.length
    ? await db.platformIssueReport.findMany({
        where: { reportId: { in: priorReportIds } },
        select: { reportId: true, status: true, triggerKind: true },
      })
    : [];
  const causeByReport = new Map(priorReports.map((r) => [r.reportId, r.triggerKind]));

  for (const c of actionable) {
    const cause = c.report!.triggerKind;
    const priorSameCauseEscalations = (priorByItem.get(c.item.id) ?? []).filter(
      (id) => id !== c.reportId && cause !== null && causeByReport.get(id) === cause,
    ).length;
    const decision = decideParkedItemReturn({
      reportStatus: c.report!.status,
      cause,
      priorSameCauseEscalations,
      peerOwned: c.peerOwned,
    });
    if (decision.kind === "skip") continue;

    let next: RepeatedStallRoute | null = { kind: "reopen" };
    if (decision.kind === "repeated-stall") {
      next = await route({
        backlogItemPk: c.item.id,
        itemId: c.item.itemId,
        reportId: c.reportId,
        cause,
        priorSameCauseEscalations,
        ownerPrincipalId: c.item.deferOwnerPrincipalId,
        now,
      }).catch(() => null);
      if (!next) {
        result.unrouted += 1;
        continue;
      }
    }

    const escalationReturn = {
      reportId: c.reportId,
      reportStatus: c.report!.status,
      cause,
      priorSameCauseEscalations,
      ...(next.decisionRef ? { decisionRef: next.decisionRef } : {}),
    };

    if (opts.dryRun) {
      if (next.kind === "reopen") result.reopened += 1;
      else result.redeferred += 1;
      continue;
    }

    try {
      const wrote = await db.$transaction(async (tx) => {
        if (next!.kind === "reopen") {
          const updated = await tx.backlogItem.updateMany({
            where: { id: c.item.id, status: "deferred", deferTrigger: c.item.deferTrigger },
            data: { status: "open", ...CLEAR_DEFERRAL_PROJECTION, updatedAt: now },
          });
          if (updated.count !== 1) return false;
          await tx.backlogItemActivity.create({
            data: {
              backlogItemId: c.item.id,
              kind: "status_change",
              summary: `deferred → open — escalation ${c.reportId} resolved; work returns to the pool`,
              payload: { from: "deferred", to: "open", actuator: ACTUATOR, escalationReturn },
            },
          });
          return true;
        }
        const deferral = next!.deferral;
        const updated = await tx.backlogItem.updateMany({
          where: { id: c.item.id, status: "deferred", deferTrigger: c.item.deferTrigger },
          data: { status: "deferred", deferredAt: now, updatedAt: now, ...deferral },
        });
        if (updated.count !== 1) return false;
        await tx.backlogItemActivity.create({
          data: {
            backlogItemId: c.item.id,
            kind: "status_change",
            summary: `deferred → deferred — repeated ${cause ?? "stall"} after ${c.reportId}; awaits a routing decision`,
            payload: {
              from: "deferred",
              to: "deferred",
              actuator: ACTUATOR,
              escalationReturn,
              deferral: {
                reason: deferral.deferReason,
                trigger: deferral.deferTrigger,
                reviewAt: deferral.deferReviewAt.toISOString(),
                ownerPrincipalId: deferral.deferOwnerPrincipalId,
              },
            },
          },
        });
        return true;
      });
      if (!wrote) continue;
      if (next.kind === "reopen") result.reopened += 1;
      else result.redeferred += 1;
    } catch (err) {
      // Best-effort per item: one failure must not strand the rest. The invariant
      // count reports anything left behind.
      if (process.env.NODE_ENV !== "test") {
        console.error(`[escalation-parked-return] ${c.item.itemId} not re-evaluated`, err);
      }
    }
  }

  return result;
}
