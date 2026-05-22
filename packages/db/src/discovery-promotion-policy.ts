/**
 * Pure promotion policy resolver for the Discovery -> Portfolio handoff.
 *
 * Given a discovered entity, its taxonomy node (if any), and the portfolio
 * root we plan to attach under, decide whether to promote into the digital
 * product portfolio or skip with a structured reason.
 *
 * No DB calls, no I/O — callers fetch the inputs and persist the outcome.
 */

// Product-shaped entity types — things that represent software products in
// their own right, not the infrastructure they run on. Hosts, containers,
// subnets, gateways, switches, etc. are runtime instances/transports, not
// products; they belong as InventoryEntity rows attributed to a product
// (e.g. "dpf-postgres-1 container" attributed to the "postgres" product),
// not as standalone DigitalProduct rows that bloat the portfolio.
//
// Before BI-79307D22 (2026-05-22), this list included the runtime/infra
// types and the dev install ended up with 209 DigitalProducts — 95% of
// them auto-promoted Docker containers like "dpf-redis-1" and gateway IP
// rows like "Docker GW dpf_default (172.18.0.1)". Operators couldn't find
// their real products. The list is now product-shaped types only.
export const LEGACY_PROMOTABLE_TYPES: readonly string[] = [
  "runtime",
  "database",
  "monitoring_service",
  "ai_service",
  "application",
  "service",
];

// Name patterns that indicate "this is a runtime instance / device / host
// / network artifact, not a product." These reject even if the entity has
// an explicit taxonomy `governance.promotion.mode = "auto"` policy —
// structural shape wins over taxonomy placement here, because the
// alternative is letting bad taxonomy data write bad product rows.
const NON_PRODUCT_NAME_PATTERNS: readonly RegExp[] = [
  /^dpf-/i,                              // dpf-redis-1, dpf-postgres-1, dpf-grafana-1
  /-\d+$/,                               // anything-1, foo-bar-2
  /Docker GW /,                          // Docker GW dpf_default (172.18.0.1)
  /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/,     // raw IPv4 addresses
  /^[a-f0-9]{12}$/i,                     // bare Docker container IDs (short SHA)
  /^arp:/,                               // arp-discovered host placeholders
  /\(WAN\d*\)/,                          // VLAN-shape names from unifi
  /^subnet:/,                            // bootstrap subnet placeholders
];

export function looksLikeRuntimeArtifact(name: string): boolean {
  return NON_PRODUCT_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

export const AUTO_PROMOTE_THRESHOLD = 0.9;

export type PromotionSkipReason =
  | "no_taxonomy"
  | "low_confidence_promotion"
  | "no_portfolio_root"
  | "type_not_promotable"
  | "name_not_promotable";

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
  // Required for the structural name-shape gate (BI-79307D22). Older
  // callers that omit this get the same behaviour they had pre-fix —
  // the name gate just doesn't fire.
  name?: string;
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

  // Gate 4 (structural, BI-79307D22): reject runtime instances / devices
  // / network artifacts by name shape, regardless of taxonomy policy.
  // "dpf-postgres-1" is structurally a container — even if a taxonomy
  // node says auto-promote, the right model is to keep it as an
  // InventoryEntity attributed to the canonical "postgres" product.
  if (entity.name && looksLikeRuntimeArtifact(entity.name)) {
    return {
      decision: "skip",
      reason: "name_not_promotable",
      evidence: {
        source: "name-gate",
        name: entity.name,
      },
    };
  }

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
