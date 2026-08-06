import { describe, it, expect } from "vitest";
import { groundOptionFeatures, isAdmissibleGrade, type OptionEvidenceMap } from "./evidence-grounding";

const codeLocator = { sourceType: "code", filePath: "resume.txt", line: 12 };

describe("evidence-grounding", () => {
  it("D grade is inadmissible; A/B/C admissible", () => {
    expect(isAdmissibleGrade("A")).toBe(true);
    expect(isAdmissibleGrade("C")).toBe(true);
    expect(isAdmissibleGrade("D")).toBe(false);
  });

  it("default mode (no requireEvidence) leaves scoring identical and still collects citations", () => {
    const evidence: OptionEvidenceMap = {
      cand: { skill_match: [{ locator: codeLocator, grade: "A", excerpt: "10y Rust" }] },
    };
    const r = groundOptionFeatures({
      options: [{ id: "cand", description: "candidate", features: { skill_match: 0.8, culture: 0.5 } }],
      evidence,
    });
    // both features kept (unevidenced not stripped in advisory mode)
    expect(r.options[0].features).toEqual({ skill_match: 0.8, culture: 0.5 });
    expect(r.enforced).toBe(false);
    // citation for the evidenced axis collected
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0]).toMatchObject({ optionId: "cand", dimensionKey: "skill_match", grade: "A" });
    // the unevidenced one is reported as dropped-metadata even in advisory mode
    expect(r.dropped).toEqual([{ optionId: "cand", dimensionKey: "culture", reason: "no-evidence" }]);
  });

  it("requireEvidence strips a feature with no admissible citation (does not count)", () => {
    const evidence: OptionEvidenceMap = {
      cand: { skill_match: [{ locator: codeLocator, grade: "A", excerpt: "10y Rust" }] },
    };
    const r = groundOptionFeatures({
      options: [{ id: "cand", description: "candidate", features: { skill_match: 0.8, culture: 0.5 } }],
      evidence,
      requireEvidence: true,
    });
    expect(r.enforced).toBe(true);
    // unevidenced `culture` is GONE — decide() will treat it as a missingDimension
    expect(r.options[0].features).toEqual({ skill_match: 0.8 });
    expect(r.dropped).toEqual([{ optionId: "cand", dimensionKey: "culture", reason: "no-evidence" }]);
  });

  it("requireEvidence drops a D-grade (model-memory) citation as inadmissible", () => {
    const evidence: OptionEvidenceMap = {
      cand: { skill_match: [{ locator: codeLocator, grade: "D", excerpt: "I think so" }] },
    };
    const r = groundOptionFeatures({
      options: [{ id: "cand", description: "c", features: { skill_match: 0.8 } }],
      evidence,
      requireEvidence: true,
    });
    expect(r.options[0].features).toEqual({});
    expect(r.dropped[0].reason).toBe("inadmissible-grade");
  });

  it("requireEvidence drops an unresolvable locator", () => {
    const evidence: OptionEvidenceMap = {
      cand: { skill_match: [{ locator: { sourceType: "not-a-type" }, grade: "A" }] },
    };
    const r = groundOptionFeatures({
      options: [{ id: "cand", description: "c", features: { skill_match: 0.8 } }],
      evidence,
      requireEvidence: true,
    });
    expect(r.options[0].features).toEqual({});
    expect(r.dropped[0].reason).toBe("unresolvable-locator");
  });

  it("produces per-(option,dimension) evidence digests for the chain payload", () => {
    const evidence: OptionEvidenceMap = {
      cand: { skill_match: [{ locator: codeLocator, grade: "A" }] },
    };
    const r = groundOptionFeatures({
      options: [{ id: "cand", description: "c", features: { skill_match: 0.8 } }],
      evidence,
    });
    expect(typeof r.evidenceDigests.cand.skill_match).toBe("string");
    expect(r.evidenceDigests.cand.skill_match).toHaveLength(16);
  });
});
