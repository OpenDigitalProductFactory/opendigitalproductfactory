import { describe, it, expect } from "vitest";
import {
  shapeIt4itCoverageHeatmap,
  it4itCoverageStatus,
  parseEvidenceScore,
  type It4itElementRow,
  type It4itAssessmentRow,
} from "./it4it-coverage-view";

const NOW = new Date("2026-06-25T00:00:00Z");

function elements(): It4itElementRow[] {
  return [
    { id: "cg-s2p", parentId: null, kind: "capability_group", name: "Strategy to Portfolio", normativeClass: null, sourceReference: null },
    { id: "fn-s2p", parentId: "cg-s2p", kind: "function", name: "Strategy Function", normativeClass: null, sourceReference: null },
    { id: "ea", parentId: "fn-s2p", kind: "component", name: "Enterprise Architecture", normativeClass: null, sourceReference: null },
    { id: "ea-1", parentId: "ea", kind: "criterion", name: "shall align", normativeClass: "required", sourceReference: "6.1.1" },
    { id: "ea-2", parentId: "ea", kind: "criterion", name: "may publish", normativeClass: "optional", sourceReference: "6.1.2" },
    { id: "cg-d2c", parentId: null, kind: "capability_group", name: "Detect to Correct", normativeClass: null, sourceReference: null },
    { id: "fn-d2c", parentId: "cg-d2c", kind: "function", name: "Detect Function", normativeClass: null, sourceReference: null },
    { id: "pr", parentId: "fn-d2c", kind: "component", name: "Problem", normativeClass: null, sourceReference: null },
    { id: "pr-1", parentId: "pr", kind: "criterion", name: "shall track", normativeClass: "required", sourceReference: "8.3.1" },
  ];
}

function assessments(): It4itAssessmentRow[] {
  return [
    { modelElementId: "ea", coverageStatus: "implemented", confidence: "derived", evidenceSummary: JSON.stringify({ evidenceScore: 100 }), updatedAt: NOW },
    { modelElementId: "ea-1", coverageStatus: "implemented", confidence: "derived", evidenceSummary: null, updatedAt: NOW },
    { modelElementId: "ea-2", coverageStatus: "implemented", confidence: "derived", evidenceSummary: null, updatedAt: NOW },
    { modelElementId: "pr", coverageStatus: "partial", confidence: "verified", evidenceSummary: JSON.stringify({ evidenceScore: 50 }), updatedAt: NOW },
    { modelElementId: "pr-1", coverageStatus: "partial", confidence: "derived", evidenceSummary: null, updatedAt: NOW },
  ];
}

describe("it4itCoverageStatus", () => {
  it("passes through valid statuses and defaults unknown to not_started", () => {
    expect(it4itCoverageStatus("implemented")).toBe("implemented");
    expect(it4itCoverageStatus("out_of_mvp")).toBe("out_of_mvp");
    expect(it4itCoverageStatus(null)).toBe("not_started");
    expect(it4itCoverageStatus("garbage")).toBe("not_started");
  });
});

describe("parseEvidenceScore", () => {
  it("reads evidenceScore from JSON, tolerates null/garbage", () => {
    expect(parseEvidenceScore(JSON.stringify({ evidenceScore: 65 }))).toBe(65);
    expect(parseEvidenceScore(null)).toBeNull();
    expect(parseEvidenceScore("not json")).toBeNull();
    expect(parseEvidenceScore(JSON.stringify({ other: 1 }))).toBeNull();
  });
});

describe("shapeIt4itCoverageHeatmap", () => {
  it("renders an empty state when there are no assessments", () => {
    const m = shapeIt4itCoverageHeatmap({ slug: "it4it_v3_0_1", modelName: "IT4IT", elements: elements(), assessments: [] });
    expect(m.hasData).toBe(false);
    expect(m.assessmentCount).toBe(0);
    expect(m.platformScore).toBe(0);
    // components still enumerated, all not_started
    expect(m.summary.componentsTotal).toBe(2);
    expect(m.summary.componentsWithEvidence).toBe(0);
  });

  it("groups components by capability group in canonical order", () => {
    const m = shapeIt4itCoverageHeatmap({ slug: "it4it_v3_0_1", modelName: "IT4IT", elements: elements(), assessments: assessments() });
    expect(m.hasData).toBe(true);
    expect(m.groups.map((g) => g.group)).toEqual(["Strategy to Portfolio", "Detect to Correct"]);
  });

  it("derives component status, score, and confidence from assessments", () => {
    const m = shapeIt4itCoverageHeatmap({ slug: "it4it_v3_0_1", modelName: "IT4IT", elements: elements(), assessments: assessments() });
    const ea = m.groups.flatMap((g) => g.components).find((c) => c.id === "ea")!;
    expect(ea.status).toBe("implemented");
    expect(ea.score).toBe(100);
    expect(ea.criteriaCount).toBe(2);
    expect(ea.requiredCriteriaCount).toBe(1);
    const pr = m.groups.flatMap((g) => g.components).find((c) => c.id === "pr")!;
    expect(pr.status).toBe("partial");
    expect(pr.confidence).toBe("verified");
  });

  it("computes a status-weighted platform score over functional criteria", () => {
    const m = shapeIt4itCoverageHeatmap({ slug: "it4it_v3_0_1", modelName: "IT4IT", elements: elements(), assessments: assessments() });
    // EA implemented(1.0) weight 2(req)+0.5(opt)=2.5 -> 2.5; Problem partial(0.5) weight 2 -> 1.0
    // score = 3.5 / 4.5 = 78%
    expect(m.platformScore).toBe(78);
  });

  it("counts verified assessments and honest summary totals", () => {
    const m = shapeIt4itCoverageHeatmap({ slug: "it4it_v3_0_1", modelName: "IT4IT", elements: elements(), assessments: assessments() });
    expect(m.summary.implemented).toBe(1);
    expect(m.summary.partial).toBe(1);
    expect(m.summary.requiredCriteriaTotal).toBe(2);
    expect(m.summary.requiredCriteriaImplemented).toBe(1);
    expect(m.summary.requiredCriteriaPartial).toBe(1);
    expect(m.summary.verifiedCount).toBe(1); // Problem component is verified
    expect(m.generatedAt).toBe(NOW.toISOString());
  });

  it("falls back to a status-derived score when evidenceScore is absent", () => {
    const a: It4itAssessmentRow[] = [
      { modelElementId: "ea", coverageStatus: "implemented", confidence: "derived", evidenceSummary: null, updatedAt: NOW },
    ];
    const m = shapeIt4itCoverageHeatmap({ slug: "it4it_v3_0_1", modelName: "IT4IT", elements: elements(), assessments: a });
    const ea = m.groups.flatMap((g) => g.components).find((c) => c.id === "ea")!;
    expect(ea.score).toBe(100); // fallback for implemented
  });
});
