import { newId } from "../shared/new-id";
import { slugify } from "../shared/slugify";

export const PRODUCT_OFFERING_STATUSES = [
  "draft",
  "active",
  "retired",
] as const;
export type ProductOfferingStatus =
  (typeof PRODUCT_OFFERING_STATUSES)[number];

export const CATALOG_ITEM_STATUSES = ["draft", "active", "retired"] as const;
export type CatalogItemStatus = (typeof CATALOG_ITEM_STATUSES)[number];

export const PRODUCT_CONFIGURATION_KINDS = ["reusable"] as const;
export type ProductConfigurationKind =
  (typeof PRODUCT_CONFIGURATION_KINDS)[number];

export const PRODUCT_CONFIGURATION_STATUSES = [
  "draft",
  "active",
  "retired",
] as const;
export type ProductConfigurationStatus =
  (typeof PRODUCT_CONFIGURATION_STATUSES)[number];

export const CATALOG_SKU_STATUSES = ["draft", "active", "retired"] as const;
export type CatalogSkuStatus = (typeof CATALOG_SKU_STATUSES)[number];

export type CommercialCatalogClient = {
  productOffering: {
    upsert: (args: Record<string, unknown>) => Promise<{ id: string }>;
  };
  catalogItem: {
    upsert: (args: Record<string, unknown>) => Promise<{ id: string }>;
  };
};

export type StorefrontCommercialCatalogClient = CommercialCatalogClient & {
  product: {
    upsert: (
      args: Record<string, unknown>,
    ) => Promise<DefaultCommercialChainInput["product"]>;
  };
};

export type DefaultCommercialChainInput = {
  db: CommercialCatalogClient;
  product: {
    id: string;
    organizationId: string;
    key: string;
    name: string;
    description: string | null;
  };
  priceType?: string | null;
  priceAmount?: number | string | null;
  priceCurrency: string;
  quoteRequired?: boolean;
  sourceKind?: string | null;
  sourceRef?: string | null;
};

export type DefaultCommercialChain = {
  offeringId: string;
  catalogItemId: string;
};

/**
 * Idempotently materialize the complete commercial contract behind the common
 * one-product workflow. The provider is the owning organization. No consumer,
 * DigitalProduct, team, subscriber, or entitlement is inferred here.
 */
export async function ensureDefaultCommercialChain(
  input: DefaultCommercialChainInput,
): Promise<DefaultCommercialChain> {
  const offering = await input.db.productOffering.upsert({
    where: {
      productId_key: {
        productId: input.product.id,
        key: "default",
      },
    },
    create: {
      offeringId: `OFFER-${newId(8).toUpperCase()}`,
      organizationId: input.product.organizationId,
      providerOrganizationId: input.product.organizationId,
      productId: input.product.id,
      key: "default",
      name: input.product.name,
      description: input.product.description,
      status: "active" satisfies ProductOfferingStatus,
      isDefault: true,
      sourceKind: input.sourceKind ?? null,
      sourceRef: input.sourceRef ?? null,
    },
    update: {
      name: input.product.name,
      description: input.product.description,
      status: "active" satisfies ProductOfferingStatus,
      providerOrganizationId: input.product.organizationId,
      sourceKind: input.sourceKind ?? null,
      sourceRef: input.sourceRef ?? null,
      effectiveTo: null,
    },
    select: { id: true },
  });

  const catalogItem = await input.db.catalogItem.upsert({
    where: {
      offeringId_key: {
        offeringId: offering.id,
        key: "default",
      },
    },
    create: {
      catalogItemId: `CAT-${newId(8).toUpperCase()}`,
      organizationId: input.product.organizationId,
      offeringId: offering.id,
      key: "default",
      name: input.product.name,
      description: input.product.description,
      status: "active" satisfies CatalogItemStatus,
      priceType: input.priceType ?? null,
      priceAmount: input.priceAmount ?? null,
      priceCurrency: input.priceCurrency,
      quoteRequired:
        input.quoteRequired ?? input.priceType === "quote",
      sourceKind: input.sourceKind ?? null,
      sourceRef: input.sourceRef ?? null,
    },
    update: {
      name: input.product.name,
      description: input.product.description,
      status: "active" satisfies CatalogItemStatus,
      priceType: input.priceType ?? null,
      priceAmount: input.priceAmount ?? null,
      priceCurrency: input.priceCurrency,
      quoteRequired:
        input.quoteRequired ?? input.priceType === "quote",
      sourceKind: input.sourceKind ?? null,
      sourceRef: input.sourceRef ?? null,
      effectiveTo: null,
    },
    select: { id: true },
  });

  return {
    offeringId: offering.id,
    catalogItemId: catalogItem.id,
  };
}

export type StorefrontCommercialChainInput = {
  db: StorefrontCommercialCatalogClient;
  organizationId: string;
  productLineId: string | null;
  name: string;
  description: string | null;
  priceType?: string | null;
  priceAmount?: number | string | null;
  priceCurrency: string;
  sourceRef: string;
};

export type StorefrontCommercialChainResult = {
  catalogItemId: string | null;
  compatibilityReason: "product-line-unavailable" | null;
};

export function resolveCatalogProductLineSelection(
  productLines: Array<{ id: string }>,
  requestedProductLineId: string | null,
): { productLineId: string | null; error: string | null } {
  if (
    requestedProductLineId &&
    !productLines.some((line) => line.id === requestedProductLineId)
  ) {
    return {
      productLineId: null,
      error: "Selected product line is not available to this organization",
    };
  }
  if (requestedProductLineId) {
    return { productLineId: requestedProductLineId, error: null };
  }
  if (productLines.length > 1) {
    return {
      productLineId: null,
      error:
        "productLineId is required when the business has multiple product lines",
    };
  }
  return {
    productLineId: productLines[0]?.id ?? null,
    error: null,
  };
}

/**
 * Resolve a Storefront item to the business Product authority before creating
 * the collapsed default commercial chain. A missing ProductLine is an honest
 * legacy compatibility state, not permission to invent a hierarchy.
 */
export async function ensureStorefrontCommercialChain(
  input: StorefrontCommercialChainInput,
): Promise<StorefrontCommercialChainResult> {
  if (!input.productLineId) {
    return {
      catalogItemId: null,
      compatibilityReason: "product-line-unavailable",
    };
  }

  const key =
    slugify(input.name) ||
    slugify(input.sourceRef) ||
    `item-${newId(8).toLowerCase()}`;
  const product = await input.db.product.upsert({
    where: {
      productLineId_key: {
        productLineId: input.productLineId,
        key,
      },
    },
    create: {
      productId: `PROD-${newId(8).toUpperCase()}`,
      organizationId: input.organizationId,
      productLineId: input.productLineId,
      key,
      name: input.name,
      description: input.description,
      sourceKind: "storefront-item",
      sourceRef: input.sourceRef,
    },
    update: {
      name: input.name,
      description: input.description,
      sourceRef: input.sourceRef,
      effectiveTo: null,
    },
    select: {
      id: true,
      organizationId: true,
      key: true,
      name: true,
      description: true,
    },
  });
  const chain = await ensureDefaultCommercialChain({
    db: input.db,
    product,
    priceType: input.priceType,
    priceAmount: input.priceAmount,
    priceCurrency: input.priceCurrency,
    sourceKind: "storefront-item",
    sourceRef: input.sourceRef,
  });

  return {
    catalogItemId: chain.catalogItemId,
    compatibilityReason: null,
  };
}

type StorefrontCatalogProjectionInput = {
  id: string;
  name: string;
  description: string | null;
  priceType: string | null;
  priceAmount: string | null;
  priceCurrency: string;
  catalogItem:
    | {
        catalogItemId: string;
        name: string;
        description: string | null;
        priceType: string | null;
        priceAmount: string | null;
        priceCurrency: string;
        quoteRequired: boolean;
        status: string;
      }
    | null;
};

export type StorefrontCatalogProjection = {
  id: string;
  catalogItemId: string | null;
  name: string;
  description: string | null;
  priceType: string | null;
  priceAmount: string | null;
  priceCurrency: string;
  quoteRequired: boolean;
  catalogStatus: string | null;
  compatibilitySource: "catalog" | "storefront";
};

/**
 * Catalog-first read adapter. Unlinked legacy rows remain visible with an
 * explicit compatibility source rather than being guessed into the hierarchy.
 */
export function projectStorefrontCatalogItem(
  input: StorefrontCatalogProjectionInput,
): StorefrontCatalogProjection {
  if (input.catalogItem) {
    return {
      id: input.id,
      catalogItemId: input.catalogItem.catalogItemId,
      name: input.catalogItem.name,
      description: input.catalogItem.description,
      priceType: input.catalogItem.priceType,
      priceAmount: input.catalogItem.priceAmount,
      priceCurrency: input.catalogItem.priceCurrency,
      quoteRequired: input.catalogItem.quoteRequired,
      catalogStatus: input.catalogItem.status,
      compatibilitySource: "catalog",
    };
  }

  return {
    id: input.id,
    catalogItemId: null,
    name: input.name,
    description: input.description,
    priceType: input.priceType,
    priceAmount: input.priceAmount,
    priceCurrency: input.priceCurrency,
    quoteRequired: input.priceType === "quote",
    catalogStatus: null,
    compatibilitySource: "storefront",
  };
}

type DecimalLike = string | number | { toString(): string };

type StorefrontCatalogRowInput = {
  id: string;
  name: string;
  description: string | null;
  priceType: string | null;
  priceAmount: DecimalLike | null;
  priceCurrency: string;
  catalogItem:
    | {
        catalogItemId: string;
        name: string;
        description: string | null;
        priceType: string | null;
        priceAmount: DecimalLike | null;
        priceCurrency: string;
        quoteRequired: boolean;
        status: string;
      }
    | null;
};

/**
 * One catalog-first adapter for every Storefront row reader. Presentation
 * fields pass through; duplicated commercial fields are normalized to strings
 * and replaced by the CatalogItem authority when a real link exists.
 */
export function projectStorefrontCatalogRow<T extends StorefrontCatalogRowInput>(
  input: T,
) {
  const { catalogItem, ...projection } = input;
  const commercial = projectStorefrontCatalogItem({
    id: input.id,
    name: input.name,
    description: input.description,
    priceType: input.priceType,
    priceAmount: input.priceAmount?.toString() ?? null,
    priceCurrency: input.priceCurrency,
    catalogItem:
      catalogItem == null
        ? null
        : {
            ...catalogItem,
            priceAmount: catalogItem.priceAmount?.toString() ?? null,
          },
  });

  return {
    ...projection,
    ...commercial,
  };
}

export type CollapsedCommercialUpdateClient = {
  product: {
    update: (args: Record<string, unknown>) => Promise<unknown>;
  };
  productOffering: {
    update: (args: Record<string, unknown>) => Promise<unknown>;
  };
  catalogItem: {
    findUnique: (
      args: Record<string, unknown>,
    ) => Promise<{
      id: string;
      offering: { id: string; product: { id: string } };
    } | null>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
  };
};

export type CollapsedCommercialUpdateInput = {
  db: CollapsedCommercialUpdateClient;
  catalogItemId: string;
  name: string;
  description: string | null;
  priceType: string | null;
  priceAmount: number | string | null;
  priceCurrency: string;
};

/**
 * Update the common one-to-one chain as one user operation. Divergent
 * offerings/catalog items use their advanced workflows instead of this helper.
 */
export async function updateCollapsedCommercialChain(
  input: CollapsedCommercialUpdateInput,
): Promise<boolean> {
  const catalogItem = await input.db.catalogItem.findUnique({
    where: { id: input.catalogItemId },
    select: {
      id: true,
      offering: {
        select: {
          id: true,
          product: { select: { id: true } },
        },
      },
    },
  });
  if (!catalogItem) return false;

  const shared = {
    name: input.name,
    description: input.description,
  };
  await input.db.product.update({
    where: { id: catalogItem.offering.product.id },
    data: shared,
  });
  await input.db.productOffering.update({
    where: { id: catalogItem.offering.id },
    data: shared,
  });
  await input.db.catalogItem.update({
    where: { id: catalogItem.id },
    data: {
      ...shared,
      priceType: input.priceType,
      priceAmount: input.priceAmount,
      priceCurrency: input.priceCurrency,
      quoteRequired: input.priceType === "quote",
    },
  });
  return true;
}

export type ReconcileStorefrontCommercialCatalogClient =
  StorefrontCommercialCatalogClient & {
    storefrontItem: {
      findMany: (
        args: Record<string, unknown>,
      ) => Promise<
        Array<{
          id: string;
          itemId: string;
          name: string;
          description: string | null;
          priceType: string | null;
          priceAmount: number | string | null;
          priceCurrency: string;
          sourceComposition: { productLineId: string | null } | null;
        }>
      >;
      update: (args: Record<string, unknown>) => Promise<unknown>;
    };
  };

/**
 * Deterministically backfill storefront projection links after the Phase 1
 * product hierarchy exists. Rows without a composition/product-line trace stay
 * unresolved and observable; name similarity alone is not authority.
 */
export async function reconcileStorefrontCommercialCatalog(input: {
  db: ReconcileStorefrontCommercialCatalogClient;
  storefrontId: string;
  organizationId: string;
}): Promise<{ linked: number; unresolved: number }> {
  const items = await input.db.storefrontItem.findMany({
    where: {
      storefrontId: input.storefrontId,
      catalogItemId: null,
      isActive: true,
    },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      itemId: true,
      name: true,
      description: true,
      priceType: true,
      priceAmount: true,
      priceCurrency: true,
      sourceComposition: {
        select: { productLineId: true },
      },
    },
  });
  let linked = 0;
  let unresolved = 0;

  for (const item of items) {
    const result = await ensureStorefrontCommercialChain({
      db: input.db,
      organizationId: input.organizationId,
      productLineId: item.sourceComposition?.productLineId ?? null,
      name: item.name,
      description: item.description,
      priceType: item.priceType,
      priceAmount: item.priceAmount,
      priceCurrency: item.priceCurrency,
      sourceRef: item.itemId,
    });
    if (!result.catalogItemId) {
      unresolved++;
      continue;
    }
    await input.db.storefrontItem.update({
      where: { id: item.id },
      data: { catalogItemId: result.catalogItemId },
    });
    linked++;
  }
  return { linked, unresolved };
}
