/**
 * Pure promotion policy resolver for the Discovery -> Portfolio handoff.
 *
 * Given a discovered entity, its taxonomy node (if any), and the portfolio
 * root we plan to attach under, decide whether to promote into the digital
 * product portfolio or skip with a structured reason.
 *
 * No DB calls, no I/O — callers fetch the inputs and persist the outcome.
 */

export const LEGACY_PROMOTABLE_TYPES: readonly string[] = [
  "host",
  "runtime",
  "container",
  "database",
  "monitoring_service",
  "ai_service",
  "application",
  "subnet",
  "gateway",
  "network_interface",
  "docker_host",
  "router",
];

export const AUTO_PROMOTE_THRESHOLD = 0.9;

export type PromotionSkipReason =
  | "no_taxonomy"
  | "low_confidence_promotion"
  | "no_portfolio_root"
  | "type_not_promotable";

/**
 * Evidence is a small, JSON-serializable bag of decision context. The set
 * of keys varies by `source`; downstream consumers (e.g. Task 1.2's quality
 * issue writer, Task 2.1's promotion runner) read `source` first, then the
 * source-specific fields. Values are restricted to JSON primitives so the
 * envelope can be stored directly in `PortfolioQualityIssue.details`.
 */
export type PromotionEvidence = Record<string, string | number | null>;

export type PromotionDecision =
  | { decision: "promote"; classifyAs?: string; reason?: undefined; evidence: PromotionEvidence }
  | { decision: "skip"; classifyAs?: undefined; reason: PromotionSkipReason; evidence: PromotionEvidence };

/**
 * Loose input shapes — callers may pass richer Prisma rows; only these
 * fields are read.
 */
export interface PromotionEntityInput {
  entityType: string;
  attributionStatus?: string;
  attributionConfidence: number;
  digitalProductId: string | null;
  taxonomyNodeId: string | null;
}

export interface PromotionTaxonomyNodeInput {
  id: string;
  nodeId: string;
  governance:
    | {
        promotion?: {
          // "auto" is the only mode the resolver acts on today; other values
          // (e.g. a future "manual") fall through to the type_not_promotable
          // skip path. Open to extension via the (string & {}) escape hatch.
          mode?: "auto" | (string & {});
          classifyAs?: string;
        } | null;
      }
    | null;
}

export interface PromotionPortfolioInput {
  id: string;
  slug: string;
}

export function resolvePromotionDecision(
  entity: PromotionEntityInput,
  taxonomyNode: PromotionTaxonomyNodeInput | null,
  portfolio: PromotionPortfolioInput | null,
): PromotionDecision {
  // Gate 1: must have a taxonomy node to attach against.
  if (taxonomyNode === null) {
    return {
      decision: "skip",
      reason: "no_taxonomy",
      evidence: { source: "gate", gate: "no_taxonomy" },
    };
  }

  // Gate 2: confidence must clear the auto-promote bar.
  if (entity.attributionConfidence < AUTO_PROMOTE_THRESHOLD) {
    return {
      decision: "skip",
      reason: "low_confidence_promotion",
      evidence: {
        source: "gate",
        gate: "low_confidence_promotion",
        threshold: AUTO_PROMOTE_THRESHOLD,
        observed: entity.attributionConfidence,
      },
    };
  }

  // Gate 3: portfolio root must exist.
  if (portfolio === null) {
    return {
      decision: "skip",
      reason: "no_portfolio_root",
      evidence: { source: "gate", gate: "no_portfolio_root" },
    };
  }

  // Note: the caller is responsible for filtering out entities that already
  // point at a digital product (Task 2.1's promoteInventoryEntities filters
  // digitalProductId: null at the Prisma query level). The resolver does not
  // gate on digitalProductId — keeping it pure over (entity, node, portfolio).

  // Policy lookup: governance.promotion on the taxonomy node wins.
  const promotionPolicy = taxonomyNode.governance?.promotion ?? null;

  if (promotionPolicy && promotionPolicy.mode === "auto") {
    return {
      decision: "promote",
      classifyAs: promotionPolicy.classifyAs,
      evidence: { source: "node-policy" },
    };
  }

  // Legacy fallback: type-based allowlist preserves historical behavior.
  if (promotionPolicy === null) {
    if (LEGACY_PROMOTABLE_TYPES.includes(entity.entityType)) {
      return {
        decision: "promote",
        evidence: { source: "legacy-list" },
      };
    }
    return {
      decision: "skip",
      reason: "type_not_promotable",
      evidence: {
        source: "legacy-list",
        entityType: entity.entityType,
      },
    };
  }

  // Policy present but not auto (e.g. "manual"): treat as not promotable.
  return {
    decision: "skip",
    reason: "type_not_promotable",
    evidence: {
      source: "node-policy",
      mode: promotionPolicy.mode ?? null,
    },
  };
}
