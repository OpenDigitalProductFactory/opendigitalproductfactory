// BI-C5D978E9 — only attest to research that actually happened.

import { describe, expect, it } from "vitest";

import { describeResearchAttestation, designDocEvidencesResearch } from "./ideate-research-receipt";

describe("designDocEvidencesResearch", () => {
  it("recognises a design that audited what already exists", () => {
    expect(designDocEvidencesResearch({ existingFunctionalityAudit: "AdoptableAnimal already stores intakeDate." })).toBe(true);
  });

  it("accepts a reuse plan as evidence too", () => {
    expect(designDocEvidencesResearch({ reusePlan: ["reuse the storefront animal list query"] })).toBe(true);
  });

  // A design that skipped the audit has not done the research the gate asks
  // about; recording it would make the receipt a lie.
  it("refuses to attest when the design carries no research at all", () => {
    expect(designDocEvidencesResearch({ problemStatement: "Show waiting animals." })).toBe(false);
    expect(designDocEvidencesResearch({ existingFunctionalityAudit: "   " })).toBe(false);
    expect(designDocEvidencesResearch({ reusePlan: [] })).toBe(false);
    expect(designDocEvidencesResearch(null)).toBe(false);
    expect(designDocEvidencesResearch("a design")).toBe(false);
  });
});

describe("describeResearchAttestation", () => {
  it("names the sections it is attesting to", () => {
    const reason = describeResearchAttestation({
      existingFunctionalityAudit: "audited",
      reusePlan: ["reuse"],
    });
    expect(reason).toContain("existingFunctionalityAudit and reusePlan");
  });

  // The receipt must not overclaim: it covers research only.
  it("states plainly what it does not cover", () => {
    const reason = describeResearchAttestation({ existingFunctionalityAudit: "audited" });
    expect(reason).toContain("author-accountable");
    expect(reason).toContain("Spec approval and architecture review are independent");
  });
});
