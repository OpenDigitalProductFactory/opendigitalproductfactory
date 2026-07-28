/**
 * Promotion-audit query helper.
 *
 * Answers "where does the discovery -> portfolio pipeline stand right now?"
 * by joining InventoryEntity counts with open PortfolioQualityIssue rows
 * grouped by the four PromotionSkipReason kinds. Used by the audit page
 * (Task 2.4) and surfaceable as JSON for diagnostics.
 *
 * Pure function over an injected db handle — no I/O beyond the db, no logging.
 */
import { INVENTORY_ENTITY_CANONICAL_WHERE } from "@dpf/db";

export type PromotionSkipReason =
  | "type_not_promotable"
  | "no_taxonomy"
  | "no_portfolio_root"
  | "low_confidence_promotion";

export interface PromotionAuditEntitySummary {
  id: string;
  entityKey: string;
  entityType: string;
  name: string;
  attributionConfidence: number | null;
  taxonomyNodeId: string | null;
  taxonomyNodePath: string | null;
  lastSeenAt: Date;
}

export interface PromotionAuditCounts {
  /** Total InventoryEntity rows. */
  discovered: number;
  /** InventoryEntity rows whose attributionStatus = "attributed". */
  attributed: number;
  /** InventoryEntity rows whose digitalProductId is non-null. */
  promoted: number;
  /** Open PortfolioQualityIssue rows whose issueType is one of the four reasons. */
  blocked: number;
}

export interface BlockedReasonGroup {
  /** Total open quality issues for this reason. May exceed `sample.length`. */
  count: number;
  /** Up to 10 most-recent blocked entities for this reason. */
  sample: PromotionAuditEntitySummary[];
}

export interface PromotionAudit {
  counts: PromotionAuditCounts;
  blockedByReason: Record<PromotionSkipReason, BlockedReasonGroup>;
}

export interface PromotionAuditDb {
  inventoryEntity: {
    count(args?: { where?: Record<string, unknown> }): Promise<number>;
  };
  portfolioQualityIssue: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, "asc" | "desc">;
      take?: number;
      include?: Record<string, unknown>;
    }): Promise<
      Array<{
        id: string;
        issueType: string;
        lastDetectedAt: Date;
        inventoryEntity: {
          id: string;
          entityKey: string;
          entityType: string;
          name: string;
          attributionConfidence: number | null;
          taxonomyNodeId: string | null;
          lastSeenAt: Date;
          taxonomyNode: { nodeId: string } | null;
        } | null;
      }>
    >;
  };
}

/**
 * Canonical order of `PromotionSkipReason` values. Exported so UI surfaces
 * (e.g. the audit page in Task 2.4) iterate in the same order they're shown.
 * Adding a fifth reason: update this list AND `PromotionSkipReason` AND
 * `REASON_LABELS` / `REASON_HINTS` together.
 */
export const REASON_LIST: readonly PromotionSkipReason[] = [
  "type_not_promotable",
  "no_taxonomy",
  "no_portfolio_root",
  "low_confidence_promotion",
] as const;

/** Humanized labels per skip reason — UI uses these as section headings. */
export const REASON_LABELS: Record<PromotionSkipReason, string> = {
  type_not_promotable: "Type not promotable",
  no_taxonomy: "Missing taxonomy placement",
  no_portfolio_root: "No portfolio root",
  low_confidence_promotion: "Low confidence",
};

/** Actionable hints surfaced under each reason group on the audit page. */
export const REASON_HINTS: Record<PromotionSkipReason, string> = {
  type_not_promotable:
    "The taxonomy node either has no governance.promotion policy, or its policy is not auto. Add governance via the seed (Task 2.2) or admin UI.",
  no_taxonomy:
    "Entity has no taxonomy node attribution. Run discovery triage to attribute.",
  no_portfolio_root:
    "Entity's taxonomy node root segment does not match any Portfolio.slug. Likely a malformed taxonomy or missing portfolio seed.",
  low_confidence_promotion:
    "Attribution confidence < 0.90. Re-run attribution or hand-review.",
};

const SAMPLE_LIMIT = 10;

export async function getPromotionAudit(db: PromotionAuditDb): Promise<PromotionAudit> {
  // Inventory counts run sequentially so the test can assert call order.
  // (Order is part of the test contract: discovered, attributed, promoted.)
  const discovered = await db.inventoryEntity.count({
    where: INVENTORY_ENTITY_CANONICAL_WHERE,
  });
  const attributed = await db.inventoryEntity.count({
    where: {
      ...INVENTORY_ENTITY_CANONICAL_WHERE,
      attributionStatus: "attributed",
    },
  });
  const promoted = await db.inventoryEntity.count({
    where: {
      ...INVENTORY_ENTITY_CANONICAL_WHERE,
      digitalProductId: { not: null },
    },
  });

  const blocked = await db.portfolioQualityIssue.count({
    where: { issueType: { in: REASON_LIST as unknown as string[] }, status: "open" },
  });

  // Per-reason sample + count queries run in parallel — same DB, independent
  // reads. `count` is the total open issues for that reason (may exceed 10);
  // `sample` is capped at SAMPLE_LIMIT.
  const perReasonResults = await Promise.all(
    REASON_LIST.map(async (reason) => {
      const [count, rows] = await Promise.all([
        db.portfolioQualityIssue.count({
          where: { issueType: reason, status: "open" },
        }),
        db.portfolioQualityIssue.findMany({
          where: { issueType: reason, status: "open" },
          orderBy: { lastDetectedAt: "desc" },
          take: SAMPLE_LIMIT,
          include: { inventoryEntity: { include: { taxonomyNode: true } } },
        }),
      ]);
      return { reason, count, rows };
    }),
  );

  const blockedByReason = perReasonResults.reduce<
    Record<PromotionSkipReason, BlockedReasonGroup>
  >(
    (acc, { reason, count, rows }) => {
      const sample: PromotionAuditEntitySummary[] = rows
        .filter((row) => row.inventoryEntity !== null)
        .map((row) => {
          const entity = row.inventoryEntity!;
          return {
            id: entity.id,
            entityKey: entity.entityKey,
            entityType: entity.entityType,
            name: entity.name,
            attributionConfidence: entity.attributionConfidence,
            taxonomyNodeId: entity.taxonomyNodeId,
            taxonomyNodePath: entity.taxonomyNode?.nodeId ?? null,
            lastSeenAt: entity.lastSeenAt,
          };
        });
      acc[reason] = { count, sample };
      return acc;
    },
    {
      type_not_promotable: { count: 0, sample: [] },
      no_taxonomy: { count: 0, sample: [] },
      no_portfolio_root: { count: 0, sample: [] },
      low_confidence_promotion: { count: 0, sample: [] },
    },
  );

  return {
    counts: { discovered, attributed, promoted, blocked },
    blockedByReason,
  };
}
