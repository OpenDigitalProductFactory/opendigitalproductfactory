// BI-C5D978E9 follow-up — the research receipt was written in exactly one
// place: saveBuildEvidence with field "designDoc". A build whose design document
// was saved by any other path, or before that writer shipped, could never obtain
// the receipt. The reviewer passed, RESEARCH_REQUIRED blocked ideate->plan, the
// stranded-build resumer re-ran the same review, and the build aged out at seven
// days.
//
// Live repro FB-7B4C714B: governed subject BI-CA7C0C48, existingFunctionalityAudit
// 4394 chars, reusePlan 1677 chars, reviewDesignDoc = pass, zero
// initiative_gate_receipt rows. One of 45 abandoned builds, all dying at the same
// gate.
//
// These assertions pin the rule the review path now depends on: a design that
// evidences research is attestable, and one that does not is still refused.
import { describe, it, expect } from "vitest";
import {
  designDocEvidencesResearch,
  describeResearchAttestation,
} from "./ideate-research-receipt";

describe("ideate research attestation at review time (BI-C5D978E9 follow-up)", () => {
  it("attests the shape FB-7B4C714B actually had", () => {
    // The exact fields and non-trivial content the stranded build carried.
    const doc = {
      existingFunctionalityAudit: "x".repeat(4394),
      reusePlan: "y".repeat(1677),
      problemStatement: "Workrooms render as outcome-less finite rooms",
    };
    expect(designDocEvidencesResearch(doc)).toBe(true);
    const reason = describeResearchAttestation(doc);
    // The receipt must name what it examined, or it is not evidence.
    expect(reason).toContain("existingFunctionalityAudit");
    expect(reason).toContain("reusePlan");
  });

  it("attests when either research field alone is present", () => {
    expect(designDocEvidencesResearch({ existingFunctionalityAudit: "audited" })).toBe(true);
    expect(designDocEvidencesResearch({ reusePlan: "reused" })).toBe(true);
  });

  it("refuses to attest a design that records no research", () => {
    // The truthfulness guard: review passing must NOT manufacture a receipt.
    expect(designDocEvidencesResearch({ problemStatement: "something" })).toBe(false);
    expect(designDocEvidencesResearch({ existingFunctionalityAudit: "   " })).toBe(false);
    expect(designDocEvidencesResearch({ existingFunctionalityAudit: "" })).toBe(false);
    expect(designDocEvidencesResearch({})).toBe(false);
  });

  it("refuses non-object designs rather than throwing", () => {
    for (const bad of [null, undefined, "a string", 42, ["array"]]) {
      expect(designDocEvidencesResearch(bad)).toBe(false);
    }
  });

  it("scopes the attestation to the author-accountable lane only", () => {
    const reason = describeResearchAttestation({ reusePlan: "reused" });
    // Spec approval and architecture review stay independent and still block.
    expect(reason).toContain("independent: false");
    expect(reason).toMatch(/not\s+covered by this receipt/);
  });
});
