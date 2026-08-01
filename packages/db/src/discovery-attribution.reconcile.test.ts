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

  it("does not reconcile Docker-origin entities it refuses to evaluate", () => {
    // Docker rows are skipped before any issue branch. Emitting resolve keys for
    // them would silently close issues raised by a source that DID evaluate them.
    // A key the guard genuinely matches (docker-host: prefix), AND one that would
    // otherwise be warranted — so this proves the `continue` fires rather than
    // just that a clean entity raises nothing.
    const { issues, resolvedIssueKeys } = evaluateInventoryQuality([
      cleanEntity({
        entityKey: "docker-host:abc123",
        supportStatus: "unknown",
        manufacturer: null,
        attributionStatus: "needs_review",
      }),
    ]);

    expect(issues).toEqual([]);
    expect(resolvedIssueKeys).toEqual([]);
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
