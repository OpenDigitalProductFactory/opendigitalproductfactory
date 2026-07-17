// Catalog enrichment sweep (EP-ASSET-INTELLIGENCE, spec §4.2 / §4.4).
//
// The autonomous loop that turns the already-built feed *logic* into a governed,
// repeatable job: it iterates the CatalogIdentity spine and runs the three open
// feeds over it —
//   1. SBOM ingest  — bridge BomComponents into CatalogIdentity (source='sbom').
//   2. CPE crosswalk — resolve each identity's cpe:2.3 (NVD dictionary refinement
//      when an NVD fetcher is supplied, deterministic otherwise).
//   3. endoflife.date — resolve a support-lifecycle slug per identity, fetch its
//      releases, and upsert CatalogLifecycleMilestone rows.
//
// Bounded + poll-on-request (Vercel-friendly): each run processes at most `limit`
// identities/components, ordered stalest-first (updatedAt asc). Because the CPE
// resolve bumps `updatedAt`, processed identities rotate to the back of the queue,
// so repeated polls make forward progress across the whole spine without a cursor.
// The result reports processed-vs-total counts so a bounded batch is never mistaken
// for full coverage.
//
// Pure orchestration over the existing feed modules and an injectable client +
// fetchers — no prisma import here, so it stays unit-testable with mocks (the
// governed apps/web action wires the real prisma + global fetch).

import { resolveCatalogIdentityCpe, type CpeUpsertClient } from "./cpe-crosswalk";
import {
  fetchEolProduct,
  upsertLifecycleForIdentity,
  type LifecycleUpsertClient,
} from "./endoflife-lifecycle";
import {
  upsertIdentitiesForComponents,
  type BomComponentInput,
  type SbomBridgeClient,
} from "./sbom-catalog-bridge";
// Reuse the on-demand path's slug derivation so a product enriched by this weekly
// loop and one enriched by enrich_digital_product resolve to the same endoflife slug
// (single source of truth — avoids a duplicate `deriveEolSlug` / barrel-export clash).
import { deriveEolSlug } from "./enrich-digital-product";

const DEFAULT_LIMIT = 100;

/** One CatalogIdentity row the sweep needs to run CPE + lifecycle resolution. */
export type SweepIdentityRow = {
  id: string;
  part: string | null;
  manufacturer: string;
  product: string;
  productVersion: string | null;
  edition: string | null;
};

/** One BomComponent row the SBOM stage bridges into the catalog. */
export type SweepBomRow = {
  name: string;
  version: string | null;
  packageUrl: string | null;
  supplierName: string | null;
  ecosystem: string | null;
};

/**
 * Minimal prisma surface for the sweep. Structurally a superset of the per-feed
 * client types (CpeUpsertClient / LifecycleUpsertClient / SbomBridgeClient), so
 * it is assignable to each when delegating.
 */
export type CatalogSweepClient = CpeUpsertClient &
  LifecycleUpsertClient &
  SbomBridgeClient & {
    catalogIdentity: {
      findMany(args: unknown): Promise<SweepIdentityRow[]>;
      count(args?: unknown): Promise<number>;
    };
    bomComponent: {
      findMany(args: unknown): Promise<SweepBomRow[]>;
      count(args?: unknown): Promise<number>;
    };
  };

export type CatalogSweepFetchers = {
  /** endoflife.date fetcher; defaults to global fetch. */
  eolFetch?: typeof fetch;
  /** NVD CPE-dictionary fetcher; when omitted the CPE is deterministic-only. */
  nvdFetch?: typeof fetch;
};

export type CatalogSweepOptions = {
  limit?: number;
  fetchers?: CatalogSweepFetchers;
};

export type CatalogSweepResult = {
  identitiesScanned: number;
  identitiesTotal: number;
  cpeResolved: number;
  lifecycleMilestonesWritten: number;
  lifecycleProductsMatched: number;
  sbomComponentsIngested: number;
  bomComponentsTotal: number;
  failures: number;
};

function bomRowToInput(row: SweepBomRow): BomComponentInput {
  return {
    name: row.name,
    version: row.version,
    packageUrl: row.packageUrl,
    supplierName: row.supplierName,
    ecosystem: row.ecosystem,
  };
}

/**
 * Run one bounded catalog-enrichment pass. Safe to call repeatedly (idempotent
 * upserts throughout); per-identity failures are counted, never fatal.
 */
export async function runCatalogEnrichmentSweep(
  db: CatalogSweepClient,
  options: CatalogSweepOptions = {},
): Promise<CatalogSweepResult> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const eolFetch = options.fetchers?.eolFetch;
  const nvdFetch = options.fetchers?.nvdFetch;

  const result: CatalogSweepResult = {
    identitiesScanned: 0,
    identitiesTotal: 0,
    cpeResolved: 0,
    lifecycleMilestonesWritten: 0,
    lifecycleProductsMatched: 0,
    sbomComponentsIngested: 0,
    bomComponentsTotal: 0,
    failures: 0,
  };

  // ── Stage 1: SBOM → CatalogIdentity ────────────────────────────────────────
  // Bridge the newest BomComponents into the catalog. Idempotent upsert, so
  // re-processing the same components across polls is harmless.
  result.bomComponentsTotal = await db.bomComponent.count();
  const components = await db.bomComponent.findMany({
    take: limit,
    orderBy: { lastSeenAt: "desc" },
    select: {
      name: true,
      version: true,
      packageUrl: true,
      supplierName: true,
      ecosystem: true,
    },
  });
  try {
    result.sbomComponentsIngested = await upsertIdentitiesForComponents(
      db,
      components.map(bomRowToInput),
    );
  } catch {
    result.failures += 1;
  }

  // ── Stages 2 & 3: CPE crosswalk + endoflife lifecycle over the identity spine ─
  // Stalest-first; the CPE update bumps updatedAt so processed rows rotate to the
  // back of the queue and repeated polls cover the whole spine without a cursor.
  result.identitiesTotal = await db.catalogIdentity.count();
  const identities = await db.catalogIdentity.findMany({
    take: limit,
    orderBy: { updatedAt: "asc" },
    select: {
      id: true,
      part: true,
      manufacturer: true,
      product: true,
      productVersion: true,
      edition: true,
    },
  });

  for (const identity of identities) {
    result.identitiesScanned += 1;
    try {
      await resolveCatalogIdentityCpe(
        db,
        {
          id: identity.id,
          part: identity.part,
          manufacturer: identity.manufacturer,
          product: identity.product,
          productVersion: identity.productVersion,
          edition: identity.edition,
        },
        nvdFetch,
      );
      result.cpeResolved += 1;

      const slug = deriveEolSlug(identity);
      if (slug) {
        const product = await fetchEolProduct(slug, eolFetch ?? fetch);
        if (product) {
          result.lifecycleProductsMatched += 1;
          result.lifecycleMilestonesWritten += await upsertLifecycleForIdentity(
            db,
            identity.id,
            product,
            identity.productVersion,
          );
        }
      }
    } catch {
      result.failures += 1;
    }
  }

  return result;
}
