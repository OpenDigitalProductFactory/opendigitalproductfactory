import { describe, it, expect } from "vitest";

import {
  buildReviewFindings,
  buildConflictFindings,
  buildGapFindings,
  buildDriftFindings,
  type ConflictRow,
  type DriftRow,
  type GapCluster,
} from "./decision-review-findings";

const flipRow: DriftRow = {
  scenarioId: "quick-vs-proper-normal",
  rationale: "The kernel must prefer the proper fix.",
  expectedWinner: "proper-seed-fix",
  actualWinner: "quick-runtime-patch",
  margin: 0.42,
  marginFloor: 0.3,
  driftKind: "flip",
};

const thinRow: DriftRow = {
  scenarioId: "cheap-sound-vs-rebuild-guard",
  rationale: "Anti-maximalism guard.",
  expectedWinner: "cheap-sound-additive",
  actualWinner: "cheap-sound-additive",
  margin: 0.04,
  marginFloor: 0.1,
  driftKind: "thin-margin",
};

const conflict: ConflictRow = {
  interactionId: "DI-ABC123",
  question: "Should refunds over $500 need a manager sign-off?",
  riskTier: "high",
  createdAt: new Date("2026-07-01T00:00:00Z"),
  humanOutcome: null,
  buildId: "FB-1",
  taskRunId: null,
  routeContext: "/build",
  domainClass: "risk-assessment",
  gateKey: "founder",
};

const gap: GapCluster = {
  domainClass: "vendor-selection",
  count: 9,
  sampleQuestion: "Which observability vendor should we standardize on?",
  scope: "kernel",
};

describe("buildConflictFindings", () => {
  it("maps an open, actionable conflict to the canonical decision record", () => {
    const [f] = buildConflictFindings([conflict]);
    expect(f.findingClass).toBe("conflict");
    expect(f.postureLabel).toBe("risk: high");
    expect(f.detailHref).toBe("/coworker-decisions/decisions/DI-ABC123");
    expect(f.action).toEqual({
      kind: "navigate",
      label: "Review blocked decision",
      href: "/coworker-decisions/decisions/DI-ABC123",
      outcome: "Understand the rule conflict and continue in the workflow that owns the decision.",
    });
    expect(f.count).toBe(1);
  });

  it("does not manufacture operator work from resolved or context-free audit rows", () => {
    const findings = buildConflictFindings([
      { ...conflict, interactionId: "DI-RESOLVED", humanOutcome: { answer: "done" } },
      { ...conflict, interactionId: "DI-BLANK", question: "   " },
      {
        ...conflict,
        interactionId: "DI-INTERNAL",
        buildId: null,
        routeContext: "mcp:principle_decide",
        domainClass: "kernel-consult",
      },
      conflict,
    ]);
    expect(findings.map((finding) => finding.id)).toEqual(["conflict:DI-ABC123"]);
  });

  it("omits posture when the risk tier is unknown", () => {
    const [f] = buildConflictFindings([{ ...conflict, riskTier: null }]);
    expect(f.postureLabel).toBeNull();
  });
});

describe("buildGapFindings", () => {
  it("humanizes the domain and pluralizes the unresolved count", () => {
    const [f] = buildGapFindings([gap]);
    expect(f.title).toBe("No settled answer for vendor selection");
    expect(f.postureLabel).toBe("9 unresolved");
    expect(f.action?.label).toBe("Add a stance");
    expect(f.action?.href).toBe("/coworker-decisions/stance");
    expect(f.action?.outcome).toContain("settled guidance");
  });

  it("drops empty clusters and singularizes a lone unresolved", () => {
    const findings = buildGapFindings([
      { ...gap, count: 0 },
      { domainClass: "pricing", count: 1, sampleQuestion: "q", scope: "kernel" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].postureLabel).toBe("1 unresolved");
  });

  it("makes an org-scoped gap answerable inline instead of routing to the stance editor", () => {
    const [f] = buildGapFindings([
      {
        domainClass: "risk-assessment",
        count: 3,
        sampleQuestion: "Should we waive a lapsed fee after our own billing error?",
        scope: "org",
      },
    ]);
    expect(f.title).toBe("Your business hasn't weighed in on risk assessment");
    expect(f.action).toBeUndefined();
    expect(f.answer).toEqual({
      domainClass: "risk-assessment",
      question: "Should we waive a lapsed fee after our own billing error?",
    });
  });

  it("leaves kernel/WWMD gaps pointing at the manual stance editor", () => {
    const [f] = buildGapFindings([gap]);
    expect(f.answer).toBeUndefined();
    expect(f.action?.href).toBe("/coworker-decisions/stance");
  });
});

describe("buildReviewFindings", () => {
  it("orders conflicts first, then gaps by descending cluster size", () => {
    const findings = buildReviewFindings({
      conflicts: [conflict],
      gapClusters: [
        { domainClass: "small", count: 2, sampleQuestion: "q", scope: "kernel" },
        gap, // count 9
      ],
    });
    expect(findings.map((f) => f.findingClass)).toEqual(["conflict", "gap", "gap"]);
    // biggest gap cluster (9) before the smaller (2)
    expect(findings[1].id).toBe("gap:vendor-selection");
    expect(findings[2].id).toBe("gap:small");
  });

  it("truncates a very long question into the detail line", () => {
    const long = "x".repeat(200);
    const [f] = buildReviewFindings({
      conflicts: [{ ...conflict, question: long }],
      gapClusters: [],
    });
    expect(f.detail.length).toBeLessThanOrEqual(120);
    expect(f.detail.endsWith("…")).toBe(true);
  });

  it("builds a flip drift finding that names old and new winners and routes to the matrix", () => {
    const [f] = buildDriftFindings([flipRow]);
    expect(f.findingClass).toBe("drift");
    expect(f.title).toContain("flipped");
    expect(f.detail).toContain("proper seed fix");
    expect(f.detail).toContain("quick runtime patch");
    expect(f.action?.href).toBe("/coworker-decisions/matrix");
    expect(f.postureLabel).toBe("margin 0.42");
  });

  it("builds a thin-margin drift finding phrased as a coin-flip", () => {
    const [f] = buildDriftFindings([thinRow]);
    expect(f.title).toContain("coin-flip");
    expect(f.detail).toContain("near-tied");
  });

  it("orders drift after conflicts and before gaps", () => {
    const findings = buildReviewFindings({
      conflicts: [conflict],
      drift: [flipRow],
      gapClusters: [gap],
    });
    expect(findings.map((f) => f.findingClass)).toEqual([
      "conflict",
      "drift",
      "gap",
    ]);
  });
});
