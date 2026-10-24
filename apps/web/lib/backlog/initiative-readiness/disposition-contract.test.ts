import { describe, expect, it } from "vitest";
import { findingEvidenceMatchesRead, validateInitiativeDisposition } from "./disposition-contract";

describe("canonical initiative disposition", () => {
  it("rejects new findings on pass while preserving existing finding resolutions", () => {
    expect(validateInitiativeDisposition("pass", [], [])).toBeNull();
    expect(validateInitiativeDisposition("pass", ["Positive observation"], [])).not.toBeNull();
    expect(validateInitiativeDisposition("pass", [], ["IF-open"])).toBeNull();
  });
  it("allows findings only with fail", () => {
    expect(validateInitiativeDisposition("fail", ["Missing test"], [])).toBeNull();
    expect(validateInitiativeDisposition("not-applicable", ["Missing test"], [])).not.toBeNull();
  });
  const page = { blobId: "blob", startLine: 10, endLine: 12,
    content: "## Existing substrate and ownership boundary\nBI-6CB35411 is a conditional hard prerequisite.\nIts source paths are excluded." };
  const evidence = { blobId: "blob", startLine: 11, endLine: 11, quote: "BI-6CB35411 is a conditional hard prerequisite." };
  it("accepts exact immutable line evidence", () => {
    expect(findingEvidenceMatchesRead(evidence, page, "blob")).toBe(true);
  });
  it.each([
    { ...evidence, blobId: "other" },
    { ...evidence, startLine: 9 },
    { ...evidence, endLine: 13 },
    { ...evidence, quote: "BI-6CB35411 is not a prerequisite." },
    { ...evidence, startLine: 12, endLine: 12 },
  ])("rejects mismatched or contradicted citation %j", (candidate) => {
    expect(findingEvidenceMatchesRead(candidate, page, "blob")).toBe(false);
  });
});
