import { summarizeProductSoldRevenue } from "../products/commercial-performance";
import {
  classifyEvidenceFreshness,
  sortNewestFirst,
} from "../portfolio/evidence-view-adapters";
import type { ProductObjectiveView } from "./outcomes";

export type ProductOperatingScope =
  | { kind: "organization"; id: string }
  | { kind: "product-line"; id: string }
  | { kind: "product"; id: string };

export type ContextAvailability = "available" | "partial" | "unavailable";
export type ContextFreshness = "fresh" | "stale" | "unknown";

export interface ContextItem {
  /** Canonical row or semantic identifier from the source authority. */
  id: string;
  sourceKind: string;
  asOf: Date;
}

export interface ContextSlice<T extends ContextItem> {
  availability: ContextAvailability;
  freshness: ContextFreshness;
  asOf: Date;
  sourceKind: string;
  items: T[];
  reason: string | null;
}

export type OrganizationContextItem = ContextItem & {
  name: string;
};

export type ProductLineContextItem = ContextItem & {
  name: string;
  parentId: string | null;
};

export type BusinessProductContextItem = ContextItem & {
  productId: string;
  productLineId: string;
  name: string;
};

export type EnablingDigitalProductContextItem = ContextItem & {
  productId: string;
  name: string;
};

export type ProductOfferingContextItem = ContextItem & {
  productId: string;
  providerOrganizationId: string;
  name: string;
  status: string;
};

export type CatalogItemContextItem = ContextItem & {
  productId: string;
  name: string;
  status: string;
};

export type ConsumerEvidenceContextItem = ContextItem & {
  role: "account" | "consumer" | "subscriber";
  label: string;
  canonicalLinkEstablished: boolean;
};

export type ProductSoldContextItem = ContextItem & {
  productId: string;
  status: string;
  quantity: number;
  totalAmount: number;
  currency: string;
  consumerEvidence: ConsumerEvidenceContextItem[];
  componentAllocations: Array<{
    catalogItemId: string;
    allocatedAmount: number | null;
    allocationMode?: string;
  }>;
};

export type IntelligenceContextItem = ContextItem & {
  title: string;
  /** Human-readable evidence or proposal detail; never interpreted as scope. */
  detail?: string | null;
  relatedProposalId?: string | null;
  scope:
    | "organization"
    | "product-line"
    | "business-product"
    | "digital-product";
  productLineId?: string | null;
  businessProductId?: string | null;
  digitalProductId: string | null;
  status: string;
  confidence?: "low" | "medium" | "high" | null;
  comparisonKind?: "first-run" | "changed-since" | null;
  emptyReason?:
    | "no-results"
    | "provider-unavailable"
    | "synthesis-empty"
    | null;
  retrievedAt?: Date | null;
  sourceUrls?: string[];
};

export type DemandContextItem = ContextItem & {
  title: string;
  status: string;
  workType?: string | null;
  productLineId?: string | null;
  businessProductId?: string | null;
  demandStage?: string | null;
  score?: number | null;
  effortSize?: string | null;
  investmentBucket?: string | null;
  evidenceCount?: number;
  readiness?: {
    classified: boolean;
    evidenceReady: boolean;
    scoreReady: boolean;
    fundingReady: boolean;
  };
  blockers?: string[];
  latestDecision?: {
    summary: string;
    recordedAt: Date;
    payload: Record<string, unknown>;
  } | null;
  lastEvidenceChange?: {
    kind: string;
    summary: string;
    recordedAt: Date;
  } | null;
  delivery?: {
    sourceId: string;
    phase: string;
    asOf: Date;
    shippedAt: Date | null;
  } | null;
};

export type NamedStatusContextItem = ContextItem & {
  title: string;
  status: string;
};

export type RoadmapCoordinationContextItem = NamedStatusContextItem & {
  coordinationKind: "architecture" | "delivery";
  plannedStartAt?: Date | null;
  plannedEndAt?: Date | null;
  fromProductId?: string | null;
  toProductId?: string | null;
  relationType?: string | null;
};

export type ProductObjectiveContextItem = ContextItem &
  ProductObjectiveView & {
    /** Canonical business Product row id retained for line-level attribution. */
    productId: string;
  };

export type ScheduledPlaybookContextItem = NamedStatusContextItem & {
  taskId: string;
  scope: "organization" | "product-line" | "business-product";
  productLineId: string | null;
  businessProductId: string | null;
  schedule: string;
  isActive: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  taskRunId: string | null;
  lastStatus: string | null;
  lastError: string | null;
  taskKind: string | null;
  recipeId: string | null;
  permissionsDigest: string | null;
  permissionsCurrent: boolean | null;
};

export interface ProductOperatingContextInput {
  requestedAt: Date;
  scope: ProductOperatingScope;
  organization: OrganizationContextItem;
  productLines: ProductLineContextItem[];
  productLine: ProductLineContextItem | null;
  products: BusinessProductContextItem[];
  enablingDigitalProducts: ContextSlice<EnablingDigitalProductContextItem>;
  offerings: ContextSlice<ProductOfferingContextItem>;
  catalogItems: ContextSlice<CatalogItemContextItem>;
  productSold: ContextSlice<ProductSoldContextItem>;
  intelligence: ContextSlice<IntelligenceContextItem>;
  demand: ContextSlice<DemandContextItem>;
  decisions: ContextSlice<NamedStatusContextItem>;
  objectives: ContextSlice<ProductObjectiveContextItem>;
  roadmapInputs: ContextSlice<NamedStatusContextItem>;
  deliveryChanges: ContextSlice<RoadmapCoordinationContextItem>;
  architecture: ContextSlice<RoadmapCoordinationContextItem>;
  scheduledPlaybooks: ContextSlice<ScheduledPlaybookContextItem>;
}

export interface ProductOperatingContext {
  scope: ProductOperatingScope;
  requestedAt: Date;
  provider: ContextItem & {
    name: string;
    derivedFromOrganization: true;
  };
  productLines: ProductLineContextItem[];
  productLine: ProductLineContextItem | null;
  products: BusinessProductContextItem[];
  consumers: ContextSlice<ConsumerEvidenceContextItem>;
  enablingDigitalProducts: ContextSlice<EnablingDigitalProductContextItem>;
  offerings: ContextSlice<ProductOfferingContextItem>;
  catalogItems: ContextSlice<CatalogItemContextItem>;
  productSold: ContextSlice<ProductSoldContextItem>;
  commercialPerformance: {
    saleCount: number;
    additiveRevenue: number;
    currency: string | null;
    componentAllocations: Array<{
      catalogItemId: string;
      allocatedAmount: number;
      additive: false;
    }>;
    unallocatedComponentCount: number;
  };
  commercialPerformanceByProduct: Array<{
    productId: string;
    saleCount: number;
    additiveRevenue: number;
    currency: string | null;
    unallocatedComponentCount: number;
  }>;
  intelligence: ContextSlice<IntelligenceContextItem>;
  demand: ContextSlice<DemandContextItem>;
  decisions: ContextSlice<NamedStatusContextItem>;
  objectives: ContextSlice<ProductObjectiveContextItem>;
  roadmapInputs: ContextSlice<NamedStatusContextItem>;
  deliveryChanges: ContextSlice<RoadmapCoordinationContextItem>;
  architecture: ContextSlice<RoadmapCoordinationContextItem>;
  scheduledPlaybooks: ContextSlice<ScheduledPlaybookContextItem>;
}

export function classifyContextFreshness(
  asOf: Date | null,
  requestedAt: Date,
  staleAfterDays: number,
): ContextFreshness {
  return classifyEvidenceFreshness(asOf, requestedAt, staleAfterDays);
}

/**
 * Shared newest-first ordering for evidence-backed view models. Ties resolve
 * by canonical identifier so query/database ordering differences cannot change
 * the projection.
 */
export function sortContextItems<T extends ContextItem>(items: readonly T[]): T[] {
  return sortNewestFirst(
    items,
    (item) => item.asOf,
    (item) => item.id,
  );
}

/**
 * Resolve one product-line rollup without changing the canonical hierarchy.
 * A visited set keeps a malformed legacy cycle from looping at read time.
 */
export function collectProductLineSubtreeIds(
  lines: ReadonlyArray<{ id: string; parentId: string | null }>,
  rootId: string,
): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const line of lines) {
    if (!line.parentId) continue;
    const children = childrenByParent.get(line.parentId) ?? [];
    children.push(line.id);
    childrenByParent.set(line.parentId, children);
  }

  const ids: string[] = [];
  const pending = [rootId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const id = pending.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    ids.push(id);
    pending.push(
      ...(childrenByParent.get(id) ?? []).sort((left, right) =>
        left.localeCompare(right),
      ),
    );
  }
  return ids;
}

export function createContextSlice<T extends ContextItem>(input: {
  requestedAt: Date;
  sourceKind: string;
  items: readonly T[];
  staleAfterDays?: number;
  unavailableReason?: string;
  partialReason?: string;
}): ContextSlice<T> {
  const items = sortContextItems(input.items);
  const newest = items[0]?.asOf ?? input.requestedAt;
  const availability: ContextAvailability = input.unavailableReason
    ? "unavailable"
    : input.partialReason
      ? "partial"
      : "available";
  return {
    availability,
    freshness:
      availability === "unavailable" || items.length === 0
        ? "unknown"
        : classifyContextFreshness(
            newest,
            input.requestedAt,
            input.staleAfterDays ?? 30,
          ),
    asOf: newest,
    sourceKind: input.sourceKind,
    items,
    reason: input.unavailableReason ?? input.partialReason ?? null,
  };
}

function projectConsumers(
  input: ProductOperatingContextInput,
): ContextSlice<ConsumerEvidenceContextItem> {
  const byEvidenceId = new Map<string, ConsumerEvidenceContextItem>();
  for (const sold of input.productSold.items) {
    for (const consumer of sold.consumerEvidence) {
      byEvidenceId.set(consumer.id, consumer);
    }
  }
  return createContextSlice({
    requestedAt: input.requestedAt,
    sourceKind: "product-sold-party-or-evidence",
    items: [...byEvidenceId.values()],
    partialReason:
      input.productSold.availability === "partial"
        ? input.productSold.reason ?? "Some Product Sold evidence is partial."
        : undefined,
    unavailableReason:
      input.productSold.availability === "unavailable"
        ? input.productSold.reason ??
          "Product Sold evidence is unavailable for this scope."
        : undefined,
  });
}

function projectCommercialPerformance(
  sold: ContextSlice<ProductSoldContextItem>,
): ProductOperatingContext["commercialPerformance"] {
  const summary = summarizeProductSoldRevenue(
    sold.items.map((row) => ({
      productSoldId: row.id,
      status: row.status,
      totalAmount: row.totalAmount,
      componentAllocations: row.componentAllocations.flatMap((allocation) =>
        allocation.allocatedAmount === null
          ? []
          : [
              {
                catalogItemId: allocation.catalogItemId,
                allocatedAmount: allocation.allocatedAmount,
              },
            ],
      ),
    })),
  );
  const currencies = new Set(sold.items.map((row) => row.currency));
  return {
    ...summary,
    currency: currencies.size === 1 ? [...currencies][0]! : null,
    unallocatedComponentCount: sold.items.reduce(
      (count, row) =>
        count +
        row.componentAllocations.filter(
          (allocation) => allocation.allocatedAmount === null,
        ).length,
      0,
    ),
  };
}

function projectCommercialPerformanceByProduct(
  products: readonly BusinessProductContextItem[],
  sold: ContextSlice<ProductSoldContextItem>,
): ProductOperatingContext["commercialPerformanceByProduct"] {
  return products.map((product) => {
    const rows = sold.items.filter((row) => row.productId === product.id);
    const summary = summarizeProductSoldRevenue(
      rows.map((row) => ({
        productSoldId: row.id,
        status: row.status,
        totalAmount: row.totalAmount,
        componentAllocations: [],
      })),
    );
    const currencies = new Set(rows.map((row) => row.currency));
    return {
      productId: product.id,
      saleCount: summary.saleCount,
      additiveRevenue: summary.additiveRevenue,
      currency: currencies.size === 1 ? [...currencies][0]! : null,
      unallocatedComponentCount: rows.reduce(
        (count, row) =>
          count +
          row.componentAllocations.filter(
            (allocation) => allocation.allocatedAmount === null,
          ).length,
        0,
      ),
    };
  });
}

function prioritizeScopedIntelligence(
  slice: ContextSlice<IntelligenceContextItem>,
): ContextSlice<IntelligenceContextItem> {
  const scopePriority: Record<IntelligenceContextItem["scope"], number> = {
    "business-product": 4,
    "product-line": 3,
    "digital-product": 2,
    organization: 1,
  };
  return {
    ...slice,
    items: [...slice.items].sort(
      (left, right) =>
        scopePriority[right.scope] - scopePriority[left.scope] ||
        right.asOf.getTime() - left.asOf.getTime() ||
        left.id.localeCompare(right.id),
    ),
  };
}

export function assembleProductOperatingContext(
  input: ProductOperatingContextInput,
): ProductOperatingContext {
  return {
    scope: input.scope,
    requestedAt: input.requestedAt,
    provider: {
      id: input.organization.id,
      sourceKind: input.organization.sourceKind,
      asOf: input.organization.asOf,
      name: input.organization.name,
      derivedFromOrganization: true,
    },
    productLines: sortContextItems(input.productLines),
    productLine: input.productLine,
    products: sortContextItems(input.products),
    consumers: projectConsumers(input),
    enablingDigitalProducts: input.enablingDigitalProducts,
    offerings: input.offerings,
    catalogItems: input.catalogItems,
    productSold: input.productSold,
    commercialPerformance: projectCommercialPerformance(input.productSold),
    commercialPerformanceByProduct: projectCommercialPerformanceByProduct(
      sortContextItems(input.products),
      input.productSold,
    ),
    intelligence: prioritizeScopedIntelligence(input.intelligence),
    demand: input.demand,
    decisions: input.decisions,
    objectives: input.objectives,
    roadmapInputs: input.roadmapInputs,
    deliveryChanges: input.deliveryChanges,
    architecture: input.architecture,
    scheduledPlaybooks: input.scheduledPlaybooks,
  };
}
