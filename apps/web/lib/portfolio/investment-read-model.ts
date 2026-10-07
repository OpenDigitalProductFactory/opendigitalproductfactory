// Portfolio investment read model (BI-298A7202, design §5.1–5.2). Sums
// investment points per portfolio by class — ready, in flight, delivered this
// quarter — with unallocated work as its own row and unsized items counted,
// never added as zero. Later budget slices (budgets, reservations, admission,
// the tie-out) read this rather than re-deriving points or attribution.
//
// Spec: docs/superpowers/specs/2026-09-24-portfolio-budget-and-investment-wip-design.md

import { FOUNDATIONAL_PORTFOLIO_SLUG } from "./accountable-owner";
import { resolveBudgetPortfolio, type BudgetAttributionInput, type BudgetPortfolioPath } from "./budget-attribution";
import { quarterBounds, resolveInvestmentPoints } from "./investment-points";

/** One backlog item with the links attribution reads, as the loader selects it. */
export type InvestmentItemRow = BudgetAttributionInput & {
  itemId: string;
  status: string;
  effortSize: string | null;
  jobSize: number | null;
  estimateAgreed: boolean | null;
  activeBuildId: string | null;
  /** A non-terminal Workroom is bound to the item (design §5.6: in flight). */
  hasLiveWorkroom: boolean;
  /** Where the item was delivered: Build Studio, an external coding agent, or other (design §5.5). */
  deliverySurface: DeliverySurface;
  /** The item carries Workroom or pull-request evidence (design §5.7: traced share). */
  traced: boolean;
  completedAt: Date | null;
};

export const DELIVERY_SURFACES = ["build-studio", "external", "other"] as const;
export type DeliverySurface = (typeof DELIVERY_SURFACES)[number];

export type PortfolioInvestmentRow = {
  /** null is the unallocated row. */
  portfolioId: string | null;
  items: number;
  readyPoints: number;
  inFlightPoints: number;
  deliveredPoints: number;
  unsizedItems: number;
  paths: Partial<Record<BudgetPortfolioPath, number>>;
  /** The share of this row the platform-default rule attributed (BI-291F7451). */
  attributedByRule: { items: number; readyPoints: number; inFlightPoints: number; deliveredPoints: number };
  /** Items whose stored portfolioId contradicts their links. */
  storedDisagreements: number;
  /** Items whose stored portfolioId named no portfolio, so it was ignored. */
  danglingStoredItems: number;
};

export type PortfolioInvestmentSummary = {
  period: { start: Date; end: Date };
  rows: PortfolioInvestmentRow[];
  totals: { liveItems: number; deliveredThisQuarterItems: number; unsizedItems: number };
};

const CLOSED_STATUSES = new Set(["done", "retired"]);
const IN_FLIGHT_STATUSES = new Set(["in-progress", "awaiting-acceptance"]);

type InvestmentClass = "ready" | "inFlight" | "delivered";

function classify(item: InvestmentItemRow, period: { start: Date; end: Date }): InvestmentClass | null {
  if (item.status === "done") {
    const at = item.completedAt ? new Date(item.completedAt) : null;
    return at && at >= period.start && at < period.end ? "delivered" : null;
  }
  if (CLOSED_STATUSES.has(item.status)) return null;
  return IN_FLIGHT_STATUSES.has(item.status) || item.activeBuildId || item.hasLiveWorkroom ? "inFlight" : "ready";
}

/** One item's portfolio (with path) and investment class for a period; null class = outside it. */
export function resolveInvestmentItem(item: InvestmentItemRow, period: { start: Date; end: Date }) {
  const resolution = resolveBudgetPortfolio(item);
  return { resolution, itemClass: classify(item, period), points: resolveInvestmentPoints(item).points };
}

/**
 * `period` defaults to the quarter containing `now`. A budget proposal from a
 * trailing window passes that window, so "delivered" means done inside it.
 */
export function summarizePortfolioInvestment(
  items: InvestmentItemRow[],
  now: Date,
  period: { start: Date; end: Date } = quarterBounds(now),
): PortfolioInvestmentSummary {
  const rows = new Map<string | null, PortfolioInvestmentRow>();
  const totals = { liveItems: 0, deliveredThisQuarterItems: 0, unsizedItems: 0 };

  for (const item of items) {
    const { resolution, itemClass, points } = resolveInvestmentItem(item, period);
    if (itemClass === null) continue;
    const row = rows.get(resolution.portfolioId) ?? {
      portfolioId: resolution.portfolioId,
      items: 0, readyPoints: 0, inFlightPoints: 0, deliveredPoints: 0, unsizedItems: 0,
      paths: {}, storedDisagreements: 0, danglingStoredItems: 0,
      attributedByRule: { items: 0, readyPoints: 0, inFlightPoints: 0, deliveredPoints: 0 },
    };
    const byRule = resolution.basis === "platform-default";
    row.items++;
    row.paths[resolution.path] = (row.paths[resolution.path] ?? 0) + 1;
    if (resolution.disagreesWithLinks) row.storedDisagreements++;
    if (item.storedPortfolioDangling) row.danglingStoredItems++;
    if (byRule) row.attributedByRule.items++;

    if (points === null) {
      row.unsizedItems++;
      totals.unsizedItems++;
    } else {
      const key = itemClass === "ready" ? "readyPoints" : itemClass === "inFlight" ? "inFlightPoints" : "deliveredPoints";
      row[key] += points;
      if (byRule) row.attributedByRule[key] += points;
    }

    if (itemClass === "delivered") totals.deliveredThisQuarterItems++;
    else totals.liveItems++;
    rows.set(resolution.portfolioId, row);
  }

  return { period, rows: [...rows.values()], totals };
}

type Db = { $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T> };

/**
 * Live items (every status but done and retired) plus items done inside the
 * period, each with the links attribution reads (budget-attribution.ts). The epic's portfolio is the
 * lowest id when an epic names several, so the choice is stable.
 *
 * With `itemId`, only that item is loaded, whatever its status: funding
 * approval (budget-reservation.ts) attributes one item through the same select.
 */
export async function loadInvestmentItems(
  db: Db,
  period: { start: Date; end: Date },
  options: { itemId?: string } = {},
): Promise<InvestmentItemRow[]> {
  const itemId = options.itemId ?? null;
  const rows = await db.$queryRaw<InvestmentItemRow[]>`
    SELECT
      b."itemId"         AS "itemId",
      b."status"         AS "status",
      b."effortSize"     AS "effortSize",
      b."jobSize"        AS "jobSize",
      b."estimateAgreed" AS "estimateAgreed",
      b."scopeKind"::text AS "scopeKind",
      (SELECT p."id" FROM "Portfolio" p WHERE p."slug" = ${FOUNDATIONAL_PORTFOLIO_SLUG}) AS "platformDefaultPortfolioId",
      b."portfolioId"    AS "storedPortfolioId",
      (b."portfolioId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Portfolio" p WHERE p."id" = b."portfolioId")) AS "storedPortfolioDangling",
      dp."portfolioId"   AS "productPortfolioId",
      tn."portfolioId"   AS "taxonomyPortfolioId",
      (SELECT a."portfolioId" FROM "CoworkerCapabilityNeed" n
         JOIN "Agent" a ON a."agentId" = n."agentId"
        WHERE n."linkedBacklogItemId" = b."itemId" AND a."portfolioId" IS NOT NULL
        ORDER BY n."needId" LIMIT 1) AS "coworkerNeedPortfolioId",
      (SELECT MIN(ep."portfolioId") FROM "EpicPortfolio" ep WHERE ep."epicId" = b."epicId") AS "epicPortfolioId",
      b."activeBuildId"  AS "activeBuildId",
      EXISTS (SELECT 1 FROM "WorkCapsule" w
               WHERE w."backlogItemId" IN (b."itemId", b."id") AND w."archivedAt" IS NULL
                 AND w."status" NOT IN ('complete', 'abandoned', 'archived')) AS "hasLiveWorkroom",
      CASE
        WHEN EXISTS (SELECT 1 FROM "FeatureBuild" fb WHERE fb."originatingBacklogItemId" = b."id")
          OR EXISTS (SELECT 1 FROM "WorkCapsule" w WHERE w."backlogItemId" IN (b."itemId", b."id") AND w."executorKind" = 'build-studio')
          THEN 'build-studio'
        WHEN EXISTS (SELECT 1 FROM "WorkCapsule" w WHERE w."backlogItemId" IN (b."itemId", b."id")
                       AND w."executorKind" IN ('claude-desktop', 'codex-desktop', 'grok-desktop', 'antigravity-desktop'))
          THEN 'external'
        ELSE 'other'
      END AS "deliverySurface",
      (EXISTS (SELECT 1 FROM "WorkCapsule" w WHERE w."backlogItemId" IN (b."itemId", b."id"))
        OR EXISTS (SELECT 1 FROM "BacklogItemActivity" a
                    WHERE a."backlogItemId" = b."id" AND a."kind" = 'evidence' AND a."payload"->>'url' LIKE '%/pull/%')) AS "traced",
      b."completedAt"    AS "completedAt"
    FROM "BacklogItem" b
    LEFT JOIN "DigitalProduct" dp ON dp."id" = b."digitalProductId"
    LEFT JOIN "TaxonomyNode" tn ON tn."id" = b."taxonomyNodeId"
    WHERE CASE WHEN ${itemId}::text IS NOT NULL THEN b."itemId" = ${itemId}::text
          ELSE b."status" NOT IN ('done', 'retired')
            OR (b."status" = 'done' AND b."completedAt" >= ${period.start} AND b."completedAt" < ${period.end})
          END
  `;
  return rows.map((r) => ({ ...r, jobSize: r.jobSize === null ? null : Number(r.jobSize) }));
}

export async function loadPortfolioInvestment(db: Db, now: Date = new Date()): Promise<PortfolioInvestmentSummary> {
  return summarizePortfolioInvestment(await loadInvestmentItems(db, quarterBounds(now)), now);
}
