// Admission by points in flight (BI-3430B3A4, design §5.6). Replaces the count
// cap (BUILD_WIP_CAP) at every start: a portfolio admits new work while its
// points in flight plus the new item's points fit its allowance. Ten small items
// and two large items that cost the same investment are admitted alike.
//
// - Autonomous starts (tee-up, capacity drain, dispatch-bet, unattended
//   executors) are refused past the allowance, with the reason recorded.
// - Human starts proceed past it with a warning, and the warning is recorded.
// - Break-fix work is counted but never blocked; work already in flight is not
//   a new start.
// - The Build Studio sandbox pool is the machine's physical limit. It is
//   enforced where a sandbox is acquired and reported here, never counted into
//   the investment limit.
//
// Spec: docs/superpowers/specs/2026-09-24-portfolio-budget-and-investment-wip-design.md

import { quarterBounds } from "@/lib/portfolio/investment-points";
import { loadInvestmentItems, summarizePortfolioInvestment } from "@/lib/portfolio/investment-read-model";
import { loadPortfolioBudgets } from "@/lib/portfolio/portfolio-budget";
import { resolveInvestmentPoints } from "@/lib/portfolio/investment-points";
import { resolveBacklogPortfolioWithPath } from "@dpf/db/backlog-portfolio";

import { sandboxPoolSize } from "./wip-cap";

/** One large item: the least a portfolio can always have in flight. */
export const LARGE_ITEM_FLOOR_POINTS = 8;
/** Little's Law target lead time: allowance = weekly throughput x this. */
export const TARGET_LEAD_TIME_WEEKS = 2;

export type StartKind = "autonomous" | "human";
export type AdmissionVerdict = "admit" | "warn" | "refuse";

export function wipAllowance(input: { override: number | null; weeklyThroughput: number | null }): { points: number; source: "override" | "throughput" | "floor" } {
  if (input.override !== null) return { points: input.override, source: "override" };
  const derived = input.weeklyThroughput === null ? 0 : Math.round(input.weeklyThroughput * TARGET_LEAD_TIME_WEEKS);
  return derived > LARGE_ITEM_FLOOR_POINTS ? { points: derived, source: "throughput" } : { points: LARGE_ITEM_FLOOR_POINTS, source: "floor" };
}

export function decideInvestmentAdmission(input: {
  inFlightPoints: number;
  itemPoints: number | null;
  allowance: number;
  startKind: StartKind;
  breakFix: boolean;
  alreadyInFlight: boolean;
}): { verdict: AdmissionVerdict; reason: string } {
  if (input.alreadyInFlight) return { verdict: "admit", reason: "The item is already in flight and counted; this is not a new start." };
  if (input.breakFix) return { verdict: "admit", reason: "Break-fix work is counted in flight but never blocked." };
  const pastLimit = (why: string) => input.startKind === "autonomous"
    ? { verdict: "refuse" as const, reason: `${why} An autonomous start waits until points in flight come down.` }
    : { verdict: "warn" as const, reason: `${why} Started by a person anyway; this warning is recorded.` };
  if (input.itemPoints === null) {
    return pastLimit("The item has no size, so its investment is unknown and it cannot be admitted against the allowance.");
  }
  const after = input.inFlightPoints + input.itemPoints;
  if (after <= input.allowance) {
    return { verdict: "admit", reason: `${after} of ${input.allowance} points in flight after this start.` };
  }
  return pastLimit(`Starting this takes the portfolio to ${after} of ${input.allowance} points in flight (${after - input.allowance} over).`);
}

type ReadDb = { $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T> };

export type ItemAdmission = {
  verdict: AdmissionVerdict;
  reason: string;
  itemId: string;
  backlogItemRowId: string | null;
  portfolioId: string | null;
  inFlightPoints: number;
  itemPoints: number | null;
  allowance: number;
  allowanceSource: "override" | "throughput" | "floor";
  /** The machine's separate physical limit, reported beside the investment limit. */
  sandboxPoolSize: number;
};

/**
 * Evaluate a start for one backlog item against its portfolio's allowance. The
 * unallocated work draws on its own allowance with the same floor, so missing
 * attribution is never a way around the limit.
 */
export async function evaluateItemAdmission(db: ReadDb, input: {
  itemId: string;
  startKind: StartKind;
  breakFix?: boolean;
  now?: Date;
  /** Weekly delivered points for the portfolio, once throughput is measured (slice 5). */
  weeklyThroughput?: number | null;
}): Promise<ItemAdmission> {
  const now = input.now ?? new Date();
  const period = quarterBounds(now);
  const items = await loadInvestmentItems(db, period);
  const item = items.find((row) => row.itemId === input.itemId) ?? null;
  const portfolioId = item
    ? resolveBacklogPortfolioWithPath({
        portfolioId: item.storedPortfolioDangling ? null : item.storedPortfolioId,
        digitalProduct: { portfolioId: item.productPortfolioId },
        taxonomyNode: { portfolioId: item.taxonomyPortfolioId },
        coworkerNeeds: [{ agent: { portfolioId: item.coworkerNeedPortfolioId } }],
        epic: { portfolios: item.epicPortfolioId ? [{ portfolioId: item.epicPortfolioId }] : [] },
      }).portfolioId
    : null;
  const summary = summarizePortfolioInvestment(items, now);
  const inFlightPoints = summary.rows.find((row) => row.portfolioId === portfolioId)?.inFlightPoints ?? 0;
  const itemPoints = item ? resolveInvestmentPoints(item).points : null;
  const alreadyInFlight = Boolean(item && (item.status === "in-progress" || item.status === "awaiting-acceptance" || item.activeBuildId || item.hasLiveWorkroom));
  const override = portfolioId
    ? (await loadPortfolioBudgets(db, period)).find((b) => b.id === portfolioId)?.budget?.wipAllowancePoints ?? null
    : null;
  const allowance = wipAllowance({ override, weeklyThroughput: input.weeklyThroughput ?? null });
  const decision = decideInvestmentAdmission({
    inFlightPoints,
    itemPoints,
    allowance: allowance.points,
    startKind: input.startKind,
    breakFix: input.breakFix === true,
    alreadyInFlight,
  });
  const [row] = await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "BacklogItem" WHERE "itemId" = ${input.itemId}`;
  return {
    ...decision,
    itemId: input.itemId,
    backlogItemRowId: row?.id ?? null,
    portfolioId,
    inFlightPoints,
    itemPoints,
    allowance: allowance.points,
    allowanceSource: allowance.source,
    sandboxPoolSize: sandboxPoolSize(),
  };
}

/** Record a refusal or a warning on the item, so the reason outlives the call. Admissions are not recorded. */
export async function recordAdmissionOutcome(
  db: { $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number> },
  admission: ItemAdmission,
  context: { source: string; userId?: string | null; agentId?: string | null; now?: Date },
): Promise<void> {
  if (admission.verdict === "admit" || !admission.backlogItemRowId) return;
  const now = context.now ?? new Date();
  const summary = admission.verdict === "refuse"
    ? `Start refused by the points-in-flight allowance (${context.source})`
    : `Started past the points-in-flight allowance (${context.source})`;
  await db.$executeRaw`
    INSERT INTO "BacklogItemActivity" ("id", "backlogItemId", "kind", "summary", "payload", "recordedAt", "recordedById")
    VALUES (${`wip-admission-${admission.backlogItemRowId}-${now.getTime()}`}, ${admission.backlogItemRowId}, 'wip_admission', ${summary},
            ${JSON.stringify({
              verdict: admission.verdict,
              reason: admission.reason,
              source: context.source,
              portfolioId: admission.portfolioId,
              inFlightPoints: admission.inFlightPoints,
              itemPoints: admission.itemPoints,
              allowance: admission.allowance,
              allowanceSource: admission.allowanceSource,
              sandboxPoolSize: admission.sandboxPoolSize,
              agentId: context.agentId ?? null,
            })}::jsonb, ${now}, ${context.userId ?? null})`;
}
