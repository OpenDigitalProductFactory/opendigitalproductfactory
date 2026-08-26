// discovery-promotion.ts
// Auto-promotes high-confidence InventoryEntity records to DigitalProduct records.
// Called after each discovery sweep's persistence pass.
//
// As of Task 2.1, this runner delegates type/policy decisions to
// resolvePromotionDecision (./discovery-promotion-policy) and surfaces every
// skip as a PortfolioQualityIssue via openOrUpdateQualityIssue
// (./portfolio-quality-issue-writer). The Prisma `findMany` filter no longer
// constrains entityType — all attributed, taxonomy-placed, high-confidence
// entities flow through the resolver, which decides promote vs. skip based on
// taxonomy `governance.promotion` (preferred) or the legacy type allowlist
// (fallback).

import {
  resolvePromotionDecision,
  classifyEstateProvenance,
  hasObservationEvidence,
  isTerminalStructuralSkip,
  type PromotionTaxonomyNodeInput,
} from "./discovery-promotion-policy";
import {
  openOrUpdateQualityIssue,
  type QualityIssueDb,
  type QualityIssueType,
} from "./portfolio-quality-issue-writer";
import { INVENTORY_ENTITY_CANONICAL_WHERE } from "./inventory-entity-lifecycle";

export const AUTO_PROMOTE_THRESHOLD = 0.90;

/**
 * Legacy type allowlist. Retained as an export because (a) external callers
 * still reference it, and (b) the resolver consults it as a fallback when a
 * taxonomy node has no `governance.promotion` policy. Source of truth for the
 * fallback list now lives in `./discovery-promotion-policy` (LEGACY_PROMOTABLE_TYPES);
 * the value here is the historical export surface kept stable.
 */
// Re-exported from the policy module — source of truth lives there. Kept
// as a separate export here because external callers reference this name.
// Tightened in BI-79307D22 to drop runtime/infra types.
export { LEGACY_PROMOTABLE_TYPES as PROMOTABLE_TYPES } from "./discovery-promotion-policy";

export type PromotionSummary = {
  promoted: number;
  skipped: number;
  errors: number;
};

export function generateProductId(entityType: string, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return entityType === "host" ? `host-${slug}` : `infra-${slug}`;
}

type PromotionDb = QualityIssueDb & {
  inventoryEntity: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<Array<{
      id: string;
      entityKey: string;
      entityType: string;
      name: string;
      attributionStatus?: string;
      attributionConfidence: number | null;
      taxonomyNodeId: string | null;
      digitalProductId: string | null;
      properties: unknown;
    }>>;
    update(args: { where: { id: string }; data: { digitalProductId: string } }): Promise<unknown>;
  };
  taxonomyNode: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; nodeId: true; governance: true };
    }): Promise<
      | (PromotionTaxonomyNodeInput & Record<string, unknown>)
      | null
    >;
  };
  portfolio: {
    findUnique(args: { where: { slug: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
  digitalProduct: {
    findUnique(args: { where: { productId: string }; select: { id: true } }): Promise<{ id: string } | null>;
    upsert(args: {
      where: { productId: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
      select: { id: true; productId: true };
    }): Promise<{ id: string; productId: string }>;
  };
};

/**
 * Human-readable one-liners for each skip reason. Stored as `summary` on the
 * PortfolioQualityIssue row so admins skimming the queue see why a row was
 * held back without having to interpret the type.
 */
function skipSummaryFor(reason: QualityIssueType, entityKey: string, entityType: string): string {
  switch (reason) {
    case "no_taxonomy":
      return `Entity ${entityKey} has no resolvable taxonomy node`;
    case "low_confidence_promotion":
      return `Entity ${entityKey} attribution confidence below auto-promote threshold`;
    case "no_portfolio_root":
      return `Entity ${entityKey} taxonomy root does not map to a known portfolio`;
    case "type_not_promotable":
      return `Entity type ${entityType} is not promotable under current taxonomy policy (${entityKey})`;
    case "name_not_promotable":
      return `Entity ${entityKey} name shape looks like a runtime instance or device, not a product`;
    default:
      return `Entity ${entityKey} skipped: ${reason}`;
  }
}

export async function promoteInventoryEntities(db: PromotionDb): Promise<PromotionSummary> {
  const summary: PromotionSummary = { promoted: 0, skipped: 0, errors: 0 };

  const entities = await db.inventoryEntity.findMany({
    where: {
      ...INVENTORY_ENTITY_CANONICAL_WHERE,
      attributionStatus: "attributed",
      attributionConfidence: { gte: AUTO_PROMOTE_THRESHOLD },
      digitalProductId: null,
      taxonomyNodeId: { not: null },
    },
    select: {
      id: true,
      entityKey: true,
      entityType: true,
      name: true,
      attributionStatus: true,
      attributionConfidence: true,
      taxonomyNodeId: true,
      digitalProductId: true,
      properties: true,
    },
  });

  for (const entity of entities) {
    try {
      // Resolve taxonomy node (now selecting governance for policy lookup).
      const taxonomyNode = entity.taxonomyNodeId
        ? await db.taxonomyNode.findUnique({
            where: { id: entity.taxonomyNodeId },
            select: { id: true, nodeId: true, governance: true },
          })
        : null;

      // Resolve portfolio from taxonomy root segment (when we have one).
      const rootSlug = taxonomyNode ? taxonomyNode.nodeId.split("/")[0] : null;
      const portfolioRow = rootSlug
        ? await db.portfolio.findUnique({ where: { slug: rootSlug }, select: { id: true } })
        : null;
      const portfolio = portfolioRow && rootSlug
        ? { id: portfolioRow.id, slug: rootSlug }
        : null;

      // Classify estate provenance from discovery evidence so the resolver can
      // promote real-estate devices (UniFi/arp, 192.168) even when their
      // entityType is host/network, while keeping the platform's own Docker
      // self-scan (172.18) as a black box.
      const props = (entity.properties ?? {}) as Record<string, unknown>;
      const provenance = classifyEstateProvenance({
        discoveredVia: typeof props.discoveredVia === "string" ? props.discoveredVia : null,
        addressHint:
          (typeof props.address === "string" && props.address) ||
          (typeof props.ip === "string" && props.ip) ||
          entity.name ||
          null,
      });

      // Delegate the promote/skip decision to the pure policy resolver.
      const decision = resolvePromotionDecision(
        {
          entityType: entity.entityType,
          // Pass through so the structural name-gate (BI-79307D22)
          // can reject "dpf-redis-1"/"Docker GW …" runtime artifacts.
          name: entity.name,
          attributionStatus: entity.attributionStatus,
          attributionConfidence: entity.attributionConfidence ?? 0,
          digitalProductId: entity.digitalProductId,
          taxonomyNodeId: entity.taxonomyNodeId,
          provenance,
          // Evidence-based discovery (BI-B19C41B8): a real-estate host that never
          // proved it's a device (no MAC/vendor/hostname/ports) is a subnet-scan
          // phantom and must not be promoted.
          hasObservationEvidence: hasObservationEvidence({ properties: entity.properties }),
        },
        taxonomyNode,
        portfolio,
      );

      if (decision.decision === "skip") {
        // Terminal structural skips (name-gate / structural-type-gate) are
        // CORRECT "this is infrastructure, not a product" classifications — not
        // actionable gaps. Recording them as open PortfolioQualityIssue rows was
        // the original design mistake (BI-62846516): they can never be resolved,
        // so the platform's own Docker self-scan accumulated 378 permanent-open
        // rows that buried the real, fixable issues. Skip the write; still count
        // the entity as skipped from promotion. Actionable skips (no_taxonomy,
        // low_confidence_promotion, no_portfolio_root, legacy-list/node-policy
        // type_not_promotable) still open a quality issue below.
        if (!isTerminalStructuralSkip(decision)) {
          // Terminal-structural reasons (incl. the evidence-gate's
          // "no_observation_evidence") never reach here — they are filtered
          // above — so the reason is an actionable quality-issue type.
          const actionableReason = decision.reason as Exclude<
            typeof decision.reason,
            "no_observation_evidence"
          >;
          await openOrUpdateQualityIssue({
            db,
            issueType: actionableReason,
            scope: {
              inventoryEntityId: entity.id,
              taxonomyNodeId: taxonomyNode?.id,
              portfolioId: portfolio?.id,
            },
            summary: skipSummaryFor(actionableReason, entity.entityKey, entity.entityType),
            details: decision.evidence,
          });
        }
        summary.skipped++;
        continue;
      }

      // Promote path. Below this point, taxonomyNode and portfolio are
      // guaranteed by the resolver's gate ordering.
      if (!taxonomyNode || !portfolio) {
        // Defensive: should be unreachable given the resolver's gates.
        summary.errors++;
        console.error(
          `[discovery-promotion] Resolver returned promote but taxonomy/portfolio missing for ${entity.entityKey}`,
        );
        continue;
      }

      const productId = generateProductId(entity.entityType, entity.name);
      const observationConfig = decision.classifyAs
        ? { classifyAs: decision.classifyAs }
        : undefined;

      const product = await db.digitalProduct.upsert({
        where: { productId },
        update: {
          name: entity.name,
          lifecycleStage: "production",
          lifecycleStatus: "active",
          taxonomyNodeId: taxonomyNode.id,
          portfolioId: portfolio.id,
          ...(observationConfig ? { observationConfig } : {}),
        },
        create: {
          productId,
          name: entity.name,
          lifecycleStage: "production",
          lifecycleStatus: "active",
          taxonomyNodeId: taxonomyNode.id,
          portfolioId: portfolio.id,
          ...(observationConfig ? { observationConfig } : {}),
        },
        select: { id: true, productId: true },
      });

      await db.inventoryEntity.update({
        where: { id: entity.id },
        data: { digitalProductId: product.id },
      });

      summary.promoted++;
      console.log(`[discovery-promotion] Promoted ${entity.name} -> ${product.productId}`);
    } catch (err) {
      summary.errors++;
      console.error(`[discovery-promotion] Failed to promote ${entity.entityKey}:`, err);
    }
  }

  return summary;
}
