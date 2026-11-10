/**
 * Versioned intake requirements for the pet-rescue activation profile
 * (BI-7111AF0C, design 2026-09-04 "Requirement and evidence contract").
 *
 * A requirement is satisfied by typed CareRecord evidence, never by a boolean
 * on the public listing. The snapshot frozen onto a CareIntakePacket at intake
 * carries these keys so a later policy change never re-judges an old intake.
 */

import type { CareRecordKind } from "./care";

export const ANIMAL_INTAKE_POLICY_VERSION = "pet-rescue-intake.v1";
export const ANIMAL_SUBJECT_KIND = "animal-profile" as const;

export type AnimalIntakeRequirementKey =
  | "identity-check"
  | "intake-examination"
  | "weight-condition"
  | "vaccination"
  | "parasite-treatment"
  | "sterilization"
  | "behaviour-assessment"
  | "housing";

export interface AnimalIntakeRequirement {
  key: AnimalIntakeRequirementKey;
  label: string;
  /** Which CareRecord kinds can evidence this requirement; `housing` has none. */
  evidenceKinds: readonly CareRecordKind[];
  required: boolean;
  /** A procedure with recovery blocks readiness until the window elapses. */
  recoveryGoverned: boolean;
}

export interface AnimalIntakeRequirementSnapshot {
  policyVersion: typeof ANIMAL_INTAKE_POLICY_VERSION;
  subjectKindSlug: typeof ANIMAL_SUBJECT_KIND;
  requirements: AnimalIntakeRequirement[];
}

export const ANIMAL_INTAKE_REQUIREMENTS: readonly AnimalIntakeRequirement[] = [
  { key: "identity-check", label: "Identity and microchip check", evidenceKinds: ["observation"], required: true, recoveryGoverned: false },
  { key: "intake-examination", label: "Intake examination", evidenceKinds: ["observation"], required: true, recoveryGoverned: false },
  { key: "weight-condition", label: "Weight and body condition", evidenceKinds: ["weight"], required: true, recoveryGoverned: false },
  { key: "vaccination", label: "Vaccination", evidenceKinds: ["vaccination"], required: true, recoveryGoverned: false },
  { key: "parasite-treatment", label: "Parasite treatment", evidenceKinds: ["medication"], required: true, recoveryGoverned: false },
  { key: "sterilization", label: "Sterilization", evidenceKinds: ["procedure"], required: true, recoveryGoverned: true },
  { key: "behaviour-assessment", label: "Behaviour assessment", evidenceKinds: ["behavior"], required: true, recoveryGoverned: false },
  { key: "housing", label: "Housing", evidenceKinds: [], required: true, recoveryGoverned: false },
];

export function buildAnimalIntakeRequirementSnapshot(): AnimalIntakeRequirementSnapshot {
  return {
    policyVersion: ANIMAL_INTAKE_POLICY_VERSION,
    subjectKindSlug: ANIMAL_SUBJECT_KIND,
    requirements: ANIMAL_INTAKE_REQUIREMENTS.map((requirement) => ({ ...requirement })),
  };
}

/** Reads a stored snapshot; refuses anything that is not an animal snapshot. */
export function readAnimalIntakeRequirementSnapshot(value: unknown): AnimalIntakeRequirementSnapshot {
  const snapshot = value as Partial<AnimalIntakeRequirementSnapshot> | null;
  if (
    !snapshot
    || typeof snapshot !== "object"
    || snapshot.subjectKindSlug !== ANIMAL_SUBJECT_KIND
    || typeof snapshot.policyVersion !== "string"
    || !Array.isArray(snapshot.requirements)
    || snapshot.requirements.length === 0
  ) {
    throw new Error("Invalid animal intake requirement snapshot");
  }
  for (const requirement of snapshot.requirements) {
    if (
      !requirement
      || typeof requirement.key !== "string"
      || typeof requirement.label !== "string"
      || !Array.isArray(requirement.evidenceKinds)
      || typeof requirement.required !== "boolean"
      || typeof requirement.recoveryGoverned !== "boolean"
    ) {
      throw new Error("Invalid animal intake requirement snapshot");
    }
  }
  return snapshot as AnimalIntakeRequirementSnapshot;
}

// ─── Typed evidence ─────────────────────────────────────────────────────────

/** The detail JSON an animal CareRecord must carry to evidence a requirement. */
export type AnimalEvidenceDetail =
  | { requirementKey: "identity-check"; microchipScanned: boolean; microchipNumber?: string | null; provider: string }
  | { requirementKey: "intake-examination"; provider: string; findings: string }
  | { requirementKey: "weight-condition"; bodyConditionScore?: number | null }
  | { requirementKey: "vaccination"; product: string; provider: string; nextDueAt?: string | null }
  | { requirementKey: "parasite-treatment"; product: string; provider: string; outcome: string }
  | {
      requirementKey: "sterilization";
      provider: string;
      outcome: "completed" | "complication" | "previously-verified";
      recoveryUntil?: string | null;
      costReference?: string | null;
      complication?: string | null;
    }
  | { requirementKey: "behaviour-assessment"; provider: string; outcome: string };

export class AnimalEvidenceError extends Error {
  constructor(public readonly code: "invalid_input" | "unknown_requirement" | "wrong_kind", message: string) {
    super(message);
    this.name = "AnimalEvidenceError";
  }
}

const text = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const optionalIso = (value: unknown) =>
  value == null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));

/**
 * Validates the (kind, value/unit, detail) triple for one requirement and
 * returns the normalized detail. Every shape carries the provider/date facts
 * the design calls out: a bare `spayed: true` is never accepted.
 */
export function validateAnimalEvidence(input: {
  snapshot: AnimalIntakeRequirementSnapshot;
  requirementKey: string;
  kind: CareRecordKind;
  value?: string | null;
  unit?: string | null;
  detail: unknown;
}): { requirement: AnimalIntakeRequirement; detail: AnimalEvidenceDetail } {
  const requirement = input.snapshot.requirements.find((entry) => entry.key === input.requirementKey);
  if (!requirement) throw new AnimalEvidenceError("unknown_requirement", `Unknown intake requirement: ${input.requirementKey}`);
  if (!requirement.evidenceKinds.includes(input.kind)) {
    throw new AnimalEvidenceError("wrong_kind", `${requirement.label} cannot be evidenced by a ${input.kind} record.`);
  }
  const d = (input.detail ?? {}) as Record<string, unknown>;
  const fail = (message: string) => new AnimalEvidenceError("invalid_input", message);
  switch (requirement.key) {
    case "identity-check":
      if (typeof d.microchipScanned !== "boolean" || !text(d.provider)) throw fail("Identity check needs microchipScanned and the person who checked.");
      return { requirement, detail: { requirementKey: "identity-check", microchipScanned: d.microchipScanned, microchipNumber: typeof d.microchipNumber === "string" ? d.microchipNumber : null, provider: String(d.provider) } };
    case "intake-examination":
      if (!text(d.provider) || !text(d.findings)) throw fail("Intake examination needs the examiner and findings.");
      return { requirement, detail: { requirementKey: "intake-examination", provider: String(d.provider), findings: String(d.findings) } };
    case "weight-condition": {
      const weight = Number(input.value);
      if (!Number.isFinite(weight) || weight <= 0 || !text(input.unit)) throw fail("Weight needs a positive value and a unit.");
      const bcs = d.bodyConditionScore;
      if (bcs != null && (typeof bcs !== "number" || bcs < 1 || bcs > 9)) throw fail("Body condition score is 1 to 9.");
      return { requirement, detail: { requirementKey: "weight-condition", bodyConditionScore: typeof bcs === "number" ? bcs : null } };
    }
    case "vaccination":
      if (!text(d.product) || !text(d.provider) || !optionalIso(d.nextDueAt)) throw fail("Vaccination needs the product, who gave it, and an optional due date.");
      return { requirement, detail: { requirementKey: "vaccination", product: String(d.product), provider: String(d.provider), nextDueAt: (d.nextDueAt as string | null | undefined) ?? null } };
    case "parasite-treatment":
      if (!text(d.product) || !text(d.provider) || !text(d.outcome)) throw fail("Parasite treatment needs the product, who gave it, and the outcome.");
      return { requirement, detail: { requirementKey: "parasite-treatment", product: String(d.product), provider: String(d.provider), outcome: String(d.outcome) } };
    case "sterilization": {
      const outcome = d.outcome;
      if (!text(d.provider) || (outcome !== "completed" && outcome !== "complication" && outcome !== "previously-verified")) {
        throw fail("Sterilization needs the veterinary provider and an outcome of completed, complication, or previously-verified.");
      }
      if (!optionalIso(d.recoveryUntil)) throw fail("Recovery end must be a date.");
      if (outcome === "complication" && !text(d.complication)) throw fail("A complication must be described.");
      return {
        requirement,
        detail: {
          requirementKey: "sterilization",
          provider: String(d.provider),
          outcome,
          recoveryUntil: (d.recoveryUntil as string | null | undefined) ?? null,
          costReference: typeof d.costReference === "string" ? d.costReference : null,
          complication: typeof d.complication === "string" ? d.complication : null,
        },
      };
    }
    case "behaviour-assessment":
      if (!text(d.provider) || !text(d.outcome)) throw fail("Behaviour assessment needs the assessor and the outcome.");
      return { requirement, detail: { requirementKey: "behaviour-assessment", provider: String(d.provider), outcome: String(d.outcome) } };
    case "housing":
      throw new AnimalEvidenceError("wrong_kind", "Housing is evidenced by a placement, not a care record.");
  }
}
