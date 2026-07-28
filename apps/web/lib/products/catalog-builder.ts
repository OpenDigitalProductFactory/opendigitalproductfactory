import type { Prisma, PrismaClient } from "@dpf/db";

import { newId } from "../shared/new-id";
import { STOREFRONT_CTA_FULFILLMENT_ROUTES } from "./storefront-commercial-options";

export const CATALOG_FULFILLMENT_ROUTES = [
  "direct-purchase",
  "booking",
  "configured-purchase",
  "quote",
  "subscription",
  "reservation",
  "verified-other",
] as const;
export type CatalogFulfillmentRoute =
  (typeof CATALOG_FULFILLMENT_ROUTES)[number];

export const CATALOG_PRICE_LIST_STATUSES = [
  "draft",
  "active",
  "retired",
] as const;
export type CatalogPriceListStatus =
  (typeof CATALOG_PRICE_LIST_STATUSES)[number];

export const CATALOG_PROMOTION_STATUSES = [
  "draft",
  "active",
  "retired",
] as const;
export type CatalogPromotionStatus =
  (typeof CATALOG_PROMOTION_STATUSES)[number];

export const CATALOG_PROMOTION_ADJUSTMENT_TYPES = [
  "percentage",
  "fixed-amount",
  "fixed-price",
] as const;
export type CatalogPromotionAdjustmentType =
  (typeof CATALOG_PROMOTION_ADJUSTMENT_TYPES)[number];

export const CATALOG_CHANNEL_ELIGIBILITY = [
  "eligible",
  "ineligible",
] as const;
export type CatalogChannelEligibility =
  (typeof CATALOG_CHANNEL_ELIGIBILITY)[number];

export const BUNDLE_COMPONENT_ELIGIBILITY = [
  "standalone-and-bundle",
  "bundle-only",
] as const;
export type BundleComponentEligibility =
  (typeof BUNDLE_COMPONENT_ELIGIBILITY)[number];

export const BUNDLE_ALLOCATION_MODES = [
  "percentage",
  "equal",
  "unallocated",
] as const;
export type BundleAllocationMode = (typeof BUNDLE_ALLOCATION_MODES)[number];

export function deriveCatalogFulfillmentRoute(input: {
  storedRoute: string | null;
  quoteRequired: boolean;
  storefrontCtaType: string | null;
}): CatalogFulfillmentRoute | null {
  if (
    input.storedRoute &&
    CATALOG_FULFILLMENT_ROUTES.includes(
      input.storedRoute as CatalogFulfillmentRoute,
    )
  ) {
    return input.storedRoute as CatalogFulfillmentRoute;
  }
  if (input.quoteRequired) return "quote";
  return input.storefrontCtaType
    ? ((STOREFRONT_CTA_FULFILLMENT_ROUTES[
        input.storefrontCtaType as keyof typeof STOREFRONT_CTA_FULFILLMENT_ROUTES
      ] as CatalogFulfillmentRoute | undefined) ?? null)
    : null;
}

type EffectiveWindow = {
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export function currentEffectiveWindowFilter(asOf: Date) {
  return {
    effectiveFrom: { lte: asOf },
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
  };
}

export function validateEffectiveWindow(
  input: EffectiveWindow,
): { ok: true; error: null } | { ok: false; error: string } {
  if (
    input.effectiveTo &&
    input.effectiveTo.getTime() <= input.effectiveFrom.getTime()
  ) {
    return {
      ok: false,
      error: "effectiveTo must be later than effectiveFrom",
    };
  }
  return { ok: true, error: null };
}

function isEffective(input: EffectiveWindow, asOf: Date): boolean {
  return (
    input.effectiveFrom.getTime() <= asOf.getTime() &&
    (input.effectiveTo == null ||
      input.effectiveTo.getTime() > asOf.getTime())
  );
}

type CatalogPriceEntry = EffectiveWindow & {
  id: string;
  catalogItemId: string;
  catalogSkuId: string | null;
  priceAmount: number;
  priceList: EffectiveWindow & {
    id: string;
    status: string;
  };
};

type CatalogPromotionPriceRule = EffectiveWindow & {
  id: string;
  status: string;
  adjustmentType: string;
  adjustmentValue: number;
};

export function resolveEffectiveCatalogPrice(input: {
  asOf: Date;
  catalogItemId: string;
  catalogSkuId: string | null;
  basePrice: number;
  priceEntries: CatalogPriceEntry[];
  promotions: CatalogPromotionPriceRule[];
}): {
  baseAmount: number;
  finalAmount: number;
  priceListEntryId: string | null;
  promotionIds: string[];
} {
  const eligibleEntries = input.priceEntries
    .filter(
      (entry) =>
        entry.catalogItemId === input.catalogItemId &&
        entry.priceList.status === "active" &&
        isEffective(entry, input.asOf) &&
        isEffective(entry.priceList, input.asOf) &&
        (entry.catalogSkuId == null ||
          entry.catalogSkuId === input.catalogSkuId),
    )
    .sort((left, right) => {
      const leftExact =
        input.catalogSkuId != null && left.catalogSkuId === input.catalogSkuId;
      const rightExact =
        input.catalogSkuId != null && right.catalogSkuId === input.catalogSkuId;
      if (leftExact !== rightExact) return leftExact ? -1 : 1;
      return right.effectiveFrom.getTime() - left.effectiveFrom.getTime();
    });

  const selected = eligibleEntries[0] ?? null;
  const baseAmount = selected?.priceAmount ?? input.basePrice;
  const activePromotions = input.promotions
    .filter(
      (promotion) =>
        promotion.status === "active" &&
        isEffective(promotion, input.asOf),
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  let finalAmount = baseAmount;
  for (const promotion of activePromotions) {
    switch (promotion.adjustmentType) {
      case "percentage":
        finalAmount *= 1 - promotion.adjustmentValue / 100;
        break;
      case "fixed-amount":
        finalAmount -= promotion.adjustmentValue;
        break;
      case "fixed-price":
        finalAmount = promotion.adjustmentValue;
        break;
    }
  }

  return {
    baseAmount: roundCurrency(baseAmount),
    finalAmount: roundCurrency(Math.max(0, finalAmount)),
    priceListEntryId: selected?.id ?? null,
    promotionIds: activePromotions.map((promotion) => promotion.id),
  };
}

export type BundleComponentInput = {
  catalogItemId: string;
  quantity: number;
  allocationMode: BundleAllocationMode;
  allocationPercent: number | null;
};

export function resetBundleToEqualAllocation<T extends BundleComponentInput>(
  components: T[],
): T[] {
  return components.map((component) => ({
    ...component,
    allocationMode: "equal",
    allocationPercent: null,
  }));
}

export function validateBundleComponents(input: {
  parentCatalogItemId: string;
  components: BundleComponentInput[];
}): { ok: true; error: null } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (const component of input.components) {
    if (component.catalogItemId === input.parentCatalogItemId) {
      return { ok: false, error: "A catalog item cannot contain itself" };
    }
    if (seen.has(component.catalogItemId)) {
      return {
        ok: false,
        error: "A catalog item can appear only once in a package",
      };
    }
    seen.add(component.catalogItemId);
    if (!Number.isFinite(component.quantity) || component.quantity <= 0) {
      return { ok: false, error: "Component quantity must be greater than zero" };
    }
  }

  const percentageComponents = input.components.filter(
    (component) => component.allocationMode === "percentage",
  );
  if (percentageComponents.length > 0) {
    if (percentageComponents.length !== input.components.length) {
      return {
        ok: false,
        error: "Percentage allocation cannot be mixed with other modes",
      };
    }
    if (
      percentageComponents.some(
        (component) =>
          component.allocationPercent == null ||
          !Number.isFinite(component.allocationPercent) ||
          component.allocationPercent < 0 ||
          component.allocationPercent > 100,
      )
    ) {
      return {
        ok: false,
        error: "Percentage allocation must be between 0 and 100",
      };
    }
    const total = percentageComponents.reduce(
      (sum, component) => sum + (component.allocationPercent ?? 0),
      0,
    );
    if (Math.abs(total - 100) > 0.0001) {
      return {
        ok: false,
        error: "Percentage allocations must total 100",
      };
    }
  }

  return { ok: true, error: null };
}

export function allocateBundleRevenue(input: {
  packageRevenue: number;
  components: BundleComponentInput[];
}): {
  packageRevenue: number;
  commercialSaleCount: 1;
  componentAttribution: Array<{
    catalogItemId: string;
    allocatedRevenue: number;
    additive: false;
  }>;
} {
  const validation = validateBundleComponents({
    parentCatalogItemId: "__package__",
    components: input.components,
  });
  if (!validation.ok) throw new Error(validation.error);

  const equalCount = input.components.filter(
    (component) => component.allocationMode === "equal",
  ).length;
  let allocatedSoFar = 0;
  let equalIndex = 0;
  const componentAttribution = input.components.map((component) => {
    let allocatedRevenue = 0;
    if (component.allocationMode === "percentage") {
      allocatedRevenue =
        input.packageRevenue * (component.allocationPercent ?? 0) / 100;
    } else if (component.allocationMode === "equal" && equalCount > 0) {
      equalIndex += 1;
      allocatedRevenue =
        equalIndex === equalCount
          ? input.packageRevenue - allocatedSoFar
          : input.packageRevenue / equalCount;
    }
    allocatedRevenue = roundCurrency(allocatedRevenue);
    allocatedSoFar += allocatedRevenue;
    return {
      catalogItemId: component.catalogItemId,
      allocatedRevenue,
      additive: false as const,
    };
  });

  return {
    packageRevenue: roundCurrency(input.packageRevenue),
    commercialSaleCount: 1,
    componentAttribution,
  };
}

export type CatalogSelectionSignalEvidence = {
  selectionId: string;
  revenue: number;
  cost: number | null;
  quoted: boolean;
  converted: boolean;
  bundleComponentIds: string[];
  configurationValues: Record<
    string,
    string | number | boolean | null
  > | null;
};

export function summarizeCatalogBuilderSignals(
  evidence: CatalogSelectionSignalEvidence[],
): {
  commercialSaleCount: number;
  revenue: number;
  cost: number | null;
  margin: number | null;
  marginRate: number | null;
  costCoverageRate: number;
  quoteConversion: {
    quotedSelections: number;
    convertedSelections: number;
    conversionRate: number;
  };
  componentAttach: Array<{
    catalogItemId: string;
    selections: number;
    attachRate: number;
  }>;
  optionDemand: Array<{ option: string; selections: number }>;
} {
  const selections = [
    ...new Map(
      evidence.map((selection) => [selection.selectionId, selection]),
    ).values(),
  ];
  const commercialSaleCount = selections.length;
  const revenue = roundCurrency(
    selections.reduce((sum, selection) => sum + selection.revenue, 0),
  );
  const costEvidence = selections.filter(
    (selection): selection is CatalogSelectionSignalEvidence & { cost: number } =>
      selection.cost != null && Number.isFinite(selection.cost),
  );
  const hasCompleteCost = costEvidence.length === commercialSaleCount;
  const cost = hasCompleteCost
    ? roundCurrency(
        costEvidence.reduce((sum, selection) => sum + selection.cost, 0),
      )
    : null;
  const margin = cost == null ? null : roundCurrency(revenue - cost);
  const marginRate =
    margin == null || revenue === 0
      ? null
      : roundPercentage((margin / revenue) * 100);

  const quoted = selections.filter((selection) => selection.quoted);
  const convertedSelections = quoted.filter(
    (selection) => selection.converted,
  ).length;
  const componentCounts = new Map<string, number>();
  const optionCounts = new Map<string, number>();
  for (const selection of selections) {
    for (const catalogItemId of new Set(selection.bundleComponentIds)) {
      componentCounts.set(
        catalogItemId,
        (componentCounts.get(catalogItemId) ?? 0) + 1,
      );
    }
    for (const [key, value] of Object.entries(
      selection.configurationValues ?? {},
    )) {
      if (value == null) continue;
      const option = `${key}=${String(value)}`;
      optionCounts.set(option, (optionCounts.get(option) ?? 0) + 1);
    }
  }

  return {
    commercialSaleCount,
    revenue,
    cost,
    margin,
    marginRate,
    costCoverageRate: rate(costEvidence.length, commercialSaleCount),
    quoteConversion: {
      quotedSelections: quoted.length,
      convertedSelections,
      conversionRate: rate(convertedSelections, quoted.length),
    },
    componentAttach: [...componentCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([catalogItemId, count]) => ({
        catalogItemId,
        selections: count,
        attachRate: rate(count, commercialSaleCount),
      })),
    optionDemand: [...optionCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([option, count]) => ({ option, selections: count })),
  };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

export function createCommercialSelectionSnapshot(input: {
  catalogItem: {
    catalogItemId: string;
    name: string;
    fulfillmentRoute: CatalogFulfillmentRoute;
  };
  catalogSku: { skuId: string; code: string } | null;
  configuration: {
    kind: "one-off" | "reusable";
    values: Record<string, unknown>;
  } | null;
  price: {
    amount: number;
    currency: string;
    promotionIds: string[];
  };
  bundleComponents: Array<{
    catalogItemId: string;
    quantity: number;
  }>;
  capturedAt: Date;
}) {
  return deepFreeze({
    version: 1 as const,
    catalogItem: structuredClone(input.catalogItem),
    catalogSku: input.catalogSku ? structuredClone(input.catalogSku) : null,
    configuration: input.configuration
      ? structuredClone(input.configuration)
      : null,
    price: structuredClone(input.price),
    bundleComponents: structuredClone(input.bundleComponents),
    capturedAt: input.capturedAt.toISOString(),
  });
}

type OneOffPromotionClient = {
  quoteLineItem: Pick<PrismaClient["quoteLineItem"], "findUnique">;
  productConfiguration: Pick<
    PrismaClient["productConfiguration"],
    "upsert"
  >;
  catalogSku: Pick<PrismaClient["catalogSku"], "findUnique" | "upsert">;
};

function oneOffValues(snapshot: unknown): Record<string, unknown> | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  const configuration = (snapshot as Record<string, unknown>)["configuration"];
  if (
    !configuration ||
    typeof configuration !== "object" ||
    Array.isArray(configuration)
  ) {
    return null;
  }
  const record = configuration as Record<string, unknown>;
  if (
    record["kind"] !== "one-off" ||
    !record["values"] ||
    typeof record["values"] !== "object" ||
    Array.isArray(record["values"])
  ) {
    return null;
  }
  return record["values"] as Record<string, unknown>;
}

export async function promoteOneOffConfiguration(input: {
  db: OneOffPromotionClient;
  organizationId: string;
  quoteLineItemId: string;
  key: string;
  name: string;
  skuCode: string;
  promotedAt: Date;
}): Promise<{ configurationId: string; skuId: string }> {
  const quoteLine = await input.db.quoteLineItem.findUnique({
    where: { id: input.quoteLineItemId },
    select: {
      id: true,
      catalogItemId: true,
      catalogSkuId: true,
      configurationSnapshot: true,
      catalogItem: { select: { organizationId: true } },
    },
  });
  if (
    !quoteLine?.catalogItemId ||
    quoteLine.catalogItem?.organizationId !== input.organizationId
  ) {
    throw new Error("Quote line is not available to this organization");
  }
  if (quoteLine.catalogSkuId) {
    throw new Error("Quote line already references a reusable SKU");
  }
  const values = oneOffValues(quoteLine.configurationSnapshot);
  if (!values) {
    throw new Error("Quote line does not contain a one-off configuration");
  }
  const existingSku = await input.db.catalogSku.findUnique({
    where: {
      organizationId_code: {
        organizationId: input.organizationId,
        code: input.skuCode,
      },
    },
    select: { id: true, catalogItemId: true },
  });
  if (
    existingSku &&
    existingSku.catalogItemId !== quoteLine.catalogItemId
  ) {
    throw new Error("SKU code is already used by another catalog item");
  }

  const configuration = await input.db.productConfiguration.upsert({
    where: {
      catalogItemId_key: {
        catalogItemId: quoteLine.catalogItemId,
        key: input.key,
      },
    },
    create: {
      configurationId: `CONFIG-${newId(8).toUpperCase()}`,
      organizationId: input.organizationId,
      catalogItemId: quoteLine.catalogItemId,
      key: input.key,
      name: input.name,
      kind: "reusable",
      status: "active",
      specification: values as Prisma.InputJsonObject,
      promotedFromQuoteLineItemId: quoteLine.id,
      promotionSnapshot:
        quoteLine.configurationSnapshot as Prisma.InputJsonObject,
      promotedAt: input.promotedAt,
      sourceKind: "quote-line-promotion",
      sourceRef: quoteLine.id,
    },
    update: {
      name: input.name,
      specification: values as Prisma.InputJsonObject,
      status: "active",
      promotedFromQuoteLineItemId: quoteLine.id,
      promotionSnapshot:
        quoteLine.configurationSnapshot as Prisma.InputJsonObject,
      promotedAt: input.promotedAt,
      effectiveTo: null,
    },
    select: { id: true },
  });

  const sku = await input.db.catalogSku.upsert({
    where: {
      organizationId_code: {
        organizationId: input.organizationId,
        code: input.skuCode,
      },
    },
    create: {
      skuId: `SKU-${newId(8).toUpperCase()}`,
      organizationId: input.organizationId,
      catalogItemId: quoteLine.catalogItemId,
      configurationId: configuration.id,
      code: input.skuCode,
      name: input.name,
      status: "active",
      sourceKind: "quote-line-promotion",
      sourceRef: quoteLine.id,
    },
    update: {
      catalogItemId: quoteLine.catalogItemId,
      configurationId: configuration.id,
      name: input.name,
      status: "active",
      effectiveTo: null,
    },
    select: { id: true },
  });

  return {
    configurationId: configuration.id,
    skuId: sku.id,
  };
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercentage(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0
    ? 0
    : roundPercentage((numerator / denominator) * 100);
}
