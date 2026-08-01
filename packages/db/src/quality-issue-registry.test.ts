import { describe, expect, it } from "vitest";

import {
  QUALITY_ISSUE_REGISTRY,
  QUALITY_ISSUE_TYPES,
  isKnownQualityIssueType,
  qualityIssueContract,
  operatorActionableTypes,
  qualityIssueDrift,
  subjectBearingTypes,
} from "./quality-issue-registry";
import { COWORKER_SLUG_TO_CANONICAL_AGENT_ID } from "./agent-identity";

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

  it("every type declares which inventory row it is raised about", () => {
    // Without a declared subject the sweep cannot tell which FK to follow, so an
    // issue pinned to a row that has gone away stays open forever. 179 of 462
    // open rows on the live install were in exactly that state.
    const undeclared = QUALITY_ISSUE_TYPES.filter(
      (type) => !["entity", "relationship", "scope"].includes(QUALITY_ISSUE_REGISTRY[type].subject),
    );
    expect(undeclared).toEqual([]);
  });

  it("only a subject-bearing type may be raised BY its subject's absence", () => {
    // "scope" issues have no inventory row to go missing, so the absence
    // direction is meaningless for them and would silently never fire.
    const contradictory = QUALITY_ISSUE_TYPES.filter((type) => {
      const contract = QUALITY_ISSUE_REGISTRY[type];
      return contract.raisedBySubjectAbsence && contract.subject === "scope";
    });
    expect(contradictory).toEqual([]);
  });

  it("splits subject-bearing types into the two auto-resolve directions with no overlap", () => {
    const recovered = [
      ...subjectBearingTypes("entity", true),
      ...subjectBearingTypes("relationship", true),
    ];
    const lost = [
      ...subjectBearingTypes("entity", false),
      ...subjectBearingTypes("relationship", false),
    ];

    // The staleness detectors are the ONLY absence-raised types; if a new one
    // joins them it must be a deliberate decision, not an accident.
    expect(recovered.sort()).toEqual(["stale_entity", "stale_relationship"]);
    expect(lost).not.toHaveLength(0);
    expect(recovered.filter((type) => lost.includes(type))).toEqual([]);
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

  it("every coworker owner resolves to a real coworker slug", () => {
    // All 9 coworker-owned types named `coworker:estate-specialist` — an id that
    // exists in NEITHER the slug map NOR the Agent table. It was written against
    // the DISPLAY NAME of `inventory-specialist` ("Digital Product Estate
    // Specialist"). Drift reports therefore named an owner nothing could route
    // to, which is a large part of why 435 rows sat unworked for three months.
    const unresolvable = QUALITY_ISSUE_TYPES.map((type) => QUALITY_ISSUE_REGISTRY[type].owner)
      .filter((owner) => owner.startsWith("coworker:"))
      .map((owner) => owner.slice("coworker:".length))
      .filter((slug) => !(slug in COWORKER_SLUG_TO_CANONICAL_AGENT_ID));

    expect([...new Set(unresolvable)]).toEqual([]);
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
    // Was asserting `coworker:estate-specialist` — an owner that resolves to no
    // agent. The test had codified the routing bug rather than catching it.
    expect(drift[0].owner).toBe("coworker:inventory-specialist");
  });

  it("reports nothing when every queue is at its steady state", () => {
    expect(qualityIssueDrift({ stale_entity: 0, lifecycle_unverified: 0 })).toEqual([]);
  });

  it("ignores unregistered types rather than inventing a budget for them", () => {
    const drift = qualityIssueDrift({ some_unregistered_type: 500, stale_entity: 1 });
    expect(drift.map((d) => d.type)).toEqual(["stale_entity"]);
  });
});
