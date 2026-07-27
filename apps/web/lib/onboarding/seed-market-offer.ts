// Onboarding market-offer seeding (BI-4503E6B9, EP-BOM-WIRING Phase 1).
//
// Populates the "Goods and Services for Sale" portfolio (DPPM "Provided
// Externally") with the company's actual market offer, derived from the chosen
// archetype. Each archetype already carries its offer as `itemTemplates`
// (e.g. a dental practice's "New Patient Examination", "Check-up & Clean") — so
// a fresh install's portfolio reads like it already understands what the
// business sells, instead of being empty or showing DPF's own products.
//
// Shape (IT4IT v3 / DPPM): one DigitalProduct = the org's offer line, with one
// ServiceOffering per catalog item. Seeded ONCE from the archetype at setup
// completion (seed-is-bootstrap); the operator then refines the products and
// offerings. Idempotent and non-destructive — if the offer product already
// exists it is left untouched (operator edits preserved). The existing
// /portfolio surface renders the result; no new UI.

import { prisma } from "@dpf/db";
import { slugify } from "@/lib/shared/slugify";
import { ALL_ARCHETYPES } from "@dpf/storefront-templates";

/** Stable slug of the Goods and Services for Sale portfolio root (Portfolio.id is a cuid). */
const PRODUCTS_AND_SERVICES_SOLD_SLUG = "products_and_services_sold";

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type SeedMarketOfferClient = {
  storefrontConfig: { findFirst: (args: unknown) => Promise<unknown> };
  portfolio: { findUnique: (args: unknown) => Promise<unknown> };
  digitalProduct: {
    findUnique: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
  };
  serviceOffering: { upsert: (args: unknown) => Promise<unknown> };
};

export type SeedMarketOfferInput = {
  organizationId: string;
  /** Defaults to the shared prisma client. */
  db?: SeedMarketOfferClient;
};

export type SeedMarketOfferResult = {
  /** True only if the offer product + offerings were created this run. */
  seeded: boolean;
  /** True if the offer product already existed (left untouched). */
  alreadyPresent: boolean;
  /** The market-offer DigitalProduct.productId, or null when nothing was seeded. */
  productId: string | null;
  /** Number of ServiceOfferings created from archetype catalog items. */
  offeringCount: number;
};


/**
 * Seed the org's market offer into the Goods and Services for Sale portfolio from
 * its archetype. Non-destructive: never overwrites an existing offer product.
 */
export async function seedMarketOffer(
  input: SeedMarketOfferInput,
): Promise<SeedMarketOfferResult> {
  const db = input.db ?? (prisma as unknown as SeedMarketOfferClient);
  const organizationId = input.organizationId;

  const empty: SeedMarketOfferResult = {
    seeded: false,
    alreadyPresent: false,
    productId: null,
    offeringCount: 0,
  };

  const sf = (await db.storefrontConfig.findFirst({
    where: { organizationId },
    select: { archetypeId: true },
  })) as { archetypeId: string | null } | null;

  const archetypeId = sf?.archetypeId ?? null;
  if (!archetypeId) return empty;

  const def = ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId);
  if (!def || def.itemTemplates.length === 0) return empty;

  const portfolio = (await db.portfolio.findUnique({
    where: { slug: PRODUCTS_AND_SERVICES_SOLD_SLUG },
    select: { id: true },
  })) as { id: string } | null;
  if (!portfolio) return empty;

  const productId = `DP-MARKET-OFFER-${organizationId}`;

  // Non-destructive: if the offer product already exists, leave it (and its
  // operator-refined offerings) untouched.
  const existing = (await db.digitalProduct.findUnique({
    where: { productId },
    select: { id: true },
  })) as { id: string } | null;
  if (existing) {
    return { seeded: false, alreadyPresent: true, productId, offeringCount: 0 };
  }

  const product = (await db.digitalProduct.create({
    data: {
      productId,
      name: def.name,
      description: `${def.name} — market offer (archetype-seeded; refine as the catalog evolves).`,
      portfolioId: portfolio.id,
      lifecycleStage: "production",
      lifecycleStatus: "active",
    },
    select: { id: true },
  })) as { id: string };

  let offeringCount = 0;
  for (let i = 0; i < def.itemTemplates.length; i++) {
    const item = def.itemTemplates[i];
    const offeringId = `SO-${organizationId}-${i}-${slugify(item.name)}`;
    await db.serviceOffering.upsert({
      where: { offeringId },
      update: {},
      create: {
        offeringId,
        digitalProductId: product.id,
        name: item.name,
        description: item.description ?? null,
        consumers: ["external"],
        status: "active",
      },
    });
    offeringCount++;
  }

  return { seeded: true, alreadyPresent: false, productId, offeringCount };
}
