// discovery-quality-input.ts
//
// Assembles the input `evaluateInventoryQuality` judges an entity on.
//
// This is its own module because WHICH FACTS THE DETECTOR SEES has been the
// single recurring defect in this subsystem, and it deserves a home with its own
// tests rather than eighty lines buried in the middle of a transaction:
//
//   #3912  the detector read `deriveInventoryEvidenceSnapshot` (package-manager
//          evidence ONLY) while the row was written from
//          `deriveInventoryEnrichment` — so discovery identified an entity and
//          re-raised an identity issue about it in the same transaction.
//   #3967  enrichment is starved on a poor source (an ARP sweep with no MAC), so
//          judging on THIS sweep alone re-raised for an entity the persisted row
//          already identified. Hence persisted-first.
//   #4016  the stale branch passed no identity at all, so `!manufacturer` was
//          true by OMISSION rather than by checking — every stale entity
//          re-raised both identity and lifecycle forever, regardless of its row.
//
// The through-line: a fact the detector cannot see is indistinguishable from a
// fact that is absent, and the emit and resolve branches must weigh exactly the
// same facts (the #3873 invariant). Both shapes below are built here, together,
// so that stays true.

import type { InventoryQualityEntityInput } from "./discovery-attribution";
import { deriveInventoryEvidenceSnapshot } from "./discovery-evidence";
import type { deriveInventoryEnrichment } from "./inventory-enrichment";
import type { NormalizedDiscoveryOutput } from "./discovery-normalize";

/** The identity columns carried on the persisted InventoryEntity row. */
export type PersistedEntityIdentity = {
  manufacturer: string | null;
  observedVersion: string | null;
  normalizedVersion: string | null;
  supportStatus: string;
};

/** As above, plus the type — available for entities read back from the DB. */
export type PersistedEntityRow = PersistedEntityIdentity & { entityType: string };

export type BuildQualityEntitiesArgs = {
  /** Entities THIS sweep observed. */
  observedEntities: NormalizedDiscoveryOutput["inventoryEntities"];
  /** Package-manager software evidence from this sweep, by entity key. */
  softwareEvidenceByEntityKey: Map<string, NormalizedDiscoveryOutput["softwareEvidence"]>;
  /** This sweep's derived enrichment (MAC OUI vendor, image tag, name hints). */
  enrichmentByEntityKey: Map<string, ReturnType<typeof deriveInventoryEnrichment>>;
  /** Identity read back from the row this sweep just upserted. */
  persistedIdentityByEntityKey: Map<string, PersistedEntityIdentity>;
  /** Entities this source previously confirmed but did NOT re-observe. */
  staleEntityKeys: string[];
  /** Every entity this source has confirmed, with its persisted identity. */
  existingEntityByKey: Map<string, PersistedEntityRow>;
};

/**
 * Build the entity list for `evaluateInventoryQuality` — observed entities first,
 * then the stale ones, both judged on the persisted row.
 */
export function buildQualityEvaluationEntities(
  args: BuildQualityEntitiesArgs,
): InventoryQualityEntityInput[] {
  const {
    observedEntities,
    softwareEvidenceByEntityKey,
    enrichmentByEntityKey,
    persistedIdentityByEntityKey,
    staleEntityKeys,
    existingEntityByKey,
  } = args;

  const observed = observedEntities.map((entity) => {
    const evidenceSnapshot = deriveInventoryEvidenceSnapshot(
      softwareEvidenceByEntityKey.get(entity.entityKey) ?? [],
    );
    const enriched = enrichmentByEntityKey.get(entity.entityKey);
    const persisted = persistedIdentityByEntityKey.get(entity.entityKey);

    const qualityEntity: InventoryQualityEntityInput = {
      entityKey: entity.entityKey,
      entityType: entity.entityType,
      attributionStatus: entity.attributionStatus,
      attributionMethod: entity.attributionMethod ?? null,
      attributionConfidence: entity.attributionConfidence ?? null,
      candidateTaxonomy: entity.candidateTaxonomy?.map((candidate) => ({
        nodeId: candidate.nodeId,
        score: candidate.score,
      })) ?? null,
      taxonomyNodeId: entity.taxonomyNodeId ?? null,
      digitalProductId: null,
      // PERSISTED row first, then this sweep's enrichment, then the snapshot.
      // manufacturer/supportStatus are sticky across sources (written only when
      // enrichment yields them) while `properties` is replaced every sweep — so a
      // poor source (ARP, no MAC) starves enrichment and, judged on this sweep
      // alone, re-raises an issue for an entity the row already identifies. That
      // is why the enrichment-only fix did not drain the queues (#3967).
      manufacturer:
        persisted?.manufacturer ?? enriched?.manufacturer ?? evidenceSnapshot.manufacturer,
      observedVersion:
        persisted?.observedVersion ?? enriched?.observedVersion ?? evidenceSnapshot.observedVersion,
      normalizedVersion:
        persisted?.normalizedVersion
        ?? enriched?.normalizedVersion
        ?? evidenceSnapshot.normalizedVersion,
      // supportStatus is non-nullable and defaults to "unknown", so a plain ??
      // chain would stop at the persisted default and never consult the sweep.
      // Take the first value that is actually known.
      supportStatus:
        [persisted?.supportStatus, enriched?.supportStatus, evidenceSnapshot.supportStatus]
          .find((value) => value && value !== "unknown")
        ?? "unknown",
      hasSoftwareEvidence: evidenceSnapshot.hasSoftwareEvidence,
      normalizationStatus: evidenceSnapshot.normalizationStatus,
    };

    if (entity.attributionStatus === "needs_review") {
      return { ...qualityEntity, qualityStatus: "warning" as const };
    }
    return qualityEntity;
  });

  // A stale entity is judged on its PERSISTED identity, exactly as an observed
  // one is. Passing only {entityKey, attributionStatus} made the detector
  // re-raise catalog_match_ambiguous and lifecycle_unverified for EVERY stale
  // entity on facts it had not checked but merely omitted —
  // `database:prom:qdrant:qdrant:6333` carries manufacturer "qdrant" and still
  // re-raised every sweep.
  //
  // `normalizationStatus` is deliberately absent rather than defaulted: it is
  // derived from this sweep's DiscoveredSoftwareEvidence and is not a persisted
  // column, so a sweep that did not observe the entity genuinely has no value for
  // it. The persisted identity columns are the whole of the available truth.
  //
  // `entityType` comes from the row too, not a placeholder: it decides whether
  // the subject is identity-OPTIONAL (network_interface, subnet, vlan), and the
  // old hardcoded "inventory_entity" made a stale NIC look like it owed a
  // manufacturer.
  const stale = staleEntityKeys.map((entityKey): InventoryQualityEntityInput => {
    const persisted = existingEntityByKey.get(entityKey);
    return {
      entityKey,
      entityType: persisted?.entityType ?? "inventory_entity",
      attributionStatus: "stale" as const,
      manufacturer: persisted?.manufacturer ?? null,
      observedVersion: persisted?.observedVersion ?? null,
      normalizedVersion: persisted?.normalizedVersion ?? null,
      supportStatus: persisted?.supportStatus ?? "unknown",
    };
  });

  return [...observed, ...stale];
}
