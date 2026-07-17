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
import { enrichHardwareIdentity } from "./hardware-lifecycle";
import { deriveSupportPostureFromMilestones } from "./support-posture";
import { parseLvfsAppstream, resolveLatestFirmware, type LvfsFirmware } from "./lvfs-firmware";

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
  id: string;
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
    // HAM Phase D1 (BI-4731303B): project feed-derived support posture onto the discovered
    // instances of a hardware model (every InventoryEntity resolved to the identity).
    inventoryEntity: {
      updateMany(args: unknown): Promise<{ count: number }>;
    };
  };

export type CatalogSweepFetchers = {
  /** endoflife.date fetcher; defaults to global fetch. */
  eolFetch?: typeof fetch;
  /** NVD CPE-dictionary fetcher; when omitted the CPE is deterministic-only. */
  nvdFetch?: typeof fetch;
  /** Wikidata fetcher (HAM Phase D hardware backfill); when omitted it is skipped. */
  wikidataFetch?: typeof fetch;
  /**
   * LVFS/fwupd catalog loader (HAM Phase D firmware hints, BI-84710E60). A thunk that
   * returns the decompressed AppStream XML (or null) — the transport/gunzip lives in the
   * caller so this module stays pure. Fetched once per sweep, only when the batch has a
   * hardware identity. When omitted, firmware resolution is skipped.
   */
  lvfsFetch?: () => Promise<string | null>;
};

export type CatalogSweepOptions = {
  limit?: number;
  fetchers?: CatalogSweepFetchers;
  /** Clock for support-posture projection (BI-4731303B); defaults to now. Injectable for tests. */
  now?: Date;
};

export type CatalogSweepResult = {
  identitiesScanned: number;
  identitiesTotal: number;
  cpeResolved: number;
  lifecycleMilestonesWritten: number;
  lifecycleProductsMatched: number;
  // HAM Phase D1 (BI-84710E60): part='h' identities routed to the hardware feed stage
  // instead of the software endoflife mapping.
  hardwareIdentitiesEnriched: number;
  hardwareMilestonesWritten: number;
  // HAM Phase D1 (BI-4731303B): InventoryEntity rows whose support posture was projected
  // from a resolved hardware identity's lifecycle milestones.
  entitiesPostureProjected: number;
  // HAM Phase D1 (BI-84710E60 firmware slice): hardware identities whose latest firmware
  // version was resolved from the LVFS catalog and projected onto their instances.
  firmwareVersionsResolved: number;
  sbomComponentsIngested: number;
  bomComponentsTotal: number;
  failures: number;
};

function bomRowToInput(row: SweepBomRow): BomComponentInput {
  return {
    // Carry the row id so the bridge links BomComponent.catalogIdentityId (BI-877FE5D4).
    id: row.id,
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
  const wikidataFetch = options.fetchers?.wikidataFetch;
  const lvfsFetch = options.fetchers?.lvfsFetch;
  const now = options.now ?? new Date();

  const result: CatalogSweepResult = {
    identitiesScanned: 0,
    identitiesTotal: 0,
    cpeResolved: 0,
    lifecycleMilestonesWritten: 0,
    lifecycleProductsMatched: 0,
    hardwareIdentitiesEnriched: 0,
    hardwareMilestonesWritten: 0,
    entitiesPostureProjected: 0,
    firmwareVersionsResolved: 0,
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
      id: true,
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

  // Load the LVFS firmware catalog once (BI-84710E60 firmware slice) — only when the batch
  // has a hardware identity, so a software-only sweep never downloads the catalog. The
  // transport (fetch + gunzip) lives in the injected thunk; failures degrade to no firmware.
  let lvfsComponents: LvfsFirmware[] | null = null;
  if (lvfsFetch && identities.some((i) => i.part === "h")) {
    try {
      const xml = await lvfsFetch();
      lvfsComponents = xml ? parseLvfsAppstream(xml) : null;
    } catch {
      lvfsComponents = null;
    }
  }

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

      if (identity.part === "h") {
        // HAM Phase D1 (BI-84710E60): hardware identities take the hardware feed stage
        // (endoflife.date discontinued/eol + Wikidata backfill) rather than the software
        // release mapping, so end-of-sale posture and low-confidence backfill are captured.
        const hw = await enrichHardwareIdentity(
          db,
          {
            id: identity.id,
            manufacturer: identity.manufacturer,
            product: identity.product,
            productVersion: identity.productVersion,
          },
          { eolFetch, wikidataFetch },
        );
        if (hw.eolMatched || hw.wikidataMatched) result.hardwareIdentitiesEnriched += 1;
        result.hardwareMilestonesWritten += hw.milestonesWritten;

        // Project the feed-derived support posture onto every discovered instance of this
        // hardware model (BI-4731303B). Only when the eol evidence yields a posture — a
        // model with no eol milestone leaves the entities' existing status untouched.
        const posture = deriveSupportPostureFromMilestones(hw.milestones, now);
        if (posture) {
          const { count } = await db.inventoryEntity.updateMany({
            where: { catalogIdentityId: identity.id },
            data: {
              supportStatus: posture.supportStatus,
              supportLifecycleSource: posture.supportLifecycleSource,
              supportLifecycleConfidence: posture.supportLifecycleConfidence,
            },
          });
          result.entitiesPostureProjected += count;
        }

        // Firmware currency (BI-84710E60 firmware slice): resolve the model's latest known
        // firmware from LVFS and project latestKnownVersion onto its instances. Matched by
        // device GUID when discovery carries one, else by manufacturer/model name. Per-entity
        // updatePosture (observed-vs-latest) is a follow-up once firmware GUIDs are collected.
        if (lvfsComponents) {
          const firmware = resolveLatestFirmware(lvfsComponents, {
            manufacturer: identity.manufacturer,
            product: identity.product,
          });
          if (firmware) {
            const { count } = await db.inventoryEntity.updateMany({
              where: { catalogIdentityId: identity.id },
              data: { latestKnownVersion: firmware.version },
            });
            if (count > 0) result.firmwareVersionsResolved += 1;
          }
        }
      } else {
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
      }
    } catch {
      result.failures += 1;
    }
  }

  return result;
}
