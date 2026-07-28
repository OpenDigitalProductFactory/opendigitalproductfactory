// On-demand enrichment for a single DigitalProduct (EP-ASSET-INTELLIGENCE, spec §4.2/§4.6).
//
// The MCP-tool entry point that lets the estate-specialist coworker enrich one product
// (or flag it for re-enrichment) rather than wait for the weekly catalog sweep. Reuses
// the already-built open-feed logic per identity — CPE 2.3 crosswalk + endoflife.date
// support-lifecycle — over the CatalogIdentity rows the product's InventoryEntities
// resolve to, then stamps DigitalProduct.enrichmentStatus / lastEnrichedAt.
//
// Pure orchestration over an injectable client + fetchers (no prisma import) so it stays
// unit-testable; the MCP handler wires the real prisma + global fetch.

import { resolveCatalogIdentityCpe, type CpeUpsertClient } from "./cpe-crosswalk";
import {
  fetchEolProduct,
  upsertLifecycleForIdentity,
  type LifecycleUpsertClient,
} from "./endoflife-lifecycle";
import { INVENTORY_ENTITY_CANONICAL_WHERE } from "./inventory-entity-lifecycle";

/** One CatalogIdentity row the per-identity enrichment needs. */
export type EnrichIdentityRow = {
  id: string;
  part: string | null;
  manufacturer: string;
  product: string;
  productVersion: string | null;
  edition: string | null;
};

export type EnrichFetchers = {
  /** endoflife.date fetcher; defaults to global fetch. */
  eolFetch?: typeof fetch;
  /** NVD CPE-dictionary fetcher; when omitted the CPE is deterministic-only. */
  nvdFetch?: typeof fetch;
};

/**
 * endoflife.date product slug from a CatalogIdentity's product name — best-effort,
 * lowercase-hyphenated. Kept in lockstep with the scheduled sweep's derivation so a
 * product enriched on demand and one enriched by the weekly loop resolve identically.
 */
export function deriveEolSlug(identity: { product: string }): string {
  return identity.product
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export type EnrichIdentityResult = {
  cpe: string;
  lifecycleMilestonesWritten: number;
  lifecycleMatched: boolean;
};

/**
 * Run the open feeds over one CatalogIdentity: resolve its CPE 2.3, then resolve +
 * upsert its endoflife.date support-lifecycle milestones. Idempotent. Fetch/DB errors
 * inside the feed helpers are already swallowed to []/null; a hard throw propagates to
 * the caller, which decides partial-vs-failed.
 */
export async function enrichCatalogIdentity(
  db: CpeUpsertClient & LifecycleUpsertClient,
  identity: EnrichIdentityRow,
  fetchers: EnrichFetchers = {},
): Promise<EnrichIdentityResult> {
  const cpe = await resolveCatalogIdentityCpe(
    db,
    {
      id: identity.id,
      part: identity.part,
      manufacturer: identity.manufacturer,
      product: identity.product,
      productVersion: identity.productVersion,
      edition: identity.edition,
    },
    fetchers.nvdFetch,
  );

  let lifecycleMilestonesWritten = 0;
  let lifecycleMatched = false;
  const slug = deriveEolSlug(identity);
  if (slug) {
    const product = await fetchEolProduct(slug, fetchers.eolFetch ?? fetch);
    if (product) {
      lifecycleMatched = true;
      lifecycleMilestonesWritten = await upsertLifecycleForIdentity(
        db,
        identity.id,
        product,
        identity.productVersion,
      );
    }
  }

  return { cpe, lifecycleMilestonesWritten, lifecycleMatched };
}

/** Minimal prisma surface for enrichDigitalProduct — a superset of the feed clients. */
export type EnrichDigitalProductClient = CpeUpsertClient &
  LifecycleUpsertClient & {
    digitalProduct: {
      findUnique(args: {
        where: { id: string };
        select: {
          id: true;
          inventoryEntities: {
            where: typeof INVENTORY_ENTITY_CANONICAL_WHERE;
            select: { catalogIdentity: { select: EnrichIdentitySelect } };
          };
        };
      }): Promise<DigitalProductWithIdentities | null>;
      update(args: {
        where: { id: string };
        data: { enrichmentStatus: string; lastEnrichedAt: Date };
      }): Promise<unknown>;
    };
  };

type EnrichIdentitySelect = {
  id: true;
  part: true;
  manufacturer: true;
  product: true;
  productVersion: true;
  edition: true;
};

type DigitalProductWithIdentities = {
  id: string;
  inventoryEntities: Array<{ catalogIdentity: EnrichIdentityRow | null }>;
};

export type EnrichDigitalProductResult = {
  digitalProductId: string;
  enrichmentStatus: "enriched" | "partial" | "failed";
  identitiesEnriched: number;
  identitiesFailed: number;
  lifecycleMilestonesWritten: number;
};

/**
 * Enrich every distinct CatalogIdentity the product's InventoryEntities resolve to, then
 * stamp the product's enrichmentStatus:
 *   - enriched — at least one identity, all succeeded
 *   - partial  — some identities failed, or the product has no resolved identities yet
 *   - failed   — every attempted identity threw
 * Never throws; the outcome is reflected in the status + counts.
 */
export async function enrichDigitalProduct(
  db: EnrichDigitalProductClient,
  digitalProductId: string,
  fetchers: EnrichFetchers = {},
): Promise<EnrichDigitalProductResult> {
  const identitySelect: EnrichIdentitySelect = {
    id: true,
    part: true,
    manufacturer: true,
    product: true,
    productVersion: true,
    edition: true,
  };
  const product = await db.digitalProduct.findUnique({
    where: { id: digitalProductId },
    select: {
      id: true,
      inventoryEntities: {
        where: INVENTORY_ENTITY_CANONICAL_WHERE,
        select: { catalogIdentity: { select: identitySelect } },
      },
    },
  });

  const result: EnrichDigitalProductResult = {
    digitalProductId,
    enrichmentStatus: "partial",
    identitiesEnriched: 0,
    identitiesFailed: 0,
    lifecycleMilestonesWritten: 0,
  };

  if (product === null) {
    result.enrichmentStatus = "failed";
    return result;
  }

  // Distinct resolved identities (multiple entities can share one CatalogIdentity).
  const identities = new Map<string, EnrichIdentityRow>();
  for (const entity of product.inventoryEntities) {
    if (entity.catalogIdentity) identities.set(entity.catalogIdentity.id, entity.catalogIdentity);
  }

  for (const identity of identities.values()) {
    try {
      const r = await enrichCatalogIdentity(db, identity, fetchers);
      result.identitiesEnriched += 1;
      result.lifecycleMilestonesWritten += r.lifecycleMilestonesWritten;
    } catch {
      result.identitiesFailed += 1;
    }
  }

  // No resolved identities yet → nothing to enrich (leave as 'partial', the product is
  // awaiting a discovery-rule match). All-failed → 'failed'. Otherwise 'enriched'.
  if (identities.size === 0) {
    result.enrichmentStatus = "partial";
  } else if (result.identitiesEnriched === 0) {
    result.enrichmentStatus = "failed";
  } else if (result.identitiesFailed === 0) {
    result.enrichmentStatus = "enriched";
  } else {
    result.enrichmentStatus = "partial";
  }

  await db.digitalProduct.update({
    where: { id: digitalProductId },
    data: { enrichmentStatus: result.enrichmentStatus, lastEnrichedAt: new Date() },
  });

  return result;
}

/** Minimal prisma surface for requestReEnrichment. */
export type ReEnrichmentClient = {
  digitalProduct: {
    update(args: {
      where: { id: string };
      data: { enrichmentStatus: string };
    }): Promise<unknown>;
  };
  inventoryEntity: {
    updateMany(args: {
      where: { id: string };
      data: { identityStatus: string | null };
    }): Promise<{ count: number }>;
  };
};

export type ReEnrichmentTarget = { digitalProductId?: string; inventoryEntityId?: string };

/**
 * Flag a product or entity for re-enrichment so the next scheduled catalog sweep (or an
 * explicit enrich_digital_product call) re-resolves it. A DigitalProduct is set back to
 * enrichmentStatus='pending'; an InventoryEntity's identityStatus is cleared to
 * 'needs_reresolve' so the sweep picks it up. Human-confirmed identities are not touched
 * here — re-enrichment re-runs the deterministic + feed layers, never overwrites a
 * human_confirmed resolution (spec §4.1). Returns which targets were flagged.
 */
export async function requestReEnrichment(
  db: ReEnrichmentClient,
  target: ReEnrichmentTarget,
): Promise<{ flaggedProduct: boolean; flaggedEntity: boolean }> {
  let flaggedProduct = false;
  let flaggedEntity = false;

  if (target.digitalProductId) {
    await db.digitalProduct.update({
      where: { id: target.digitalProductId },
      data: { enrichmentStatus: "pending" },
    });
    flaggedProduct = true;
  }

  if (target.inventoryEntityId) {
    const { count } = await db.inventoryEntity.updateMany({
      where: { id: target.inventoryEntityId },
      data: { identityStatus: "needs_reresolve" },
    });
    flaggedEntity = count > 0;
  }

  return { flaggedProduct, flaggedEntity };
}
