import { describe, expect, it } from "vitest";

import {
  AnimalEvidenceError,
  ANIMAL_INTAKE_POLICY_VERSION,
  buildAnimalIntakeRequirementSnapshot,
  readAnimalIntakeRequirementSnapshot,
  validateAnimalEvidence,
} from "./intake-policy";

describe("animal intake requirement snapshot", () => {
  it("freezes every canonical requirement with its version", () => {
    const snapshot = buildAnimalIntakeRequirementSnapshot();
    expect(snapshot.policyVersion).toBe(ANIMAL_INTAKE_POLICY_VERSION);
    expect(snapshot.requirements.map((r) => r.key)).toEqual([
      "identity-check", "intake-examination", "weight-condition", "vaccination",
      "parasite-treatment", "sterilization", "behaviour-assessment", "housing",
    ]);
    expect(readAnimalIntakeRequirementSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it("refuses a patient-shaped or empty snapshot", () => {
    expect(() => readAnimalIntakeRequirementSnapshot([{ dynamicFormId: "f", linkId: "l" }])).toThrow(/Invalid animal intake/);
    expect(() => readAnimalIntakeRequirementSnapshot({ subjectKindSlug: "animal-profile", policyVersion: "v", requirements: [] })).toThrow();
    expect(() => readAnimalIntakeRequirementSnapshot(null)).toThrow();
  });
});

describe("validateAnimalEvidence", () => {
  const snapshot = buildAnimalIntakeRequirementSnapshot();

  it("accepts a sterilization procedure with provider, outcome and recovery window", () => {
    const result = validateAnimalEvidence({
      snapshot,
      requirementKey: "sterilization",
      kind: "procedure",
      detail: { provider: "Oak & Prairie Vets", outcome: "completed", recoveryUntil: "2026-09-20T00:00:00Z", costReference: "INV-12" },
    });
    expect(result.requirement.recoveryGoverned).toBe(true);
    expect(result.detail).toMatchObject({ requirementKey: "sterilization", outcome: "completed", costReference: "INV-12", complication: null });
  });

  it("rejects the legacy boolean as procedure proof", () => {
    expect(() => validateAnimalEvidence({ snapshot, requirementKey: "sterilization", kind: "procedure", detail: { spayed: true } }))
      .toThrow(AnimalEvidenceError);
  });

  it("rejects evidence recorded under the wrong record kind", () => {
    expect(() => validateAnimalEvidence({ snapshot, requirementKey: "vaccination", kind: "note", detail: { product: "DHPP", provider: "vet" } }))
      .toThrow(/cannot be evidenced by a note/);
  });

  it("requires a described complication", () => {
    expect(() => validateAnimalEvidence({ snapshot, requirementKey: "sterilization", kind: "procedure", detail: { provider: "vet", outcome: "complication" } }))
      .toThrow(/complication must be described/);
  });

  it("validates weight as a positive measurement with a unit", () => {
    expect(() => validateAnimalEvidence({ snapshot, requirementKey: "weight-condition", kind: "weight", value: "0", unit: "kg", detail: {} })).toThrow(/positive/);
    expect(validateAnimalEvidence({ snapshot, requirementKey: "weight-condition", kind: "weight", value: "12.4", unit: "kg", detail: { bodyConditionScore: 5 } }).detail)
      .toEqual({ requirementKey: "weight-condition", bodyConditionScore: 5 });
  });

  it("never lets a care record evidence housing", () => {
    expect(() => validateAnimalEvidence({ snapshot, requirementKey: "housing", kind: "note", detail: {} })).toThrow(/Housing/);
    expect(() => validateAnimalEvidence({ snapshot, requirementKey: "nope", kind: "note", detail: {} })).toThrow(/Unknown/);
  });
});
