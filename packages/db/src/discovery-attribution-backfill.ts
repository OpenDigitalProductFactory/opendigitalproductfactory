// Self-healing re-attribution backfill for InventoryEntity rows.
//
// Why this exists (BI-BAF38ED3): the fingerprint layer (spec §4 layer 0) never
// ran on the edge-node and portal-connection ingestion paths, so every existing
// row was attributed by the coarse `host -> /servers` heuristic with no resolved
// identity. Fixing the ingestion wiring only helps entities observed by the NEXT
// sweep; the rows already persisted would stay mis-binned forever without a
// backfill. This pass re-runs the fingerprint layer over every persisted entity
// and heals the two defects the operator sees:
//
//   1. A row whose day-one signals (OUI vendor / MAC / hostname) now confidently
//      match an active fingerprint rule is re-identified + re-placed to that
//      rule's device-class node (with its CatalogIdentity), instead of sitting
//      as a generic "server".
//   2. A bare network-sweep host that the coarse rule filed as a confident
//      `/servers` — with no compute signal and no fingerprint match — is reset to
//      `needs_review`, matching the demoted attribution rule so it stops
//      masquerading as an identified server.
//
// Idempotent by construction: every write is gated on the target differing from
// the current row, so a second run on an already-healed install is a no-op. It
// is safe to run on every upgrade. Contained DPF-instance internals
// (isDockerOriginEntityKey) are skipped — they are not managed estate.

import { prisma } from "./client";
import { matchInventoryEntity } from "./discovery-fingerprint-adapter";
import { buildDeviceFingerprintObservation } from "./discovery-fingerprint-observation";
import { isUnidentifiedNetworkSweepHost } from "./discovery-attribution";
import { DEFAULT_FINGERPRINT_AUTO_APPLY } from "./discovery-normalize";
import { loadDiscoveryAttributionInputs } from "./discovery-attribution-inputs";
import { isDockerOriginEntityKey } from "./docker-origin";
import { INVENTORY_ENTITY_CANONICAL_WHERE } from "./inventory-entity-lifecycle";

export type AttributionBackfillReport = {
  scanned: number;
  /** Rows re-identified/re-placed by a confident fingerprint match. */
  fingerprinted: number;
  /** Bare `/servers` hosts with no evidence reset to needs_review. */
  demotedToReview: number;
  /** Rows already correct — no write. */
  skipped: number;
  /** No fingerprint rules / taxonomy loaded — nothing could be healed. */
  noInputs: boolean;
  /** True when this was a preview run — counts reflect intent, no rows written. */
  dryRun: boolean;
};

export type AttributionBackfillOptions = {
  /**
   * Compute and count the changes the backfill WOULD make without writing any
   * row. Use to preview impact against a live install before committing.
   */
  dryRun?: boolean;
};

// Entity types that carry no device identity and should never be re-attributed
// by device fingerprinting.
const NON_DEVICE_ENTITY_TYPES = new Set(["subnet", "vlan", "network_interface"]);

type AttributionRow = {
  id: string;
  entityType: string;
  entityKey: string;
  name: string;
  properties: unknown;
  attributionStatus: string;
  attributionMethod: string | null;
  catalogIdentityId: string | null;
  identityStatus: string | null;
  taxonomyNode: { nodeId: string } | null;
  portfolio: { slug: string } | null;
};

/**
 * Re-run the fingerprint attribution layer over every persisted InventoryEntity
 * and write only the rows whose attribution should change. Returns a report.
 */
export async function backfillDiscoveryAttribution(
  options: AttributionBackfillOptions = {},
): Promise<AttributionBackfillReport> {
  const dryRun = options.dryRun ?? false;
  const { taxonomyNodes, fingerprintRules } = await loadDiscoveryAttributionInputs(prisma);

  const report: AttributionBackfillReport = {
    scanned: 0,
    fingerprinted: 0,
    demotedToReview: 0,
    skipped: 0,
    noInputs: !fingerprintRules || fingerprintRules.length === 0 || !taxonomyNodes || taxonomyNodes.length === 0,
    dryRun,
  };

  // With no rules/taxonomy there is nothing to heal — bail without touching data.
  if (report.noInputs || !fingerprintRules) {
    return report;
  }

  const entities = (await prisma.inventoryEntity.findMany({
    where: INVENTORY_ENTITY_CANONICAL_WHERE,
    select: {
      id: true,
      entityType: true,
      entityKey: true,
      name: true,
      properties: true,
      attributionStatus: true,
      attributionMethod: true,
      catalogIdentityId: true,
      identityStatus: true,
      taxonomyNode: { select: { nodeId: true } },
      portfolio: { select: { slug: true } },
    },
  })) as AttributionRow[];

  report.scanned = entities.length;

  for (const entity of entities) {
    // DPF's own contained internals are not managed estate — leave them alone.
    if (isDockerOriginEntityKey(entity.entityKey, entity.name)) {
      report.skipped += 1;
      continue;
    }
    if (NON_DEVICE_ENTITY_TYPES.has(entity.entityType)) {
      report.skipped += 1;
      continue;
    }

    const properties = (entity.properties ?? {}) as Record<string, unknown>;
    const observation = buildDeviceFingerprintObservation({ name: entity.name, attributes: properties });
    const match = observation ? matchInventoryEntity(observation, { rules: fingerprintRules }) : null;
    const confident =
      match !== null &&
      match.taxonomyNodeId !== null &&
      Math.min(match.identityConfidence, match.taxonomyConfidence) >= DEFAULT_FINGERPRINT_AUTO_APPLY;

    if (confident && match && match.taxonomyNodeId) {
      // Target attribution — mirrors fingerprintAttribution() in the normalizer.
      const targetNodeId = match.taxonomyNodeId;
      const targetPortfolioSlug = targetNodeId.startsWith("foundational/") ? "foundational" : null;
      const targetCatalogId = match.catalogIdentityId;
      const targetIdentityStatus = targetCatalogId ? "rule_resolved" : null;
      const targetConfidence = Math.min(match.identityConfidence, match.taxonomyConfidence);

      const alreadyCorrect =
        entity.taxonomyNode?.nodeId === targetNodeId &&
        (entity.portfolio?.slug ?? null) === targetPortfolioSlug &&
        entity.catalogIdentityId === (targetCatalogId ?? null) &&
        (entity.identityStatus ?? null) === targetIdentityStatus &&
        entity.attributionMethod === "rule" &&
        entity.attributionStatus === "attributed";

      if (alreadyCorrect) {
        report.skipped += 1;
        continue;
      }

      if (!dryRun) {
        await prisma.inventoryEntity.update({
          where: { id: entity.id },
          data: {
            taxonomyNode: { connect: { nodeId: targetNodeId } },
            ...(targetPortfolioSlug
              ? { portfolio: { connect: { slug: targetPortfolioSlug } } }
              : { portfolio: { disconnect: true } }),
            ...(targetCatalogId
              ? { catalogIdentity: { connect: { id: targetCatalogId } } }
              : { catalogIdentity: { disconnect: true } }),
            identityStatus: targetIdentityStatus,
            identityConfidence: match.identityConfidence,
            attributionMethod: "rule",
            attributionStatus: "attributed",
            attributionConfidence: targetConfidence,
          },
        });
      }
      report.fingerprinted += 1;
      continue;
    }

    // No fingerprint match. Heal the specific coarse-fallback mis-bin: a bare
    // host/network_client the old `host -> /servers` rule filed as a confident
    // server, with no compute signal and no resolved identity. It must surface
    // as needs_review, matching the demoted rule. Everything else is left as-is.
    const isServerFallback =
      entity.attributionMethod === "rule" &&
      entity.attributionStatus === "attributed" &&
      (entity.taxonomyNode?.nodeId?.endsWith("/servers") ?? false) &&
      entity.catalogIdentityId === null &&
      isUnidentifiedNetworkSweepHost({
        entityKey: entity.entityKey,
        entityType: entity.entityType,
        itemType: entity.entityType,
        name: entity.name,
        properties,
      });

    if (isServerFallback) {
      if (!dryRun) {
        await prisma.inventoryEntity.update({
          where: { id: entity.id },
          data: {
            taxonomyNode: { disconnect: true },
            portfolio: { disconnect: true },
            attributionStatus: "needs_review",
            attributionMethod: "heuristic",
          },
        });
      }
      report.demotedToReview += 1;
      continue;
    }

    report.skipped += 1;
  }

  return report;
}

// Allow running directly:
//   pnpm --filter @dpf/db tsx src/discovery-attribution-backfill.ts
//   DRY_RUN=1 pnpm --filter @dpf/db tsx src/discovery-attribution-backfill.ts  # preview
if (require.main === module) {
  const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
  backfillDiscoveryAttribution({ dryRun })
    .then((report) => {
      console.log(`Discovery attribution backfill ${dryRun ? "(DRY RUN) " : ""}complete:`);
      console.log(JSON.stringify(report, null, 2));
      return prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error("Attribution backfill failed:", error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
