import { BUILD_DELIVERY_ACTUATOR } from "@/lib/build/build-acceptance-entry";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";

import type { OwedAcceptance } from "./owed-acceptance";
import type { CloseOutcome } from "./acceptance-sweep-close";
import type { CloseAuthorisation, CloseDisabledReason } from "./close-authorisation";
import { summarizePoolAge, type AcceptancePoolAges, type AcceptancePoolAgeSummary } from "./acceptance-pool-age";
import type { AcceptanceSweepPage, AcceptanceSweepPageItem } from "./acceptance-sweep-page";
import {
  emptyRouting,
  foldRouteOutcomes,
  isRoutingCandidate,
  routingHeadline,
  type AcceptanceSweepRouting,
  type AgedSweepCandidate,
} from "./acceptance-sweep-routing";
import type { RouteOutcome } from "./route-aged-item";
import type { ConfirmationStep } from "./submitter-confirmation";

// One acceptance sweep run (BI-DF255666, AC-S2-2 and AC-S2-3).
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.3.
// Plan:   docs/superpowers/plans/2026-09-24-acceptance-accountability-plan.md, phase 2.
//
// Level-triggered reconcile with bounded work per pass: measure the pool's age
// (cheap, whole pool), evaluate readiness for one page, record the owed
// projection where it changed, and write one summary. Every I/O step is a port
// so the run is tested without a database; acceptance-sweep-task.ts binds them.
//
// Closing (BI-45D3BBF4): an item whose completion verdict is already
// "allowed" is closed through the terminal transition, and only when a
// recorded operator pre-authorisation is in force, at most `limit` per run.
// The transition re-checks its own gate, so the sweep relaxes nothing; with no
// authorisation it closes nothing and the summary says why.
//
// Routing (BI-C1781121, design §3.4): with routing on, the aged page items that
// are not closable go to `route` after the page is evaluated, which gives each
// one with a resolved in-platform owner a steward Workroom, oldest first and
// at most `routeLimit` new rooms per run (acceptance-sweep-routing.ts). A
// routing failure is recorded in the summary and does not lose the run.

export type AcceptanceSweepConfig = {
  pageSize: number;
  agedDays: number;
  trendDays: number;
  routing: boolean;
  /** Steward rooms created per run at most (ACCEPTANCE_SWEEP_ROUTE_LIMIT). */
  routeLimit: number;
  recordedByAgentId: string;
};

/** The owed projection, with the completion decision it was computed from. */
export type SweepEvaluation = OwedAcceptance & { decision?: InitiativeReadinessDecision };

export type AcceptanceSweepPorts = {
  now: Date;
  loadPoolAges(): Promise<AcceptancePoolAges>;
  /** The cursor the previous run recorded, or null on the first run. */
  loadLastCursor(): Promise<string | null>;
  selectPage(args: { pageSize: number; cursor: string | null }): Promise<AcceptanceSweepPage>;
  /** The item's owed projection, or null when its readiness cannot be computed. */
  evaluate(item: AcceptanceSweepPageItem): Promise<SweepEvaluation | null>;
  /** The operator pre-authorisation in force for this run, checked against current state. */
  resolveCloseAuthorisation(): Promise<CloseAuthorisation>;
  /** Close one item through the governed terminal transition. */
  close(
    item: AcceptanceSweepPageItem,
    decision: InitiativeReadinessDecision,
    authorisation: Extract<CloseAuthorisation, { state: "enabled" }>,
  ): Promise<CloseOutcome>;
  recordSnapshot(item: AcceptanceSweepPageItem, projection: OwedAcceptance): Promise<{ written: boolean }>;
  /**
   * BI-C899BB40: advance a done item's bounded obligation one step (ask its
   * customer submitter once, observe the answer, or retire it). Done items are
   * never re-evaluated for acceptance. Absent, done items are only counted.
   */
  confirm?(item: AcceptanceSweepPageItem): Promise<ConfirmationStep>;
  /** Route the run's aged, non-closable items to their coworkers (route-aged-item.ts). */
  route(candidates: readonly AgedSweepCandidate[], limit: number): Promise<RouteOutcome[]>;
  recordRun(summary: AcceptanceSweepSummary): Promise<{ activityId: string }>;
};

export type AcceptanceSweepSummary = {
  schemaVersion: 1;
  ranAt: string;
  headline: string;
  /** The whole awaiting-acceptance pool, by age from state entry. */
  pool: AcceptancePoolAgeSummary;
  /** The page this run evaluated. */
  page: {
    pageSize: number;
    evaluated: number;
    unsnapshotted: number;
    snapshotsWritten: number;
    readinessUnavailable: number;
    closable: number;
    owned: number;
    unroutableItems: number;
    unroutableByCode: Record<string, number>;
    unroutableByReason: Record<string, number>;
    ageBasisCreated: number;
    aged: number;
    agedOverTrend: number;
  };
  /** Page item ids, bounded by the page size. */
  items: {
    closable: string[];
    aged: string[];
    unroutable: string[];
    readinessUnavailable: string[];
  };
  /** Design §7: the revisit period, stated so a pool past the ceiling stays visible. */
  revisit: { poolSize: number; pageSize: number; runsPerRevisit: number; exceedsTrendWindow: boolean };
  /** BI-C1781121: aged items routed to an in-platform coworker's steward room. */
  routing: AcceptanceSweepRouting;
  /** BI-45D3BBF4: closures made under the operator pre-authorisation. */
  closing: AcceptanceSweepClosing;
  /** BI-C899BB40: done items whose one bounded post-delivery step was advanced. */
  confirmation: AcceptanceSweepConfirmation;
  /**
   * BI-C5794F1D: obligations not evaluated or closed because a peer
   * installation owns them (work-sync mirrors). Only the origin may change them.
   */
  peerOwned: { skipped: number };
  cursor: string | null;
};

export type AcceptanceSweepConfirmation = {
  visited: number;
  /** Steps taken this run, by step (question-sent, not-fixed, satisfied-by-silence, ...). */
  steps: Record<string, number>;
  /** Why a question was not sent (no-credential, no-channel, error). */
  notSentByReason: Record<string, number>;
  /** Corrective items filed this run (a "not fixed" answer or a failed acceptance). */
  correctiveItemIds: string[];
  errored: Array<{ itemId: string; message: string }>;
};

export type AcceptanceSweepClosing = {
  enabled: boolean;
  /** Why nothing was closed, when closing is off. */
  disabledReason: CloseDisabledReason | null;
  because: string | null;
  /** Who recorded the pre-authorisation the closures acted under, and when. */
  authorisedBy: { userId: string; at: string } | null;
  limit: number;
  attempted: number;
  closed: string[];
  refused: Array<{ itemId: string; code: string }>;
  skipped: Array<{ itemId: string; reason: string }>;
  errored: Array<{ itemId: string; message: string }>;
  /** Closable items left for a later run because the bound was reached. */
  deferredByLimit: string[];
};

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function headline(summary: Omit<AcceptanceSweepSummary, "headline">, agedDays: number): string {
  const { pool, page } = summary;
  return [
    `Acceptance sweep: ${pool.size} acceptance obligations, ${pool.aged} aged ${agedDays}+ days`,
    `${pool.agedOverTrend} over ${pool.trendDays} days`,
    `${pool.ageBasisCreated} aged from creation (no entry record)`,
    ...(summary.peerOwned.skipped > 0 ? [`${summary.peerOwned.skipped} skipped: owned by peer installation`] : []),
    `page of ${page.evaluated}: ${page.snapshotsWritten} changed, ${page.closable} closable, ${page.owned} with an owner, ${page.unroutableItems} unroutable`,
    summary.closing.enabled
      ? `${summary.closing.closed.length} closed under operator pre-authorisation`
      : `closing off (${summary.closing.disabledReason})`,
    routingHeadline(summary.routing),
    ...(summary.confirmation.visited > 0
      ? [`${summary.confirmation.visited} delivered items advanced (${summary.confirmation.steps["question-sent"] ?? 0} asked, `
        + `${summary.confirmation.correctiveItemIds.length} corrective)`]
      : []),
  ].join("; ").slice(0, 500);
}

function deliveredBuildEntry(item: { activities?: Array<{ kind: string; payload: unknown }> }): boolean {
  const payload = item.activities?.find((row) => row.kind === "status_change")?.payload;
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload)
    && (payload as Record<string, unknown>).actuator === BUILD_DELIVERY_ACTUATOR
    && (payload as Record<string, unknown>).to === "awaiting-acceptance");
}

export async function runAcceptanceSweep(
  ports: AcceptanceSweepPorts,
  config: AcceptanceSweepConfig,
): Promise<AcceptanceSweepSummary> {
  const ages = await ports.loadPoolAges();
  const pool = summarizePoolAge(ages.values(), { agedDays: config.agedDays, trendDays: config.trendDays });

  const cursor = await ports.loadLastCursor();
  const selected = await ports.selectPage({ pageSize: config.pageSize, cursor });
  const items = selected.items.slice(0, Math.max(0, config.pageSize));
  const nextCursor = items.length === selected.items.length
    ? selected.nextCursor
    : cursorWithin(items.slice(selected.unsnapshotted), cursor);

  const page: AcceptanceSweepSummary["page"] = {
    pageSize: config.pageSize,
    evaluated: items.length,
    unsnapshotted: Math.min(selected.unsnapshotted, items.length),
    snapshotsWritten: 0,
    readinessUnavailable: 0,
    closable: 0,
    owned: 0,
    unroutableItems: 0,
    unroutableByCode: {},
    unroutableByReason: {},
    ageBasisCreated: 0,
    aged: 0,
    agedOverTrend: 0,
  };
  const listed: AcceptanceSweepSummary["items"] = { closable: [], aged: [], unroutable: [], readinessUnavailable: [] };

  const authorisation = await ports.resolveCloseAuthorisation().catch((error: unknown): CloseAuthorisation => ({
    state: "disabled",
    reason: "unavailable",
    because: `The pre-authorisation could not be read: ${error instanceof Error ? error.message : "unknown error"}`,
  }));
  const closing: AcceptanceSweepClosing = {
    enabled: authorisation.state === "enabled",
    disabledReason: authorisation.state === "disabled" ? authorisation.reason : null,
    because: authorisation.state === "disabled" ? authorisation.because : null,
    authorisedBy: authorisation.state === "enabled" ? { userId: authorisation.setByUserId, at: authorisation.setAt } : null,
    limit: authorisation.state === "enabled" ? Math.min(authorisation.limit, Math.max(0, config.pageSize)) : 0,
    attempted: 0,
    closed: [],
    refused: [],
    skipped: [],
    errored: [],
    deferredByLimit: [],
  };

  const confirmation: AcceptanceSweepConfirmation = { visited: 0, steps: {}, notSentByReason: {}, correctiveItemIds: [], errored: [] };
  const routing = emptyRouting(config.routing, config.routeLimit);
  const agedCandidates: AgedSweepCandidate[] = [];

  for (const item of items) {
    const itemAge = ages.get(item.id);
    if (itemAge) {
      if (itemAge.ageBasis === "created") page.ageBasisCreated += 1;
      if (itemAge.ageDays >= config.agedDays) {
        page.aged += 1;
        listed.aged.push(item.itemId);
      }
      if (itemAge.ageDays > config.trendDays) page.agedOverTrend += 1;
    }

    // BI-C899BB40: a done item is never re-evaluated for acceptance. Its
    // closure left one bounded step (a customer question, a corrective item,
    // or a recorded retirement); take it and move on.
    if (item.status === "done") {
      confirmation.visited += 1;
      if (!ports.confirm) { increment(confirmation.steps, "skipped"); continue; }
      try {
        const step = await ports.confirm(item);
        increment(confirmation.steps, step.step);
        if (step.step === "question-not-sent") increment(confirmation.notSentByReason, step.reason);
        if ((step.step === "not-fixed" || step.step === "corrective-filed") && step.correctiveItemId) {
          confirmation.correctiveItemIds.push(step.correctiveItemId);
        }
      } catch (error) {
        confirmation.errored.push({ itemId: item.itemId, message: (error instanceof Error ? error.message : "unknown error").slice(0, 300) });
      }
      continue;
    }

    const projection = await ports.evaluate(item).catch(() => null);
    if (!projection) {
      page.readinessUnavailable += 1;
      listed.readinessUnavailable.push(item.itemId);
      continue;
    }
    const snapshot = await ports.recordSnapshot(item, projection);
    if (snapshot.written) page.snapshotsWritten += 1;
    if (projection.closable) {
      page.closable += 1;
      listed.closable.push(item.itemId);
      await closeIfAuthorised(item, projection, authorisation, closing, ports);
    }
    // BI-729D9B27: a build-originated item whose change is proven live routes at
    // once; the aged-item wait is for acceptance nobody owns, and this one has none.
    if (isRoutingCandidate(itemAge?.ageDays, deliveredBuildEntry(item) ? 0 : config.agedDays, projection)) {
      agedCandidates.push({ item, ageDays: itemAge!.ageDays, projection });
    }
    if (projection.owner) page.owned += 1;
    if (projection.unroutable.length > 0) {
      page.unroutableItems += 1;
      listed.unroutable.push(item.itemId);
      for (const entry of projection.unroutable) {
        increment(page.unroutableByCode, entry.code);
        increment(page.unroutableByReason, entry.reason);
      }
    }
  }

  if (routing.enabled && agedCandidates.length > 0) {
    routing.candidates = agedCandidates.length;
    try {
      foldRouteOutcomes(routing, await ports.route(agedCandidates, routing.routeLimit));
    } catch (error) {
      routing.error = (error instanceof Error ? error.message : "unknown error").slice(0, 300);
    }
  }

  const candidatePoolSize = ages.candidateCount ?? pool.size;
  const runsPerRevisit = config.pageSize > 0 ? Math.ceil(candidatePoolSize / config.pageSize) : 0;
  const withoutHeadline: Omit<AcceptanceSweepSummary, "headline"> = {
    schemaVersion: 1,
    ranAt: ports.now.toISOString(),
    pool,
    page,
    items: listed,
    // The sweep runs daily, so runs per revisit is also the revisit period in days.
    revisit: {
      poolSize: candidatePoolSize,
      pageSize: config.pageSize,
      runsPerRevisit,
      exceedsTrendWindow: runsPerRevisit > config.trendDays,
    },
    routing,
    closing,
    confirmation,
    peerOwned: { skipped: ages.peerOwnedSkipped ?? 0 },
    cursor: nextCursor,
  };
  const summary: AcceptanceSweepSummary = { ...withoutHeadline, headline: headline(withoutHeadline, config.agedDays) };
  await ports.recordRun(summary);
  return summary;
}

/**
 * Close one closable item when the pre-authorisation is in force and the bound
 * allows. Only a decision whose own verdict is "allowed" is ever passed on.
 */
async function closeIfAuthorised(
  item: AcceptanceSweepPageItem,
  evaluation: SweepEvaluation,
  authorisation: CloseAuthorisation,
  closing: AcceptanceSweepClosing,
  ports: AcceptanceSweepPorts,
): Promise<void> {
  if (authorisation.state !== "enabled") return;
  const decision = evaluation.decision;
  if (!evaluation.closable || decision?.verdict !== "allowed") return;
  if (closing.attempted >= closing.limit) {
    closing.deferredByLimit.push(item.itemId);
    return;
  }
  closing.attempted += 1;
  try {
    const outcome = await ports.close(item, decision, authorisation);
    if (outcome.outcome === "closed") closing.closed.push(item.itemId);
    else if (outcome.outcome === "refused") closing.refused.push({ itemId: item.itemId, code: outcome.code });
    else closing.skipped.push({ itemId: item.itemId, reason: outcome.reason });
  } catch (error) {
    closing.errored.push({ itemId: item.itemId, message: (error instanceof Error ? error.message : "unknown error").slice(0, 300) });
  }
}

/** When the page was truncated, the cursor is the last snapshotted item actually evaluated. */
function cursorWithin(revisited: AcceptanceSweepPageItem[], previous: string | null): string | null {
  return revisited.length > 0 ? revisited[revisited.length - 1]!.id : previous;
}
