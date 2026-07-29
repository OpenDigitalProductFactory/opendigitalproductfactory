/**
 * Portfolio completeness scoring (Task 7.1 of the discovery -> portfolio
 * gap closure plan).
 *
 * Pure helper over an injected db handle. Returns three orthogonal numbers
 * powering the Portfolio Analyst's daily review (Task 7.5) and the
 * `CompletenessStrip` UI (Task 7.2):
 *
 *   1. requiredFieldsScore — % of products whose containing taxonomy node's
 *      `governance.requiredFields` are all populated from product metadata
 *      or linked inventory identity evidence. Null until at least one node
 *      has a non-empty required-fields list. Begins to vary once Task 7.3's
 *      `set_node_required_fields` lands.
 *   2. enrichmentScore — % of products with `enrichmentStatus === "enriched"`.
 *      Null until Chunk 4 Task 4.1 adds the column and the query projects it.
 *   3. openIssuesByType — counts of open `PortfolioQualityIssue` rows scoped
 *      to the portfolio, keyed by `issueType`.
 *
 * Defensive against malformed `governance` JSON: any non-`string[]`
 * `requiredFields` value is treated as if there were no required fields.
 */

import { INVENTORY_ENTITY_CANONICAL_WHERE, type Prisma } from "@dpf/db";

export interface PortfolioCompletenessScores {
  /** % (0–100) of products in the portfolio with all required fields populated. Null when no product has a non-empty required-fields list. */
  requiredFieldsScore: number | null;
  /** % (0–100) of products with enrichmentStatus === "enriched". Null when the schema column does not exist or no products are present. */
  enrichmentScore: number | null;
  /** Open PortfolioQualityIssue counts keyed by issueType. */
  openIssuesByType: Record<string, number>;
  /** Total products counted (denominator). */
  productCount: number;
}

interface PortfolioCompletenessInventoryEntity {
  manufacturer?: string | null;
  observedVersion?: string | null;
  normalizedVersion?: string | null;
  productModel?: string | null;
  technicalClass?: string | null;
  iconKey?: string | null;
}

type PortfolioCompletenessProduct = {
  id: string;
  taxonomyNode: { governance: unknown } | null;
  observationConfig: unknown;
  inventoryEntities?: PortfolioCompletenessInventoryEntity[];
  // Forward-compat: when Chunk 4 lands, callers can include enrichmentStatus.
  enrichmentStatus?: string | null;
  // Required-field source values are passed through product metadata,
  // observationConfig, and derived aliases from linked inventory entity
  // evidence. Test harnesses may still pass explicit aliases directly.
} & Record<string, unknown>;

export interface PortfolioCompletenessDb {
  digitalProduct: {
    findMany(args: {
      where: { portfolioId: string };
      select: Record<string, unknown>;
    }): Promise<PortfolioCompletenessProduct[]>;
  };
  portfolioQualityIssue: {
    groupBy(args: {
      where: { portfolioId: string; status: string };
      by: ["issueType"];
      _count: { _all: true };
    }): Promise<Array<{ issueType: string; _count: { _all: number } }>>;
  };
}

export const DIGITAL_PRODUCT_COMPLETENESS_SELECT = {
  id: true,
  observationConfig: true,
  inventoryEntities: {
    where: INVENTORY_ENTITY_CANONICAL_WHERE,
    select: {
      manufacturer: true,
      observedVersion: true,
      normalizedVersion: true,
      productModel: true,
      technicalClass: true,
      iconKey: true,
    },
  },
  taxonomyNode: { select: { governance: true } },
} satisfies Prisma.DigitalProductSelect;

/**
 * Pull the `requiredFields` list off a node's governance JSON, defending
 * against missing / malformed shapes. Anything that isn't an array of
 * strings collapses to an empty list.
 */
function readRequiredFields(governance: unknown): string[] {
  if (!governance || typeof governance !== "object") {
    return [];
  }
  const candidate = (governance as Record<string, unknown>).requiredFields;
  if (!Array.isArray(candidate)) {
    return [];
  }
  return candidate.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Walk a dot-separated path through a product record. Returns `undefined`
 * when any segment misses, when an intermediate value isn't an object, or
 * when the leaf is null/undefined/empty-string.
 */
function readPath(source: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".");
  let cursor: unknown = source;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined) {
      return undefined;
    }
    if (typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * A required-field value counts as "populated" iff it is neither nullish
 * nor an empty string. Empty arrays/objects are treated as populated since
 * they're explicit caller-supplied shapes; the spec's notion of completeness
 * is about presence, not depth.
 */
function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string" && value.length === 0) {
    return false;
  }
  return true;
}

const INVENTORY_REQUIRED_FIELD_ALIASES: Record<string, Array<keyof PortfolioCompletenessInventoryEntity>> = {
  manufacturer: ["manufacturer"],
  observedVersion: ["observedVersion", "normalizedVersion"],
  normalizedVersion: ["normalizedVersion", "observedVersion"],
  productModel: ["productModel"],
  technicalClass: ["technicalClass"],
  iconKey: ["iconKey"],
};

function firstInventoryValue(
  entities: PortfolioCompletenessInventoryEntity[] | undefined,
  fields: Array<keyof PortfolioCompletenessInventoryEntity>,
): unknown {
  for (const entity of entities ?? []) {
    for (const field of fields) {
      const value = entity[field];
      if (isPopulated(value)) {
        return value;
      }
    }
  }
  return undefined;
}

function readInventoryAlias(source: Record<string, unknown>, path: string): unknown {
  const fields = INVENTORY_REQUIRED_FIELD_ALIASES[path];
  if (!fields) {
    return undefined;
  }

  const entities = source.inventoryEntities;
  if (!Array.isArray(entities)) {
    return undefined;
  }

  const identityEvidence = entities.filter(
    (entity): entity is PortfolioCompletenessInventoryEntity =>
      entity !== null && typeof entity === "object",
  );
  return firstInventoryValue(identityEvidence, fields);
}

function readRequiredFieldValue(source: Record<string, unknown>, path: string): unknown {
  const directValue = readPath(source, path);
  if (isPopulated(directValue)) {
    return directValue;
  }

  return readInventoryAlias(source, path);
}

export async function computePortfolioCompleteness(
  portfolioId: string,
  db: PortfolioCompletenessDb,
): Promise<PortfolioCompletenessScores> {
  const [products, issueGroups] = await Promise.all([
    db.digitalProduct.findMany({
      where: { portfolioId },
      select: DIGITAL_PRODUCT_COMPLETENESS_SELECT,
    }),
    db.portfolioQualityIssue.groupBy({
      where: { portfolioId, status: "open" },
      by: ["issueType"],
      _count: { _all: true },
    }),
  ]);

  const productCount = products.length;

  // Required-fields score — only products whose taxonomy node defines a
  // non-empty `governance.requiredFields` count toward the denominator.
  let gatedProductCount = 0;
  let completeGatedProductCount = 0;
  for (const product of products) {
    const required = readRequiredFields(product.taxonomyNode?.governance);
    if (required.length === 0) continue;
    gatedProductCount += 1;
    const allPopulated = required.every((path) =>
      isPopulated(readRequiredFieldValue(product, path)),
    );
    if (allPopulated) {
      completeGatedProductCount += 1;
    }
  }
  const requiredFieldsScore =
    gatedProductCount === 0 ? null : (completeGatedProductCount / gatedProductCount) * 100;

  // Enrichment score — null when the column is absent on every row OR when
  // there are no products at all. Otherwise % of products marked "enriched".
  let anyHasEnrichmentField = false;
  let enrichedCount = 0;
  for (const product of products) {
    if (Object.prototype.hasOwnProperty.call(product, "enrichmentStatus")) {
      anyHasEnrichmentField = true;
      if (product.enrichmentStatus === "enriched") {
        enrichedCount += 1;
      }
    }
  }
  const enrichmentScore =
    productCount === 0 || !anyHasEnrichmentField ? null : (enrichedCount / productCount) * 100;

  // Open issue counts keyed by issueType.
  const openIssuesByType: Record<string, number> = {};
  for (const group of issueGroups) {
    openIssuesByType[group.issueType] = group._count._all;
  }

  return {
    requiredFieldsScore,
    enrichmentScore,
    openIssuesByType,
    productCount,
  };
}
