import { describe, it, expect } from "vitest";
import {
  groundOptionFeatures,
  groundOptionsFromParams,
  buildScoredDecisionOptions,
  isAdmissibleGrade,
  type OptionEvidenceMap,
} from "./evidence-grounding";

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

describe("evidence-grounding — the feature handoff is positional (BI-9889566B)", () => {
  it("keeps each option's own features when two options share an id", async () => {
    // The failure this replaces: groundedFeatures was a Map keyed on the
    // caller-supplied id, so a shared id (including the "" every id-less
    // option collapsed to) meant one map won and every option was scored with
    // it — identical composites, no discrimination, no warning.
    const params = {
      options: [
        { id: "", description: "A", features: { reusability: 0.9 } },
        { id: "", description: "B", features: { reusability: 0.1 } },
      ],
    };
    const { groundedFeaturesByIndex } = groundOptionsFromParams(params);
    expect(groundedFeaturesByIndex).toEqual([{ reusability: 0.9 }, { reusability: 0.1 }]);

    const built = await buildScoredDecisionOptions({
      optionsParam: params.options,
      groundedFeaturesByIndex,
      generateEmbedding: async () => undefined,
    });
    expect(built.map((o) => o.features)).toEqual([
      { reusability: 0.9 },
      { reusability: 0.1 },
    ]);
  });

  it("stays aligned when a non-object entry sits between two real options", async () => {
    const optionsParam = [
      { id: "a", description: "A", features: { reusability: 0.9 } },
      null,
      { id: "b", description: "B", features: { reusability: 0.1 } },
    ];
    const { groundedFeaturesByIndex } = groundOptionsFromParams({ options: optionsParam });
    const built = await buildScoredDecisionOptions({
      optionsParam,
      groundedFeaturesByIndex,
      generateEmbedding: async () => undefined,
    });
    expect(built.map((o) => [o.id, o.features])).toEqual([
      ["a", { reusability: 0.9 }],
      ["b", { reusability: 0.1 }],
    ]);
  });
});
