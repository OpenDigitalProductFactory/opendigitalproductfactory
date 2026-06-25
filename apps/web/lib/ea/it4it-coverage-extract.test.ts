import { describe, it, expect } from "vitest";
import {
  buildIt4itCoverageModel,
  PROJECTION_RATIONALE_PREFIX,
  DERIVED_CONFIDENCE,
  type It4itCoverageFacts,
  type It4itElementFact,
} from "./it4it-coverage-extract";

// Minimal synthetic IT4IT tree: two capability groups, each with one function + component.
// S2P/Enterprise Architecture has a required + an optional criterion; D2C/Problem has one
// required criterion.
function tree(): It4itElementFact[] {
  return [
    { id: "cg-s2p", kind: "capability_group", slug: "s2p", name: "Strategy to Portfolio", parentId: null, normativeClass: null, sourceReference: null },
    { id: "fn-s2p", kind: "function", slug: "fn-s2p", name: "Strategy Function", parentId: "cg-s2p", normativeClass: null, sourceReference: null },
    { id: "comp-ea", kind: "component", slug: "enterprise-architecture", name: "Enterprise Architecture", parentId: "fn-s2p", normativeClass: null, sourceReference: null },
    { id: "crit-ea-1", kind: "criterion", slug: "ea-1", name: "EA shall align to strategy", parentId: "comp-ea", normativeClass: "required", sourceReference: "6.1.1" },
    { id: "crit-ea-2", kind: "criterion", slug: "ea-2", name: "EA may publish a roadmap", parentId: "comp-ea", normativeClass: "optional", sourceReference: "6.1.2" },
    { id: "cg-d2c", kind: "capability_group", slug: "d2c", name: "Detect to Correct", parentId: null, normativeClass: null, sourceReference: null },
    { id: "fn-d2c", kind: "function", slug: "fn-d2c", name: "Detect Function", parentId: "cg-d2c", normativeClass: null, sourceReference: null },
    { id: "comp-problem", kind: "component", slug: "problem", name: "Problem", parentId: "fn-d2c", normativeClass: null, sourceReference: null },
    { id: "crit-problem-1", kind: "criterion", slug: "problem-1", name: "Problem shall track root cause", parentId: "comp-problem", normativeClass: "required", sourceReference: "8.3.1" },
  ];
}

function baseFacts(overrides: Partial<It4itCoverageFacts> = {}): It4itCoverageFacts {
  return {
    elements: tree(),
    agents: [
      { valueStream: "evaluate", it4itSections: ["6.1.1"] },
      { valueStream: "Strategy to Portfolio", it4itSections: [] }, // legacy -> evaluate -> S2P
      { valueStream: null, it4itSections: [] }, // hygiene: unset
    ],
    capabilities: [{ it4itValueStreams: ["evaluate"], hasBuiltTraceLink: true }],
    existingAssessments: [],
    ...overrides,
  };
}

describe("buildIt4itCoverageModel — derivation", () => {
  it("marks a component implemented when it has built capability + agent evidence", () => {
    const m = buildIt4itCoverageModel(baseFacts());
    const ea = m.components.find((c) => c.componentSlug === "enterprise-architecture")!;
    expect(ea.status).toBe("implemented");
    expect(ea.capabilityGroup).toBe("Strategy to Portfolio");
    expect(ea.score).toBe(100);
    expect(ea.evidence.agents).toBe(2); // evaluate + legacy "Strategy to Portfolio"
    expect(ea.evidence.capabilitiesWithBuilds).toBe(1);
    expect(ea.requiredCriteriaCount).toBe(1);
  });

  it("marks a component not_started with no evidence and records a gap", () => {
    const m = buildIt4itCoverageModel(baseFacts());
    const problem = m.components.find((c) => c.componentSlug === "problem")!;
    expect(problem.status).toBe("not_started");
    expect(problem.score).toBe(0);
    expect(m.gaps.map((g) => g.componentSlug)).toContain("problem");
  });

  it("derives partial from agent-only or capability-only evidence", () => {
    const agentOnly = buildIt4itCoverageModel(
      baseFacts({ capabilities: [], agents: [{ valueStream: "operate", it4itSections: [] }] }),
    );
    expect(agentOnly.components.find((c) => c.componentSlug === "problem")!.status).toBe("partial");

    const capOnly = buildIt4itCoverageModel(
      baseFacts({ agents: [], capabilities: [{ it4itValueStreams: ["operate"], hasBuiltTraceLink: false }] }),
    );
    expect(capOnly.components.find((c) => c.componentSlug === "problem")!.status).toBe("partial");
  });

  it("requires BOTH built capability and agent evidence for implemented (built without agents is partial)", () => {
    const m = buildIt4itCoverageModel(
      baseFacts({ agents: [], capabilities: [{ it4itValueStreams: ["evaluate"], hasBuiltTraceLink: true }] }),
    );
    expect(m.components.find((c) => c.componentSlug === "enterprise-architecture")!.status).toBe("partial");
  });

  it("elevates a no-evidence component to partial when an agent section matches its criteria", () => {
    // Agent cites section 8.3, which covers Problem's criterion 8.3.1.
    const m = buildIt4itCoverageModel(
      baseFacts({ agents: [{ valueStream: "cross-cutting", it4itSections: ["8.3"] }], capabilities: [] }),
    );
    const problem = m.components.find((c) => c.componentSlug === "problem")!;
    expect(problem.evidence.sectionMatches).toBeGreaterThan(0);
    expect(problem.status).toBe("partial");
  });
});

describe("buildIt4itCoverageModel — write plan + no-clobber", () => {
  it("writes a derived row for each component and inherited criteria", () => {
    const m = buildIt4itCoverageModel(baseFacts());
    // 2 components + 3 criteria = 5 rows.
    expect(m.writePlan).toHaveLength(5);
    for (const row of m.writePlan) {
      expect(row.confidence).toBe(DERIVED_CONFIDENCE);
      expect(row.rationale.startsWith(PROJECTION_RATIONALE_PREFIX)).toBe(true);
    }
    const eaCriterion = m.writePlan.find((r) => r.modelElementId === "crit-ea-1")!;
    expect(eaCriterion.coverageStatus).toBe("implemented"); // inherited from component
  });

  it("preserves verified operator rows and does not include them in the write plan", () => {
    const m = buildIt4itCoverageModel(
      baseFacts({
        existingAssessments: [
          { modelElementId: "comp-ea", coverageStatus: "implemented", confidence: "verified", rationale: "operator confirmed" },
        ],
      }),
    );
    expect(m.writePlan.find((r) => r.modelElementId === "comp-ea")).toBeUndefined();
    expect(m.preservedVerified).toBeGreaterThanOrEqual(1);
  });

  it("treats a non-derived, non-projection row as human-owned and preserves it", () => {
    const m = buildIt4itCoverageModel(
      baseFacts({
        existingAssessments: [
          { modelElementId: "comp-problem", coverageStatus: "planned", confidence: "high", rationale: "roadmap" },
        ],
      }),
    );
    expect(m.writePlan.find((r) => r.modelElementId === "comp-problem")).toBeUndefined();
  });

  it("re-derives (overwrites) its own derived rows", () => {
    const m = buildIt4itCoverageModel(
      baseFacts({
        existingAssessments: [
          { modelElementId: "comp-ea", coverageStatus: "not_started", confidence: DERIVED_CONFIDENCE, rationale: `${PROJECTION_RATIONALE_PREFIX} stale` },
        ],
      }),
    );
    const row = m.writePlan.find((r) => r.modelElementId === "comp-ea");
    expect(row).toBeDefined();
    expect(row!.coverageStatus).toBe("implemented");
  });
});

describe("buildIt4itCoverageModel — rollups, hygiene, determinism", () => {
  it("computes a weighted platform score over functional criteria", () => {
    const m = buildIt4itCoverageModel(baseFacts());
    // EA implemented: weight 2(required)+0.5(optional)=2.5, value 1 -> 2.5
    // Problem not_started: weight 2(required), value 0 -> 0
    // score = 2.5 / 4.5 = 56%
    expect(m.platformScore).toBe(56);
  });

  it("counts hygiene findings for legacy and unset agent streams", () => {
    const m = buildIt4itCoverageModel(baseFacts());
    expect(m.hygiene.legacyStreamAgents).toBe(1);
    expect(m.hygiene.nullStreamAgents).toBe(1);
    expect(m.hygiene.unknownStreamAgents).toBe(0);
  });

  it("reports honest summary counts", () => {
    const m = buildIt4itCoverageModel(baseFacts());
    expect(m.summary.componentsTotal).toBe(2);
    expect(m.summary.componentsWithEvidence).toBe(1);
    expect(m.summary.requiredCriteriaTotal).toBe(2);
    expect(m.summary.requiredCriteriaImplemented).toBe(1);
    expect(m.summary.requiredCriteriaNotStarted).toBe(1);
  });

  it("is deterministic for identical facts", () => {
    expect(buildIt4itCoverageModel(baseFacts())).toEqual(buildIt4itCoverageModel(baseFacts()));
  });
});
