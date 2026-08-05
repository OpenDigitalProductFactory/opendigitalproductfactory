import { describe, expect, it } from "vitest";

import { deriveInventoryEnrichment } from "./inventory-enrichment";
import { deriveInventoryEvidenceSnapshot } from "./discovery-evidence";
import { evaluateInventoryQuality } from "./discovery-attribution";

// THE DETECTOR MUST SEE WHAT THE ROW HOLDS.
//
// discovery-sync persists `deriveInventoryEnrichment(...)` onto InventoryEntity
// (manufacturer from MAC OUI vendor / container image tag / service-name hints,
// supportStatus, versions) but evaluated quality against
// `deriveInventoryEvidenceSnapshot(...)` — package-manager software evidence
// ONLY. So discovery could enrich an entity and then, in the same transaction,
// re-raise `catalog_match_ambiguous` / `lifecycle_unverified` about the very
// fields it had just populated.
//
// That made those queues self-sustaining: enrichment can never satisfy a
// condition evaluated without it. Observed live on 2026-08-01 — of five sampled
// open lifecycle_unverified rows whose entity the sweep HAD just re-observed and
// whose persisted supportStatus was `supported`, four had ZERO
// DiscoveredSoftwareEvidence rows (postgres-exporter, prometheus, redis-exporter,
// inngest). The reconcile shipped in #3873 correctly declined to close them:
// from the detector's blinded view they were still warranted.

/** A service entity with NO package-manager evidence — the live shape.
 *
 * Keyed as MANAGED estate. The live row this was drawn from is
 * `service:prom:redis:redis-exporter:9121`, but `prom:` is now classified
 * `observed` for identity/lifecycle as well as staleness (BI-A3D12F85), so that
 * key would be suppressed before the enrichment-visibility logic under test was
 * ever reached — the assertions would pass for the wrong reason. The property
 * shape, which is what drives `deriveInventoryEnrichment`, is unchanged. */
const SERVICE_WITH_NO_SOFTWARE_EVIDENCE = {
  entityKey: "organization:internal:service:app:redis-exporter",
  entityType: "service",
  name: "redis-exporter",
  properties: { job: "redis", vendor: "Redis" },
};

function qualityInput(useEnrichment: boolean) {
  const evidenceSnapshot = deriveInventoryEvidenceSnapshot([]);
  const enriched = deriveInventoryEnrichment({
    entityType: SERVICE_WITH_NO_SOFTWARE_EVIDENCE.entityType,
    name: SERVICE_WITH_NO_SOFTWARE_EVIDENCE.name,
    manufacturer: evidenceSnapshot.manufacturer,
    productModel: evidenceSnapshot.productModel,
    observedVersion: evidenceSnapshot.observedVersion,
    normalizedVersion: evidenceSnapshot.normalizedVersion,
    iconKey: null,
    supportStatus: evidenceSnapshot.supportStatus,
    properties: SERVICE_WITH_NO_SOFTWARE_EVIDENCE.properties as never,
  });

  return {
    entityKey: SERVICE_WITH_NO_SOFTWARE_EVIDENCE.entityKey,
    entityType: SERVICE_WITH_NO_SOFTWARE_EVIDENCE.entityType,
    attributionStatus: "attributed" as const,
    attributionConfidence: 0.99,
    candidateTaxonomy: [],
    taxonomyNodeId: "foundational/platform_services/container_platform",
    digitalProductId: null,
    // This is the line under test: enriched values, or the blinded snapshot.
    manufacturer: useEnrichment
      ? enriched.manufacturer ?? evidenceSnapshot.manufacturer
      : evidenceSnapshot.manufacturer,
    observedVersion: useEnrichment
      ? enriched.observedVersion ?? evidenceSnapshot.observedVersion
      : evidenceSnapshot.observedVersion,
    normalizedVersion: useEnrichment
      ? enriched.normalizedVersion ?? evidenceSnapshot.normalizedVersion
      : evidenceSnapshot.normalizedVersion,
    supportStatus: useEnrichment
      ? enriched.supportStatus ?? evidenceSnapshot.supportStatus
      : evidenceSnapshot.supportStatus,
    hasSoftwareEvidence: evidenceSnapshot.hasSoftwareEvidence,
    normalizationStatus: evidenceSnapshot.normalizationStatus,
    enriched,
  };
}

describe("quality evaluation sees the enrichment the row was given", () => {
  it("enrichment genuinely populates a manufacturer with no software evidence", () => {
    // Guards the premise: if enrichment stopped inferring here the test below
    // would pass vacuously.
    const { enriched } = qualityInput(true);
    expect(enriched.manufacturer).toBeTruthy();
  });

  it("evaluating on the BLINDED snapshot re-raises identity for an enriched entity", () => {
    const { enriched: _e, ...blinded } = qualityInput(false);
    const { issues } = evaluateInventoryQuality([blinded]);

    // This is the bug, pinned: the row will be written with a manufacturer, yet
    // the detector raises "still needs identity review" in the same transaction.
    expect(issues.map((i) => i.issueType)).toContain("catalog_match_ambiguous");
  });

  it("evaluating on the ENRICHED values resolves identity instead of re-raising", () => {
    const { enriched: _e, ...withEnrichment } = qualityInput(true);
    const { issues, resolvedIssueKeys } = evaluateInventoryQuality([withEnrichment]);

    expect(issues.map((i) => i.issueType)).not.toContain("catalog_match_ambiguous");
    expect(resolvedIssueKeys).toContain(
      `inventory_entity:${SERVICE_WITH_NO_SOFTWARE_EVIDENCE.entityKey}:catalog_match_ambiguous`,
    );
  });

  it("keeps raising identity when enrichment ALSO cannot determine a manufacturer", () => {
    // Managed estate with nothing to go on: no vendor property, no name hint, no
    // evidence. The fix must not paper over genuinely unidentifiable estate.
    //
    // This was originally an ARP neighbour. Identity is now asked only of the
    // managed estate (BI-A3D12F85) — for an ARP host the correct outcome is
    // suppression, which is asserted in discovery-attribution.reconcile.test.ts.
    // Keeping an `arp:` key here would have made this test pass for the opposite
    // reason to the one it was written for.
    const evidenceSnapshot = deriveInventoryEvidenceSnapshot([]);
    const enriched = deriveInventoryEnrichment({
      entityType: "host",
      name: "192.168.0.184",
      manufacturer: evidenceSnapshot.manufacturer,
      productModel: evidenceSnapshot.productModel,
      observedVersion: evidenceSnapshot.observedVersion,
      normalizedVersion: evidenceSnapshot.normalizedVersion,
      iconKey: null,
      supportStatus: evidenceSnapshot.supportStatus,
      properties: {} as never,
    });

    const { issues } = evaluateInventoryQuality([
      {
        entityKey: "organization:internal:host:host:linux:196ab12522a9d6ca",
        entityType: "host",
        attributionStatus: "attributed" as const,
        attributionConfidence: 0.9,
        candidateTaxonomy: [],
        taxonomyNodeId: "foundational/compute/servers",
        digitalProductId: null,
        manufacturer: enriched.manufacturer ?? evidenceSnapshot.manufacturer,
        observedVersion: enriched.observedVersion ?? evidenceSnapshot.observedVersion,
        normalizedVersion: enriched.normalizedVersion ?? evidenceSnapshot.normalizedVersion,
        supportStatus: enriched.supportStatus ?? evidenceSnapshot.supportStatus,
        hasSoftwareEvidence: evidenceSnapshot.hasSoftwareEvidence,
        normalizationStatus: evidenceSnapshot.normalizationStatus,
      },
    ]);

    expect(issues.map((i) => i.issueType)).toContain("catalog_match_ambiguous");
  });
});
