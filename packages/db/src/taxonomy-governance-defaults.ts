/**
 * Default `governance.promotion` policies for TaxonomyNode rows seeded by
 * `seedTaxonomyNodes` (and re-applied on every reseed for idempotency).
 *
 * Pure module — no DB, no I/O. Consumed by:
 *   - `seedTaxonomyNodes` in `seed.ts` (writes to TaxonomyNode.governance).
 *   - The promotion resolver in `discovery-promotion-policy.ts` (reads
 *     `governance.promotion.mode` to decide auto-promote vs. skip).
 *
 * Policy intent (per Discovery -> Portfolio Gap Closure plan, spec §1.4):
 *   - Foundational subtree gets `mode: "auto"` so the discovery -> portfolio
 *     handoff promotes inventory entities under those nodes without manual
 *     review.
 *   - `foundational/network_management/*` additionally carries
 *     `classifyAs: "infrastructure_endpoint"` so the resolver tags promoted
 *     DigitalProduct rows with a distinguishing technicalClass marker
 *     (network_client / access_point / vlan / switch / service all flow
 *     through here today).
 *   - Non-foundational roots default to `mode: "manual"` — those portfolios
 *     have no auto-discovery feed yet, and admins should review before
 *     auto-promote is enabled.
 */

export interface PromotionPolicy {
  mode: "auto" | "manual";
  classifyAs?: string;
}

export interface NodeGovernance {
  promotion: PromotionPolicy;
}

/**
 * Prefixes (or exact node IDs) that should carry
 * `classifyAs: "infrastructure_endpoint"` in addition to `mode: "auto"`.
 *
 * Lean conservative: better to mark a network sub-node as endpoint than to
 * under-classify a freshly-discovered network entity. Any node ID starting
 * with one of these prefixes (matched against `${prefix}` exactly OR
 * `${prefix}/...`) gets the marker.
 */
const ENDPOINT_CLASS_PREFIXES: readonly string[] = [
  "foundational/network_management",
];

function isUnderPrefix(nodeId: string, prefix: string): boolean {
  return nodeId === prefix || nodeId.startsWith(`${prefix}/`);
}

function isFoundational(nodeId: string): boolean {
  return nodeId === "foundational" || nodeId.startsWith("foundational/");
}

function isEndpointClass(nodeId: string): boolean {
  return ENDPOINT_CLASS_PREFIXES.some((prefix) => isUnderPrefix(nodeId, prefix));
}

/**
 * Computes the default `governance.promotion` policy for a taxonomy node
 * based on its `nodeId` path.
 *
 * - Foundational subtree -> `{ mode: "auto" }`, with
 *   `classifyAs: "infrastructure_endpoint"` added under endpoint-class
 *   prefixes (currently `foundational/network_management/*`).
 * - All other roots -> `{ mode: "manual" }`.
 */
export function defaultPromotionPolicyFor(nodeId: string): PromotionPolicy {
  if (isFoundational(nodeId)) {
    if (isEndpointClass(nodeId)) {
      return { mode: "auto", classifyAs: "infrastructure_endpoint" };
    }
    return { mode: "auto" };
  }
  return { mode: "manual" };
}

/**
 * Wraps the policy in the JSON shape used by `TaxonomyNode.governance`:
 *   `{ promotion: { mode, classifyAs? } }`
 */
export function defaultGovernanceFor(nodeId: string): NodeGovernance {
  return { promotion: defaultPromotionPolicyFor(nodeId) };
}
