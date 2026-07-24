import { describe, expect, it } from "vitest";

import {
  QUALITY_ISSUE_REGISTRY,
  QUALITY_ISSUE_TYPES,
  isKnownQualityIssueType,
  qualityIssueContract,
  operatorActionableTypes,
  qualityIssueDrift,
} from "./quality-issue-registry";

// The registry IS the governance gate. These tests are what stop a detector
// being added with no declared way to close what it opens — the defect that let
// 2,247 rows accumulate across 8 undeclared types.
describe("quality issue registry — lifecycle contract", () => {
  it("every registered type declares a resolver, an owner and a steady-state budget", () => {
    const incomplete = QUALITY_ISSUE_TYPES.filter((type) => {
      const contract = QUALITY_ISSUE_REGISTRY[type];
      return (
        !contract.resolvedBy
        || !contract.owner
        || typeof contract.expectedSteadyState !== "number"
        || !contract.summary
      );
    });
    expect(incomplete).toEqual([]);
  });

  it("a type that never auto-resolves must be operator-actionable", () => {
    // Otherwise it is a permanently-open row generator by construction: nothing
    // closes it automatically and nobody can act on it. That is precisely what
    // name_not_promotable / type_not_promotable were before the arc.
    const orphaned = QUALITY_ISSUE_TYPES.filter((type) => {
      const contract = QUALITY_ISSUE_REGISTRY[type];
      return contract.autoResolveWhen === null && !contract.operatorActionable;
    });
    expect(orphaned).toEqual([]);
  });

  it("covers every issue type present in the live database", () => {
    // Ground truth observed on the running install (2026-07-24). A type reaching
    // production without a registry entry is the exact regression this guards.
    const liveTypes = [
      "stale_relationship",
      "name_not_promotable",
      "lifecycle_unverified",
      "catalog_match_ambiguous",
      "stale_entity",
      "type_not_promotable",
      "health_alert",
      "attribution_missing",
      "taxonomy_attribution_low_confidence",
      "gateway_connection_needed",
    ];
    const unregistered = liveTypes.filter((type) => !isKnownQualityIssueType(type));
    expect(unregistered).toEqual([]);
  });

  it("rejects an unregistered type", () => {
    expect(isKnownQualityIssueType("totally_made_up")).toBe(false);
    expect(isKnownQualityIssueType("stale_entity")).toBe(true);
  });

  it("exposes the contract for a type", () => {
    const contract = qualityIssueContract("stale_relationship");
    expect(contract.resolvedBy).toBe("discovery-sweep-reconcile");
    expect(contract.expectedSteadyState).toBe(0);
    expect(contract.autoResolveWhen).toContain("reconcile-on-recovery");
  });

  it("names the operator-actionable queues an owner is accountable for", () => {
    const actionable = operatorActionableTypes();
    expect(actionable).toContain("lifecycle_unverified");
    expect(actionable).toContain("catalog_match_ambiguous");
    // A correct structural classification is not operator work.
    expect(actionable).not.toContain("name_not_promotable");
  });
});

describe("qualityIssueDrift — what a proactive sweep acts on", () => {
  it("reports over-budget queues worst-first with their owner", () => {
    const drift = qualityIssueDrift({
      lifecycle_unverified: 178,
      catalog_match_ambiguous: 175,
      stale_entity: 9,
    });

    expect(drift.map((d) => d.type)).toEqual([
      "lifecycle_unverified",
      "catalog_match_ambiguous",
      "stale_entity",
    ]);
    expect(drift[0]).toMatchObject({ open: 178, budget: 0, over: 178 });
    expect(drift[0].owner).toBe("coworker:estate-specialist");
  });

  it("reports nothing when every queue is at its steady state", () => {
    expect(qualityIssueDrift({ stale_entity: 0, lifecycle_unverified: 0 })).toEqual([]);
  });

  it("ignores unregistered types rather than inventing a budget for them", () => {
    const drift = qualityIssueDrift({ some_unregistered_type: 500, stale_entity: 1 });
    expect(drift.map((d) => d.type)).toEqual(["stale_entity"]);
  });
});
