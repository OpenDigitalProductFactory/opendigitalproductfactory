import { summarizeProductSoldRevenue } from "../products/commercial-performance";
import {
  classifyEvidenceFreshness,
  sortNewestFirst,
} from "../portfolio/evidence-view-adapters";

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
  scope: "organization" | "digital-product";
  digitalProductId: string | null;
  status: string;
};

export type DemandContextItem = ContextItem & {
  title: string;
  status: string;
  demandStage?: string | null;
  score?: number | null;
};

export type NamedStatusContextItem = ContextItem & {
  title: string;
  status: string;
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
  objectives: ContextSlice<NamedStatusContextItem>;
  roadmapInputs: ContextSlice<NamedStatusContextItem>;
  deliveryChanges: ContextSlice<NamedStatusContextItem>;
  architecture: ContextSlice<NamedStatusContextItem>;
  scheduledPlaybooks: ContextSlice<NamedStatusContextItem>;
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
  intelligence: ContextSlice<IntelligenceContextItem>;
  demand: ContextSlice<DemandContextItem>;
  decisions: ContextSlice<NamedStatusContextItem>;
  objectives: ContextSlice<NamedStatusContextItem>;
  roadmapInputs: ContextSlice<NamedStatusContextItem>;
  deliveryChanges: ContextSlice<NamedStatusContextItem>;
  architecture: ContextSlice<NamedStatusContextItem>;
  scheduledPlaybooks: ContextSlice<NamedStatusContextItem>;
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

function prioritizeScopedIntelligence(
  slice: ContextSlice<IntelligenceContextItem>,
): ContextSlice<IntelligenceContextItem> {
  return {
    ...slice,
    items: [...slice.items].sort(
      (left, right) =>
        Number(right.scope === "digital-product") -
          Number(left.scope === "digital-product") ||
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
