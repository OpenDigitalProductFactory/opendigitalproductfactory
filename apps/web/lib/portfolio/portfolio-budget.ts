// Quarterly portfolio budgets in investment points (BI-9EC60FE0, design §5.3).
//
// - A proposal derives next period's allocations from the previous quarter's
//   delivered points per portfolio, and says how much delivery it could not
//   place. It never applies itself.
// - A budget is set only through setPortfolioBudget: a person, a reason, and a
//   new row that supersedes the current one. Rows are never edited.
// - A portfolio with no row has no budget set; that is never shown as zero.
//
// Spec: docs/superpowers/specs/2026-09-24-portfolio-budget-and-investment-wip-design.md

import { ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";

import { quarterBounds } from "./investment-points";
import { loadInvestmentItems, summarizePortfolioInvestment } from "./investment-read-model";

type ReadDb = { $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T> };

export type Period = { start: Date; end: Date };

/** The quarter before the one that contains `period.start`. */
export function previousQuarter(period: Period): Period {
  return quarterBounds(new Date(period.start.getTime() - 1));
}

type PortfolioRow = { id: string; slug: string; name: string };

async function loadPortfolios(db: ReadDb): Promise<PortfolioRow[]> {
  return db.$queryRaw<PortfolioRow[]>`SELECT "id", "slug", "name" FROM "Portfolio" ORDER BY "slug"`;
}

export type PortfolioBudgetProposal = {
  targetPeriod: Period;
  basisPeriod: Period;
  rows: Array<PortfolioRow & { deliveredPoints: number; proposedPoints: number; share: number }>;
  /** Points delivered in the basis quarter that reach no portfolio, so no budget can carry them. */
  unallocatedDeliveredPoints: number;
  totalDeliveredPoints: number;
};

/**
 * Propose `target`'s budgets as the basis quarter's delivered points per
 * portfolio: the delivered mix, at the delivered scale. A person accepts or
 * edits each figure through setPortfolioBudget.
 */
export async function proposePortfolioBudgets(db: ReadDb, target: Period): Promise<PortfolioBudgetProposal> {
  const basisPeriod = previousQuarter(target);
  const summary = summarizePortfolioInvestment(await loadInvestmentItems(db, basisPeriod), basisPeriod.start);
  const delivered = new Map(summary.rows.map((row) => [row.portfolioId, row.deliveredPoints]));
  const portfolios = await loadPortfolios(db);
  const allocated = portfolios.reduce((sum, p) => sum + (delivered.get(p.id) ?? 0), 0);
  const unallocatedDeliveredPoints = delivered.get(null) ?? 0;
  return {
    targetPeriod: target,
    basisPeriod,
    rows: portfolios.map((p) => {
      const deliveredPoints = delivered.get(p.id) ?? 0;
      return {
        ...p,
        deliveredPoints,
        proposedPoints: deliveredPoints,
        share: allocated > 0 ? Math.round((deliveredPoints / allocated) * 1000) / 1000 : 0,
      };
    }),
    unallocatedDeliveredPoints,
    totalDeliveredPoints: allocated + unallocatedDeliveredPoints,
  };
}

export type PortfolioBudget = {
  id: string;
  allocatedPoints: number;
  usdPerPoint: number | null;
  wipAllowancePoints: number | null;
  setById: string;
  setByAgentId: string | null;
  reason: string;
  supersedesId: string | null;
  createdAt: Date;
};

export type PortfolioBudgetStatus = PortfolioRow & {
  /** null means no budget set for this period — never read as zero. */
  budget: PortfolioBudget | null;
};

/** Every portfolio with its current budget for the period, or null when none is set. */
export async function loadPortfolioBudgets(db: ReadDb, period: Period): Promise<PortfolioBudgetStatus[]> {
  const rows = await db.$queryRaw<Array<PortfolioBudget & { portfolioId: string; usdPerPoint: string | number | null }>>`
    SELECT b."id", b."portfolioId", b."allocatedPoints", b."usdPerPoint", b."wipAllowancePoints",
           b."setById", b."setByAgentId", b."reason", b."supersedesId", b."createdAt"
      FROM "PortfolioBudgetPeriod" b
     WHERE b."periodStart" = ${period.start}
       AND NOT EXISTS (SELECT 1 FROM "PortfolioBudgetPeriod" n WHERE n."supersedesId" = b."id")
  `;
  const current = new Map(rows.map((row) => [row.portfolioId, row]));
  return (await loadPortfolios(db)).map((p) => {
    const row = current.get(p.id);
    if (!row) return { ...p, budget: null };
    const { portfolioId: _portfolioId, ...budget } = row;
    return { ...p, budget: { ...budget, usdPerPoint: row.usdPerPoint === null ? null : Number(row.usdPerPoint) } };
  });
}

/** The label a surface shows for a portfolio's budget. A missing budget never reads as 0. */
export function portfolioBudgetLabel(budget: PortfolioBudget | null): string {
  if (!budget) return "No budget set";
  const points = `${budget.allocatedPoints.toLocaleString("en-US")} points`;
  if (budget.usdPerPoint === null) return points;
  const usd = (budget.allocatedPoints * budget.usdPerPoint).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return `${points} (${usd} at $${budget.usdPerPoint}/point)`;
}

export type SetPortfolioBudgetInput = {
  portfolioId: string;
  period: Period;
  allocatedPoints: number;
  usdPerPoint?: number | null;
  wipAllowancePoints?: number | null;
  reason: string;
  actor: { userId: string | null; agentId?: string | null };
};

export type SetPortfolioBudgetRefusal =
  | "reason_required" | "actor_required" | "invalid_points" | "invalid_rate" | "invalid_allowance" | "unknown_portfolio" | "period_not_a_quarter" | "concurrent_change";

export type SetPortfolioBudgetResult =
  | ActionSuccess<{ budgetId: string; supersedesId: string | null }>
  | (ActionFailure & { error: SetPortfolioBudgetRefusal; message: string });

function refuse(error: SetPortfolioBudgetRefusal, message: string): SetPortfolioBudgetResult {
  return { ok: false, error, message };
}

type WriteDb = ReadDb & {
  portfolio: { findUnique: (args: unknown) => Promise<{ id: string } | null> };
  agent: { findUnique: (args: unknown) => Promise<{ agentId: string } | null> };
  portfolioBudgetPeriod: { create: (args: unknown) => Promise<{ id: string }> };
};

const isNonNegativeInteger = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/** The governed write. A change inserts a row that supersedes the current one. */
export async function setPortfolioBudget(db: WriteDb, input: SetPortfolioBudgetInput): Promise<SetPortfolioBudgetResult> {
  const reason = input.reason.trim();
  if (!reason) return refuse("reason_required", "Say why this budget is right; the reason is recorded with it.");
  if (!input.actor.userId) return refuse("actor_required", "A portfolio budget is set by a person. No person is attached to this request.");
  if (!isNonNegativeInteger(input.allocatedPoints)) return refuse("invalid_points", "allocatedPoints must be a whole number of points, zero or more.");
  if (input.usdPerPoint != null && !(typeof input.usdPerPoint === "number" && input.usdPerPoint > 0)) {
    return refuse("invalid_rate", "usdPerPoint, when given, must be a positive number.");
  }
  if (input.wipAllowancePoints != null && !isNonNegativeInteger(input.wipAllowancePoints)) {
    return refuse("invalid_allowance", "wipAllowancePoints, when given, must be a whole number of points, zero or more.");
  }
  const quarter = quarterBounds(input.period.start);
  if (quarter.start.getTime() !== input.period.start.getTime() || quarter.end.getTime() !== input.period.end.getTime()) {
    return refuse("period_not_a_quarter", "Budgets are quarterly; the period must be one whole calendar quarter (UTC).");
  }
  if (!(await db.portfolio.findUnique({ where: { id: input.portfolioId }, select: { id: true } }))) {
    return refuse("unknown_portfolio", `Portfolio ${input.portfolioId} does not exist.`);
  }
  const setByAgentId = input.actor.agentId
    ? (await db.agent.findUnique({ where: { agentId: input.actor.agentId }, select: { agentId: true } }))?.agentId ?? null
    : null;
  const [current] = await db.$queryRaw<Array<{ id: string }>>`
    SELECT b."id" FROM "PortfolioBudgetPeriod" b
     WHERE b."portfolioId" = ${input.portfolioId} AND b."periodStart" = ${quarter.start}
       AND NOT EXISTS (SELECT 1 FROM "PortfolioBudgetPeriod" n WHERE n."supersedesId" = b."id")
  `;
  try {
    const created = await db.portfolioBudgetPeriod.create({
      data: {
        portfolioId: input.portfolioId,
        periodStart: quarter.start,
        periodEnd: quarter.end,
        allocatedPoints: input.allocatedPoints,
        usdPerPoint: input.usdPerPoint ?? null,
        wipAllowancePoints: input.wipAllowancePoints ?? null,
        setById: input.actor.userId,
        setByAgentId,
        reason,
        supersedesId: current?.id ?? null,
      },
      select: { id: true },
    });
    return ok({ budgetId: created.id, supersedesId: current?.id ?? null });
  } catch (error) {
    // The unique indexes allow one chain root per period and one successor per row,
    // so a racing write for the same budget lands here instead of forking the chain.
    if ((error as { code?: string }).code === "P2002") {
      return refuse("concurrent_change", "This budget changed while you were setting it. Read it again and retry.");
    }
    throw error;
  }
}
