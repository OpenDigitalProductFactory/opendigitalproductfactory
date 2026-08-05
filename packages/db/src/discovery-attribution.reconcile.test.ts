import { describe, expect, it } from "vitest";

import {
  evaluateInventoryQuality,
  RECONCILED_ENTITY_ISSUE_TYPES,
  type InventoryQualityEntityInput,
} from "./discovery-attribution";
import { QUALITY_ISSUE_REGISTRY } from "./quality-issue-registry";

// The executable half of `autoResolveWhen`.
//
// The registry declared every type's close condition in PROSE that no code path
// read — only stale_entity / stale_relationship ever had an implementation. On
// the live install that left 134 of 196 open rows (68%) whose stated condition
// was ALREADY TRUE: 67 lifecycle_unverified on entities reporting `supported`,
// 67 catalog_match_ambiguous on entities that already had a manufacturer.
//
// These tests pin the negation: when a condition stops holding, the sweep that
// notices must report the key as resolved.

/** A fully-identified, fully-attributed entity — nothing should be warranted. */
function cleanEntity(
  overrides: Partial<InventoryQualityEntityInput> = {},
): InventoryQualityEntityInput {
  return {
    entityKey: "organization:internal:host:srv:app-01",
    entityType: "host",
    attributionStatus: "attributed",
    attributionConfidence: 0.99,
    candidateTaxonomy: [],
    taxonomyNodeId: "foundational/compute/servers",
    manufacturer: "Dell Inc.",
    observedVersion: "1.2.3",
    normalizedVersion: "1.2.3",
    normalizationStatus: "normalized",
    supportStatus: "supported",
    hasSoftwareEvidence: true,
    ...overrides,
  };
}

const keyFor = (entity: InventoryQualityEntityInput, suffix: string) =>
  `inventory_entity:${entity.entityKey}:${suffix}`;

describe("evaluateInventoryQuality — reconcile-on-condition", () => {
  it("reports lifecycle_unverified resolved once supportStatus is known", () => {
    const entity = cleanEntity({ supportStatus: "supported" });
    const { issues, resolvedIssueKeys } = evaluateInventoryQuality([entity]);

    expect(resolvedIssueKeys).toContain(keyFor(entity, "lifecycle_unverified"));
    expect(issues.map((i) => i.issueType)).not.toContain("lifecycle_unverified");
  });

  it("still raises lifecycle_unverified while supportStatus is unknown", () => {
    const entity = cleanEntity({ supportStatus: "unknown" });
    const { issues, resolvedIssueKeys } = evaluateInventoryQuality([entity]);

    expect(issues.map((i) => i.issueType)).toContain("lifecycle_unverified");
    // Critically NOT resolved — closing a warranted row would destroy real signal.
    expect(resolvedIssueKeys).not.toContain(keyFor(entity, "lifecycle_unverified"));
  });

  it("reports catalog_match_ambiguous resolved once identity evidence lands", () => {
    const entity = cleanEntity();
    const { issues, resolvedIssueKeys } = evaluateInventoryQuality([entity]);

    expect(resolvedIssueKeys).toContain(keyFor(entity, "catalog_match_ambiguous"));
    expect(issues.map((i) => i.issueType)).not.toContain("catalog_match_ambiguous");
  });

  it("keeps catalog_match_ambiguous open while any identity clause still holds", () => {
    // Manufacturer present, but an observed version that never normalized — the
    // middle clause of the emit condition. A resolver that only checked
    // manufacturer would wrongly close this.
    const entity = cleanEntity({ normalizedVersion: null });
    const { issues, resolvedIssueKeys } = evaluateInventoryQuality([entity]);

    expect(issues.map((i) => i.issueType)).toContain("catalog_match_ambiguous");
    expect(resolvedIssueKeys).not.toContain(keyFor(entity, "catalog_match_ambiguous"));
  });

  it("reports attribution issues resolved once the entity is attributed", () => {
    const entity = cleanEntity({ attributionStatus: "attributed" });
    const { resolvedIssueKeys } = evaluateInventoryQuality([entity]);

    expect(resolvedIssueKeys).toContain(keyFor(entity, "attribution_missing"));
    expect(resolvedIssueKeys).toContain(keyFor(entity, "taxonomy_low_confidence"));
  });

  it("never reports the same key as both raised and resolved", () => {
    // The emit/resolve branches are an if/else on one condition, so this holds by
    // construction — pinned because a future edit could split them apart and the
    // caller upserts `issues` while closing `resolvedIssueKeys`, so an overlap
    // would make the outcome depend on statement order.
    const entities = [
      cleanEntity({ entityKey: "k1", supportStatus: "unknown" }),
      cleanEntity({ entityKey: "k2", manufacturer: null }),
      cleanEntity({ entityKey: "k3", attributionStatus: "needs_review" }),
      cleanEntity({ entityKey: "k4" }),
    ];
    const { issues, resolvedIssueKeys } = evaluateInventoryQuality(entities);

    const raised = new Set(issues.map((i) => i.issueKey));
    const overlap = resolvedIssueKeys.filter((key) => raised.has(key));
    expect(overlap).toEqual([]);
  });

  it("RESOLVES every issue for a Docker-origin entity it refuses to evaluate", () => {
    // This reverses an earlier decision, deliberately. The previous rule was that
    // a suppressed subject must emit no resolve keys either, on the reasoning
    // that doing so "would silently close issues raised by a source that DID
    // evaluate them". That reasoning does not hold: isDockerOriginEntityKey is a
    // pure function of the entityKey, so EVERY source reaches the same verdict
    // and none of them can legitimately raise for this subject.
    //
    // What the old rule actually produced was an orphan leak. A bare `continue`
    // puts the subject in neither list, so rows opened before the suppression
    // rule existed have no close path at all. Tightening the guard to match
    // `:container:` positionally correctly stopped NEW rows for
    // `monitoring_service:container:<id>` and stranded 19 already-open ones —
    // measured on the live install as the unexplained residual in BI-A3D12F85.
    //
    // A key the guard genuinely matches, AND one that would otherwise be
    // warranted on every branch — so this proves suppression fired rather than
    // that a clean entity raised nothing.
    const suppressed = cleanEntity({
      entityKey: "docker-host:abc123",
      supportStatus: "unknown",
      manufacturer: null,
      attributionStatus: "needs_review",
    });
    const { issues, resolvedIssueKeys } = evaluateInventoryQuality([suppressed]);

    expect(issues).toEqual([]);
    expect(new Set(resolvedIssueKeys)).toEqual(new Set([
      keyFor(suppressed, "attribution_missing"),
      keyFor(suppressed, "taxonomy_low_confidence"),
      keyFor(suppressed, "lifecycle_unverified"),
      keyFor(suppressed, "catalog_match_ambiguous"),
      keyFor(suppressed, "stale"),
    ]));
  });

  it("covers every issue-key suffix the entity loop can emit", () => {
    // The suppression resolve is a hand-written suffix list, so a NEW emit branch
    // with a new key suffix would be suppressed without ever being closed —
    // re-opening the leak this test exists to prevent. Drive every emit branch,
    // then assert suppression would have resolved each key it produced.
    const warranted: InventoryQualityEntityInput = {
      entityKey: "organization:internal:host:srv:needs-everything",
      entityType: "host",
      attributionStatus: "needs_review",
      attributionConfidence: 0.1,
      candidateTaxonomy: [{ nodeId: "foundational/compute/servers", score: 0.1 }],
      manufacturer: null,
      observedVersion: "9",
      normalizedVersion: null,
      normalizationStatus: "needs_review",
      supportStatus: "unknown",
      hasSoftwareEvidence: false,
    };
    const emittedSuffixes = evaluateInventoryQuality([warranted]).issues.map((issue) =>
      issue.issueKey.slice(`inventory_entity:${warranted.entityKey}:`.length),
    );
    expect(emittedSuffixes.length).toBeGreaterThan(0);

    // Same entity, but Docker-origin so every branch is suppressed instead.
    const resolvedSuffixes = new Set(
      evaluateInventoryQuality([{ ...warranted, entityKey: "docker-host:needs-everything" }])
        .resolvedIssueKeys
        .map((key) => key.slice("inventory_entity:docker-host:needs-everything:".length)),
    );
    expect(emittedSuffixes.filter((suffix) => !resolvedSuffixes.has(suffix))).toEqual([]);
  });
});

describe("evaluateInventoryQuality — identity and lifecycle are managed-estate questions", () => {
  // Measured on the live install by executing the detector: MAC OUI enrichment
  // resolved 65 of 65 burned-in MACs to a vendor and 0 of 119 locally-administered
  // ones. Every ARP host swept on 2026-08-05 carries a randomised MAC, which has
  // no OUI and therefore no vendor, catalog identity or support lifecycle BY
  // CONSTRUCTION. Those rows are unresolvable, not merely unresolved, and 180 of
  // them buried the 21 describing real managed gear. See BI-A3D12F85.
  const observedKeys = [
    "organization:internal:host:arp:192.168.0.211",
    "host:arp:768BE4C02998",
    "organization:internal:unifi-client:aa:bb:cc:dd:ee:ff",
    "database:prom:qdrant:qdrant:6333",
  ];

  for (const entityKey of observedKeys) {
    it(`resolves rather than raises identity/lifecycle for observed subject ${entityKey}`, () => {
      const observed = cleanEntity({
        entityKey,
        // Warranted on every clause if this were managed estate.
        manufacturer: null,
        supportStatus: "unknown",
        normalizationStatus: "needs_review",
      });
      const { issues, resolvedIssueKeys } = evaluateInventoryQuality([observed]);

      expect(issues.map((issue) => issue.issueType)).not.toContain("catalog_match_ambiguous");
      expect(issues.map((issue) => issue.issueType)).not.toContain("lifecycle_unverified");
      // Suppression must CLOSE, never merely skip — otherwise scoping the queue
      // re-creates the orphan leak at 180x the scale.
      expect(resolvedIssueKeys).toContain(keyFor(observed, "catalog_match_ambiguous"));
      expect(resolvedIssueKeys).toContain(keyFor(observed, "lifecycle_unverified"));
    });
  }

  it("still raises identity and lifecycle for genuinely managed gear", () => {
    // The 21 rows that survived the live measurement are this shape: a UniFi AP
    // with no manufacturer is real, actionable signal — and was invisible under
    // 400+ rows about randomised-MAC phones.
    const managed = cleanEntity({
      entityKey: "organization:internal:access_point:unifi:ac:8b:a9:3f:1b:29",
      entityType: "access_point",
      manufacturer: null,
      supportStatus: "unknown",
    });
    const { issues } = evaluateInventoryQuality([managed]);

    expect(issues.map((issue) => issue.issueType)).toContain("catalog_match_ambiguous");
    expect(issues.map((issue) => issue.issueType)).toContain("lifecycle_unverified");
  });

  it("does not match observed tokens inside a managed product name", () => {
    // Positional matching: `promotions-engine` contains "prom" but is managed.
    const managed = cleanEntity({
      entityKey: "organization:internal:service:app:promotions-engine",
      entityType: "service",
      manufacturer: null,
      supportStatus: "unknown",
    });
    const { issues } = evaluateInventoryQuality([managed]);

    expect(issues.map((issue) => issue.issueType)).toContain("catalog_match_ambiguous");
    expect(issues.map((issue) => issue.issueType)).toContain("lifecycle_unverified");
  });
});

describe("reconcile conformance — a new detector cannot skip its resolve branch", () => {
  it("every entity-subject type the evaluator can emit is reconciled or absence-raised", () => {
    // Drive every emit branch at once, then assert each emitted type either has a
    // resolve branch (listed in RECONCILED_ENTITY_ISSUE_TYPES) or is raised BY its
    // subject's absence (stale_entity, whose dual is reconcile-on-recovery).
    // Adding an emit branch without a resolve branch fails here, which is exactly
    // how `autoResolveWhen` became prose nothing executed.
    const { issues } = evaluateInventoryQuality([
      {
        entityKey: "organization:internal:host:srv:needs-everything",
        entityType: "host",
        attributionStatus: "needs_review",
        attributionConfidence: 0.1,
        candidateTaxonomy: [{ nodeId: "foundational/compute/servers", score: 0.1 }],
        manufacturer: null,
        observedVersion: "9",
        normalizedVersion: null,
        normalizationStatus: "needs_review",
        supportStatus: "unknown",
        hasSoftwareEvidence: false,
      },
    ]);

    const emitted = [...new Set(issues.map((issue) => issue.issueType))];
    expect(emitted.length).toBeGreaterThan(0);

    const uncovered = emitted.filter(
      (type) =>
        !(RECONCILED_ENTITY_ISSUE_TYPES as readonly string[]).includes(type)
        && !QUALITY_ISSUE_REGISTRY[type].raisedBySubjectAbsence,
    );
    expect(uncovered).toEqual([]);
  });

  it("every reconciled type is an entity-subject type that is not absence-raised", () => {
    for (const type of RECONCILED_ENTITY_ISSUE_TYPES) {
      const contract = QUALITY_ISSUE_REGISTRY[type];
      expect(contract.subject).toBe("entity");
      expect(contract.raisedBySubjectAbsence).toBe(false);
    }
  });
});
