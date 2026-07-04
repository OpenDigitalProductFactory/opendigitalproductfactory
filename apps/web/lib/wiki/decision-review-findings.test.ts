import { describe, it, expect } from "vitest";

import {
  buildReviewFindings,
  buildConflictFindings,
  buildGapFindings,
  type ConflictRow,
  type GapCluster,
} from "./decision-review-findings";

const conflict: ConflictRow = {
  interactionId: "DI-ABC123",
  question: "Should refunds over $500 need a manager sign-off?",
  riskTier: "high",
  createdAt: new Date("2026-07-01T00:00:00Z"),
};

const gap: GapCluster = {
  domainClass: "vendor-selection",
  count: 9,
  sampleQuestion: "Which observability vendor should we standardize on?",
};

describe("buildConflictFindings", () => {
  it("maps each conflicted decision to a canvas-linked finding with risk posture", () => {
    const [f] = buildConflictFindings([conflict]);
    expect(f.findingClass).toBe("conflict");
    expect(f.postureLabel).toBe("risk: high");
    expect(f.href).toBe("/platform/ai/decisions/DI-ABC123");
    expect(f.actionLabel).toBe("De-conflict");
    expect(f.count).toBe(1);
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
    expect(f.actionLabel).toBe("Add a stance");
    expect(f.actionHref).toBe("/wiki/stance");
  });

  it("drops empty clusters and singularizes a lone unresolved", () => {
    const findings = buildGapFindings([
      { ...gap, count: 0 },
      { domainClass: "pricing", count: 1, sampleQuestion: "q" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].postureLabel).toBe("1 unresolved");
  });
});

describe("buildReviewFindings", () => {
  it("orders conflicts first, then gaps by descending cluster size", () => {
    const findings = buildReviewFindings({
      conflicts: [conflict],
      gapClusters: [
        { domainClass: "small", count: 2, sampleQuestion: "q" },
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
});
