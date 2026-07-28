import { sortNewestFirst } from "./evidence-view-adapters";

/**
 * Digital product view model
 *
 * Pure mapping from a Prisma DigitalProduct + linked InventoryEntity[] +
 * open PortfolioQualityIssue[] (and forward-compatible Chunk 4 freshness /
 * enrichment fields) into a typed render-ready shape used by the digital
 * product detail page (Task 3.4 of the discovery -> portfolio gap closure
 * plan).
 *
 * View-model-first per Task 3.3 review: the page does the I/O, this module
 * does only projection. No DB. No I/O. Tolerates null/undefined inputs.
 *
 * Chunk 4 forward compatibility: `freshness`, `enrichmentStatus`,
 * `lastEnrichedAt` are accepted as optional inputs but never read off the
 * Prisma row in this chunk -- they default to null. When Chunk 4 Task 4.1
 * lands the Prisma schema fields, the page will pass them through and the
 * view will light up without further changes here.
 */

export type FreshnessValue = "fresh" | "stale" | "retired";
export type EnrichmentStatusValue = "pending" | "enriched" | "partial" | "failed";

/**
 * Present only for products projected from an AI coworker (sourceKind
 * "coworker_service", BI-8F9EDD6C). Carries the DOC-7693D528 relationship the
 * product must preserve: the coworker's identity, its human-role parity anchor,
 * and its approval/interface owner. Sourced from DigitalProduct.observationConfig.
 */
export interface CoworkerProductSummary {
  agentId: string | null;
  /** The equivalent/adjacent human role (HR role id) the coworker is patterned against. */
  humanRoleParity: string | null;
  /** The responsible human approval/interface owner (HR role id). */
  approvalInterfaceOwner: string | null;
}

export interface DigitalProductView {
  id: string;
  productId: string;
  name: string;
  description: string | null;
  version: string;
  lifecycleStage: string;
  lifecycleStatus: string;
  observationConfig: { classifyAs?: string } | null;

  /** Present only for AI-coworker-sourced products (BI-8F9EDD6C); null otherwise. */
  coworker: CoworkerProductSummary | null;

  taxonomyLineage: Array<{ nodeId: string; name: string }>; // breadcrumb root -> leaf
  portfolio: { id: string; slug: string; name: string } | null;

  // Pulled from a primary linked InventoryEntity (or null when none).
  // Same shape as `linkedEntities[0]` — kept as a separate field for ergonomic
  // identity-row rendering without indexing.
  primaryEntity: LinkedEntitySummary | null;

  /**
   * Full set of linked InventoryEntity rows, in the order returned by the
   * caller. The detail page renders these in the "Linked Inventory Entities"
   * table; consumers who only need identity hints can read `primaryEntity`.
   */
  linkedEntities: LinkedEntitySummary[];

  linkedEntityCount: number;

  // Chunk 4 territory -- accepted as optional inputs, never read from Prisma in this chunk.
  freshness: FreshnessValue | null;
  enrichmentStatus: EnrichmentStatusValue | null;
  lastEnrichedAt: Date | null;

  // Open quality issues sourced from a separate query (not embedded in DigitalProduct).
  openQualityIssues: Array<{
    id: string;
    issueType: string;
    severity: string;
    summary: string;
    lastDetectedAt: Date;
  }>;
}

/**
 * Summary shape used by both `primaryEntity` and `linkedEntities`. Keep the
 * fields aligned with what `DigitalProductDetail`'s linked-entities table
 * renders — adding a column here means adding a column there.
 */
export interface LinkedEntitySummary {
  id: string;
  name: string;
  entityKey: string;
  entityType: string;
  manufacturer: string | null;
  productModel: string | null;
  technicalClass: string | null;
  iconKey: string | null;
  observedVersion: string | null;
  normalizedVersion: string | null;
  attributionConfidence: number | null;
  lastSeenAt: Date;
}

export interface ToDigitalProductViewModelInput {
  product: {
    id: string;
    productId: string;
    name: string;
    description: string | null;
    version: string;
    lifecycleStage: string;
    lifecycleStatus: string;
    observationConfig: unknown;
    portfolio: { id: string; slug: string; name: string } | null;
    taxonomyNode: { nodeId: string; name: string } | null;
  };
  taxonomyAncestors: Array<{ nodeId: string; name: string }>; // root-first; may be empty
  inventoryEntities: Array<{
    id: string;
    name: string;
    entityKey: string;
    entityType: string;
    manufacturer: string | null;
    productModel: string | null;
    technicalClass: string | null;
    iconKey: string | null;
    observedVersion: string | null;
    normalizedVersion: string | null;
    attributionConfidence: number | null;
    lastSeenAt: Date;
  }>;
  qualityIssues: Array<{
    id: string;
    issueType: string;
    severity: string;
    summary: string;
    lastDetectedAt: Date;
    status: string; // only "open" should appear in the output
  }>;
  // Chunk 4 future fields -- accept but don't require
  freshness?: FreshnessValue | null;
  enrichmentStatus?: EnrichmentStatusValue | null;
  lastEnrichedAt?: Date | null;
}

// --- helpers -----------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectObservationConfig(value: unknown): { classifyAs?: string } | null {
  if (!isPlainObject(value)) return null;
  const out: { classifyAs?: string } = {};
  if (typeof value.classifyAs === "string") {
    out.classifyAs = value.classifyAs;
  }
  // If nothing meaningful surfaced, return null rather than {} so callers can
  // boolean-check the presence of any known field. (Future fields go here.)
  if (Object.keys(out).length === 0) return null;
  return out;
}

/** Non-empty string, else null — coworker markers are stored as "" when absent. */
function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Project the AI-coworker markers the coworker projector stamps into
 * observationConfig (sourceKind "coworker_service", agentId, humanRoleParity,
 * approvalInterfaceOwnerRole). Returns null for any non-coworker product, so the
 * detail page renders the coworker section only when it applies (BI-8F9EDD6C).
 */
function projectCoworker(value: unknown): CoworkerProductSummary | null {
  if (!isPlainObject(value)) return null;
  if (value.sourceKind !== "coworker_service") return null;
  return {
    agentId: nonEmpty(value.agentId),
    humanRoleParity: nonEmpty(value.humanRoleParity),
    approvalInterfaceOwner: nonEmpty(value.approvalInterfaceOwnerRole),
  };
}

function projectTaxonomyLineage(
  ancestors: Array<{ nodeId: string; name: string }>,
  leaf: { nodeId: string; name: string } | null,
): Array<{ nodeId: string; name: string }> {
  const lineage: Array<{ nodeId: string; name: string }> = ancestors.map((a) => ({
    nodeId: a.nodeId,
    name: a.name,
  }));
  if (leaf !== null) lineage.push({ nodeId: leaf.nodeId, name: leaf.name });
  return lineage;
}

function projectLinkedEntities(
  entities: ToDigitalProductViewModelInput["inventoryEntities"],
): LinkedEntitySummary[] {
  return entities.map((e) => ({
    id: e.id,
    name: e.name,
    entityKey: e.entityKey,
    entityType: e.entityType,
    manufacturer: e.manufacturer,
    productModel: e.productModel,
    technicalClass: e.technicalClass,
    iconKey: e.iconKey,
    observedVersion: e.observedVersion,
    normalizedVersion: e.normalizedVersion,
    attributionConfidence: e.attributionConfidence,
    lastSeenAt: e.lastSeenAt,
  }));
}

function projectOpenQualityIssues(
  issues: ToDigitalProductViewModelInput["qualityIssues"],
): DigitalProductView["openQualityIssues"] {
  return sortNewestFirst(
    issues.filter((issue) => issue.status === "open"),
    (issue) => issue.lastDetectedAt,
    (issue) => issue.id,
  )
    .slice(0, 10)
    .map((i) => ({
      id: i.id,
      issueType: i.issueType,
      severity: i.severity,
      summary: i.summary,
      lastDetectedAt: i.lastDetectedAt,
    }));
}

// --- public ------------------------------------------------------------

export function toDigitalProductViewModel(
  input: ToDigitalProductViewModelInput,
): DigitalProductView {
  const { product, taxonomyAncestors, inventoryEntities, qualityIssues } = input;

  return {
    id: product.id,
    productId: product.productId,
    name: product.name,
    description: product.description,
    version: product.version,
    lifecycleStage: product.lifecycleStage,
    lifecycleStatus: product.lifecycleStatus,
    observationConfig: projectObservationConfig(product.observationConfig),
    coworker: projectCoworker(product.observationConfig),
    taxonomyLineage: projectTaxonomyLineage(taxonomyAncestors, product.taxonomyNode),
    portfolio: product.portfolio,
    primaryEntity: projectLinkedEntities(inventoryEntities)[0] ?? null,
    linkedEntities: projectLinkedEntities(inventoryEntities),
    linkedEntityCount: inventoryEntities.length,
    freshness: input.freshness ?? null,
    enrichmentStatus: input.enrichmentStatus ?? null,
    lastEnrichedAt: input.lastEnrichedAt ?? null,
    openQualityIssues: projectOpenQualityIssues(qualityIssues),
  };
}
