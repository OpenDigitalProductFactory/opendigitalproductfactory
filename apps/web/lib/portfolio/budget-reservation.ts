// Budget reservations (BI-EF265C9A, design §5.4). Funding approval reserves an
// item's points against its portfolio's budget for the current quarter; the
// item reaching done consumes them; retire or defer releases them; a re-size
// adjusts them and says so.
//
// - planFundingReservation decides before funding, and writes nothing. An
//   autonomous caller is refused over the allocation; a person may proceed only
//   with a recorded override reason.
// - commitFundingReservation writes the reservation after funding succeeds.
// - settleBudgetReservations derives each open reservation's state from its
//   item's current status. It is idempotent and runs on a schedule, so no status
//   writer can leave a reservation stale; the status tools also call it at once.
//
// Spec: docs/superpowers/specs/2026-09-24-portfolio-budget-and-investment-wip-design.md

import { resolveBacklogItemPortfolio, type BacklogPortfolioClient } from "@dpf/db/backlog-portfolio";

import { quarterBounds, resolveInvestmentPoints } from "./investment-points";
import { loadPortfolioBudgets, type Period } from "./portfolio-budget";

type ReadDb = { $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T> };

/** A caller running inside a background task, or an agent with no person's session behind it, is autonomous. Shared by funding (BI-EF265C9A) and admission (BI-3430B3A4). */
export function isAutonomousCaller(context?: {
  taskRunId?: string;
  agentId?: string;
  threadId?: string;
  apiTokenId?: string;
}): boolean {
  if (!context) return false;
  if (context.taskRunId) return true;
  return Boolean(context.agentId) && !context.threadId && !context.apiTokenId;
}

export type ReservationPlan =
  | { kind: "reserve"; backlogItemRowId: string; portfolioId: string; period: Period; points: number; overrideReason: string | null; warning: string | null }
  | { kind: "none"; reason: "unsized" | "unallocated" | "already-reserved"; message: string }
  | { kind: "refuse"; code: "over_budget_autonomous" | "over_budget_reason_required"; message: string };

type PlanDb = ReadDb & BacklogPortfolioClient & {
  portfolio: { findUnique: (args: unknown) => Promise<{ id: string } | null> };
};

export async function planFundingReservation(db: PlanDb, input: {
  itemId: string;
  now: Date;
  autonomous: boolean;
  overrideReason?: string | null;
}): Promise<ReservationPlan> {
  const [item] = await db.$queryRaw<Array<{ id: string; effortSize: string | null; jobSize: number | null; estimateAgreed: boolean | null; open: boolean }>>`
    SELECT b."id", b."effortSize", b."jobSize", b."estimateAgreed",
           EXISTS (SELECT 1 FROM "BudgetReservation" r WHERE r."backlogItemId" = b."id" AND r."state" = 'reserved') AS "open"
      FROM "BacklogItem" b WHERE b."itemId" = ${input.itemId}
  `;
  if (!item) return { kind: "none", reason: "unallocated", message: `Item ${input.itemId} not found.` };
  if (item.open) return { kind: "none", reason: "already-reserved", message: "This item already holds a reservation; it is not counted twice." };
  const { points } = resolveInvestmentPoints({ ...item, jobSize: item.jobSize === null ? null : Number(item.jobSize) });
  if (points === null) {
    return { kind: "none", reason: "unsized", message: "The item has no size, so no points were reserved. Size it and the next approval reserves them." };
  }
  const resolution = await resolveBacklogItemPortfolio(input.itemId, { db });
  const portfolioId = resolution?.portfolioId ?? null;
  if (!portfolioId || !(await db.portfolio.findUnique({ where: { id: portfolioId }, select: { id: true } }))) {
    return { kind: "none", reason: "unallocated", message: "The item reaches no portfolio, so no budget can carry its points. Attribute it to reserve them." };
  }

  const period = quarterBounds(input.now);
  const budget = (await loadPortfolioBudgets(db, period)).find((b) => b.id === portfolioId)?.budget ?? null;
  const base = { kind: "reserve" as const, backlogItemRowId: item.id, portfolioId, period, points };
  if (!budget) {
    return { ...base, overrideReason: null, warning: "No budget is set for this portfolio this quarter; the points are reserved against it anyway." };
  }
  const [committed] = await db.$queryRaw<Array<{ points: number | string | null }>>`
    SELECT COALESCE(SUM(r."points"), 0) AS "points" FROM "BudgetReservation" r
     WHERE r."portfolioId" = ${portfolioId} AND r."periodStart" = ${period.start} AND r."state" IN ('reserved', 'consumed')
  `;
  const after = Number(committed?.points ?? 0) + points;
  if (after <= budget.allocatedPoints) return { ...base, overrideReason: null, warning: null };
  const over = `This approval takes the portfolio to ${after} of ${budget.allocatedPoints} points this quarter (${after - budget.allocatedPoints} over).`;
  if (input.autonomous) {
    return { kind: "refuse", code: "over_budget_autonomous", message: `${over} An autonomous approval cannot exceed the allocation; a person can approve it with a reason.` };
  }
  const overrideReason = input.overrideReason?.trim() || null;
  if (!overrideReason) {
    return { kind: "refuse", code: "over_budget_reason_required", message: `${over} To approve anyway, give an overrideReason; it is recorded with the reservation.` };
  }
  return { ...base, overrideReason, warning: over };
}

type CommitDb = {
  agent: { findUnique: (args: unknown) => Promise<{ agentId: string } | null> };
  budgetReservation: { create: (args: unknown) => Promise<{ id: string }> };
};

export async function commitFundingReservation(
  db: CommitDb,
  plan: Extract<ReservationPlan, { kind: "reserve" }>,
  actor: { userId: string | null; agentId?: string | null },
): Promise<{ reservationId: string }> {
  const actorAgentId = actor.agentId
    ? (await db.agent.findUnique({ where: { agentId: actor.agentId }, select: { agentId: true } }))?.agentId ?? null
    : null;
  const created = await db.budgetReservation.create({
    data: {
      backlogItemId: plan.backlogItemRowId,
      portfolioId: plan.portfolioId,
      periodStart: plan.period.start,
      periodEnd: plan.period.end,
      points: plan.points,
      overrideReason: plan.overrideReason,
      actorId: actor.userId,
      actorAgentId,
    },
    select: { id: true },
  });
  return { reservationId: created.id };
}

const CONSUMED_STATUSES = new Set(["done"]);
const RELEASED_STATUSES = new Set(["retired", "deferred"]);

export type SettlementAction =
  | { kind: "consume" | "release"; reservationId: string }
  | { kind: "resize"; reservationId: string; from: number; to: number }
  | { kind: "keep"; reservationId: string };

/** What an open reservation should become, given its item's current status and size. Pure. */
export function settlementFor(row: {
  reservationId: string;
  points: number;
  status: string;
  effortSize: string | null;
  jobSize: number | null;
  estimateAgreed: boolean | null;
}): SettlementAction {
  if (CONSUMED_STATUSES.has(row.status)) return { kind: "consume", reservationId: row.reservationId };
  if (RELEASED_STATUSES.has(row.status)) return { kind: "release", reservationId: row.reservationId };
  const { points } = resolveInvestmentPoints(row);
  if (points !== null && points !== row.points) return { kind: "resize", reservationId: row.reservationId, from: row.points, to: points };
  return { kind: "keep", reservationId: row.reservationId };
}

type SettleDb = ReadDb & {
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
};

/** Settle open reservations against their items' current status. Idempotent. */
export async function settleBudgetReservations(
  db: SettleDb,
  options: { itemIds?: string[]; limit?: number; now?: Date } = {},
): Promise<{ consumed: number; released: number; resized: number; kept: number }> {
  const itemFilter = options.itemIds ?? null;
  const rows = await db.$queryRaw<Array<{ reservationId: string; backlogItemId: string; points: number; status: string; effortSize: string | null; jobSize: number | null; estimateAgreed: boolean | null }>>`
    SELECT r."id" AS "reservationId", r."backlogItemId", r."points", b."status", b."effortSize", b."jobSize", b."estimateAgreed"
      FROM "BudgetReservation" r JOIN "BacklogItem" b ON b."id" = r."backlogItemId"
     WHERE r."state" = 'reserved' AND (${itemFilter}::text[] IS NULL OR b."itemId" = ANY(${itemFilter}::text[]))
     ORDER BY r."createdAt"
     LIMIT ${options.limit ?? 500}
  `;
  const now = options.now ?? new Date();
  const counts = { consumed: 0, released: 0, resized: 0, kept: 0 };
  for (const row of rows) {
    const action = settlementFor({ ...row, jobSize: row.jobSize === null ? null : Number(row.jobSize) });
    if (action.kind === "consume" || action.kind === "release") {
      const state = action.kind === "consume" ? "consumed" : "released";
      await db.$executeRaw`UPDATE "BudgetReservation" SET "state" = ${state}::"BudgetReservationState", "settledAt" = ${now} WHERE "id" = ${action.reservationId} AND "state" = 'reserved'`;
      counts[action.kind === "consume" ? "consumed" : "released"]++;
    } else if (action.kind === "resize") {
      await db.$executeRaw`UPDATE "BudgetReservation" SET "points" = ${action.to} WHERE "id" = ${action.reservationId} AND "state" = 'reserved'`;
      await db.$executeRaw`
        INSERT INTO "BacklogItemActivity" ("id", "backlogItemId", "kind", "summary", "payload", "recordedAt")
        VALUES (${`budget-resize-${action.reservationId}-${now.getTime()}`}, ${row.backlogItemId}, 'budget_reservation_resized',
                ${`Budget reservation re-sized from ${action.from} to ${action.to} points`},
                ${JSON.stringify({ reservationId: action.reservationId, from: action.from, to: action.to })}::jsonb, ${now})`;
      counts.resized++;
    } else {
      counts.kept++;
    }
  }
  return counts;
}

/** Reserved and consumed points per portfolio for a period, straight from the rows (AC-3). */
export async function loadReservationTotals(db: ReadDb, period: Period): Promise<Array<{ portfolioId: string; reserved: number; consumed: number; released: number }>> {
  const rows = await db.$queryRaw<Array<{ portfolioId: string; state: string; points: number | string }>>`
    SELECT r."portfolioId", r."state"::text AS "state", SUM(r."points") AS "points"
      FROM "BudgetReservation" r WHERE r."periodStart" = ${period.start}
     GROUP BY r."portfolioId", r."state"
  `;
  const totals = new Map<string, { portfolioId: string; reserved: number; consumed: number; released: number }>();
  for (const row of rows) {
    const t = totals.get(row.portfolioId) ?? { portfolioId: row.portfolioId, reserved: 0, consumed: 0, released: 0 };
    if (row.state === "reserved" || row.state === "consumed" || row.state === "released") t[row.state] += Number(row.points);
    totals.set(row.portfolioId, t);
  }
  return [...totals.values()];
}
