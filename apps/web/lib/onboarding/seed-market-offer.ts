// Business market-offer reconciliation (EP-ED496EB0 Phase 1).
//
// The business ProductLine/Product hierarchy is now the authority for what an
// organization sells. DigitalProduct remains digital architecture, and
// ServiceOffering remains an operational/commercial commitment. This retained
// entry point lets the existing setup-completion/backfill chain converge older
// storefronts without maintaining a second market-offer rule set.

import { prisma } from "@dpf/db";
import {
  resolveProductMix,
  type ItemTemplate,
  type ProductLineTemplate,
} from "@dpf/storefront-templates";

import {
  persistProductHierarchy,
  type ProductHierarchyClient,
} from "../products/persist-product-hierarchy";
import {
  reconcileStorefrontCommercialCatalog,
  type ReconcileStorefrontCommercialCatalogClient,
} from "../products/commercial-catalog";

export type SeedMarketOfferClient = ProductHierarchyClient & {
  storefrontConfig: { findFirst: (args: unknown) => Promise<unknown> };
  productLine: ProductHierarchyClient["productLine"] & {
    findFirst: (args: unknown) => Promise<unknown>;
  };
};

export type SeedMarketOfferInput = {
  organizationId: string;
  db?: SeedMarketOfferClient;
};

export type SeedMarketOfferResult = {
  seeded: boolean;
  alreadyPresent: boolean;
  /** Retained for compatibility; business products do not fabricate a DigitalProduct. */
  productId: null;
  /** Count of business Product rows confirmed by the reconciliation. */
  offeringCount: number;
  /** Storefront projections linked to canonical CatalogItems in this run. */
  linkedCatalogItemCount: number;
  /** Storefront projections that still lack real product-line evidence. */
  unresolvedCatalogItemCount: number;
};

type CompositionEvidence = {
  role: string;
  archetype: {
    archetypeId: string;
    name: string;
    itemTemplates: unknown;
    productMix: unknown;
  };
};

/**
 * Reconcile an existing storefront into the canonical business hierarchy.
 * Only active archetype compositions are evidence. No consumer, team,
 * subscriber, entitlement, or placeholder DigitalProduct is created.
 */
export async function seedMarketOffer(
  input: SeedMarketOfferInput,
): Promise<SeedMarketOfferResult> {
  const db = input.db ?? (prisma as unknown as SeedMarketOfferClient);
  const existing = (await db.productLine.findFirst({
    where: {
      organizationId: input.organizationId,
      sourceKind: "storefront-setup",
      effectiveTo: null,
    },
    select: { id: true },
  })) as { id: string } | null;
  const storefront = (await db.storefrontConfig.findFirst({
    where: { organizationId: input.organizationId },
    select: {
      id: true,
      archetype: {
        select: {
          archetypeId: true,
          name: true,
          itemTemplates: true,
          productMix: true,
        },
      },
      archetypeCompositions: {
        where: { removedAt: null },
        orderBy: { sortOrder: "asc" },
        select: {
          role: true,
          archetype: {
            select: {
              archetypeId: true,
              name: true,
              itemTemplates: true,
              productMix: true,
            },
          },
        },
      },
    },
  })) as
    | {
        id: string;
        archetype: CompositionEvidence["archetype"];
        archetypeCompositions: CompositionEvidence[];
      }
    | null;

  if (!storefront) {
    return {
      seeded: false,
      alreadyPresent: Boolean(existing),
      productId: null,
      offeringCount: 0,
      linkedCatalogItemCount: 0,
      unresolvedCatalogItemCount: 0,
    };
  }

  if (existing) {
    const reconciled = await reconcileStorefrontCommercialCatalog({
      db: db as unknown as ReconcileStorefrontCommercialCatalogClient,
      storefrontId: storefront.id,
      organizationId: input.organizationId,
    });
    return {
      seeded: false,
      alreadyPresent: true,
      productId: null,
      offeringCount: reconciled.linked,
      linkedCatalogItemCount: reconciled.linked,
      unresolvedCatalogItemCount: reconciled.unresolved,
    };
  }

  const compositions =
    storefront.archetypeCompositions.length > 0
      ? storefront.archetypeCompositions
      : [{ role: "primary", archetype: storefront.archetype }];
  const lines: ProductLineTemplate[] = [];
  const usedKeys = new Set<string>();

  for (const composition of compositions) {
    const mix = resolveProductMix({
      archetypeId: composition.archetype.archetypeId,
      name: composition.archetype.name,
      itemTemplates:
        composition.archetype.itemTemplates as unknown as ItemTemplate[],
      productMix: composition.archetype.productMix,
    });
    const candidate = mix.primary;
    if (usedKeys.has(candidate.key)) continue;
    usedKeys.add(candidate.key);
    lines.push(candidate);
  }

  const result = await persistProductHierarchy({
    organizationId: input.organizationId,
    storefrontId: storefront.id,
    lines,
    db,
  });
  const reconciled = await reconcileStorefrontCommercialCatalog({
    db: db as unknown as ReconcileStorefrontCommercialCatalogClient,
    storefrontId: storefront.id,
    organizationId: input.organizationId,
  });
  return {
    seeded: true,
    alreadyPresent: false,
    productId: null,
    offeringCount: result.productCount,
    linkedCatalogItemCount: reconciled.linked,
    unresolvedCatalogItemCount: reconciled.unresolved,
  };
}
