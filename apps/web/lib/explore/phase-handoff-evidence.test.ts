import { describe, expect, it } from "vitest";
import { buildPhaseHandoffEvidence } from "./feature-build-types";

describe("buildPhaseHandoffEvidence", () => {
  it("returns an empty manifest for an all-null/undefined build", () => {
    const out = buildPhaseHandoffEvidence({
      designDoc: null,
      designReview: null,
      buildPlan: undefined,
      planReview: null,
      verificationOut: null,
      acceptanceMet: null,
      uxTestResults: null,
      uxVerificationStatus: null,
    });
    expect(out).toEqual({ evidenceFields: [], evidenceDigest: {} });
  });

  it("omits empty strings, empty objects, and empty arrays (absence is the marker)", () => {
    const out = buildPhaseHandoffEvidence({
      designDoc: "   ",
      designReview: {},
      buildPlan: [],
      planReview: "",
    });
    expect(out.evidenceFields).toEqual([]);
    expect(out.evidenceDigest).toEqual({});
  });

  it("summarizes a string status field verbatim", () => {
    const out = buildPhaseHandoffEvidence({ uxVerificationStatus: "complete" });
    expect(out.evidenceFields).toEqual(["uxVerificationStatus"]);
    expect(out.evidenceDigest.uxVerificationStatus).toBe("complete");
  });

  it("renders a boolean acceptanceMet as yes/no", () => {
    expect(buildPhaseHandoffEvidence({ acceptanceMet: true }).evidenceDigest.acceptanceMet).toBe("yes");
    expect(buildPhaseHandoffEvidence({ acceptanceMet: false }).evidenceDigest.acceptanceMet).toBe("no");
  });

  it("extracts the first verdict-like key from a review object", () => {
    const out = buildPhaseHandoffEvidence({
      designReview: { verdict: "approved", issues: ["x"] },
      planReview: { decision: "needs-work" },
      verificationOut: { passed: true },
    });
    expect(out.evidenceDigest.designReview).toBe("verdict: approved");
    expect(out.evidenceDigest.planReview).toBe("decision: needs-work");
    expect(out.evidenceDigest.verificationOut).toBe("passed: yes");
  });

  it("falls back to a key census for objects with no verdict-like key", () => {
    const out = buildPhaseHandoffEvidence({ buildPlan: { tasks: [], steps: 3 } });
    expect(out.evidenceDigest.buildPlan).toMatch(/^present \(2 fields: tasks, steps\)$/);
  });

  it("collapses whitespace and truncates long strings to the one-liner cap", () => {
    const out = buildPhaseHandoffEvidence({ designDoc: "a ".repeat(200) });
    expect(out.evidenceDigest.designDoc.length).toBeLessThanOrEqual(140);
    expect(out.evidenceDigest.designDoc.endsWith("…")).toBe(true);
  });

  it("summarizes arrays by length", () => {
    const out = buildPhaseHandoffEvidence({ uxTestResults: [{ step: 1 }, { step: 2 }] });
    expect(out.evidenceDigest.uxTestResults).toBe("2 items");
  });

  it("preserves the declared field render order", () => {
    const out = buildPhaseHandoffEvidence({
      uxVerificationStatus: "complete",
      designDoc: { title: "X" },
      verificationOut: { passed: true },
    });
    expect(out.evidenceFields).toEqual(["designDoc", "verificationOut", "uxVerificationStatus"]);
  });

  it("produces a Record<string,string> the consumer can render", () => {
    const out = buildPhaseHandoffEvidence({ designReview: { verdict: "approved" } });
    for (const [k, v] of Object.entries(out.evidenceDigest)) {
      expect(typeof k).toBe("string");
      expect(typeof v).toBe("string");
    }
  });
});
