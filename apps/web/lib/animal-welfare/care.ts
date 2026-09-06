export type CareRecordKind =
  | "condition" | "allergy" | "medication" | "vaccination" | "procedure"
  | "weight" | "observation" | "behavior" | "note";

export type AnimalCareRecord = {
  id: string;
  organizationId: string;
  subjectKindSlug: "animal-profile";
  subjectRef: string;
  kind: CareRecordKind;
  lifecycle: "active" | "superseded" | "quarantined";
  lifecycleAt?: Date;
  lifecycleReason?: string;
  value?: string;
  unit?: string;
  effectiveAt: Date;
  authorPrincipalId: string;
  correctsId?: string;
  successorId?: string;
  correctionReason?: string;
  recordedAt: Date;
};

export function recordCareFact(input: Omit<AnimalCareRecord, "subjectKindSlug" | "lifecycle" | "recordedAt"> & { recordedAt?: Date }): AnimalCareRecord {
  if (!input.organizationId || !input.subjectRef || !input.authorPrincipalId) {
    throw new Error("Care facts require organization, subject, and author");
  }
  return {
    ...input,
    subjectKindSlug: "animal-profile",
    lifecycle: "active",
    recordedAt: input.recordedAt ?? new Date(),
  };
}

export function correctCareRecord(
  original: AnimalCareRecord,
  input: { id: string; value: string; reason: string; authorPrincipalId: string; recordedAt: Date },
) {
  if (original.lifecycle !== "active") throw new Error("Only an active care fact can be corrected");
  if (!input.reason.trim()) throw new Error("A correction reason is required");
  const correction: AnimalCareRecord = {
    ...original,
    id: input.id,
    value: input.value,
    lifecycle: "active",
    correctsId: original.id,
    successorId: undefined,
    correctionReason: input.reason,
    authorPrincipalId: input.authorPrincipalId,
    recordedAt: input.recordedAt,
  };
  return {
    prior: {
      ...original,
      lifecycle: "superseded" as const,
      lifecycleAt: input.recordedAt,
      lifecycleReason: input.reason,
      successorId: input.id,
    },
    correction,
  };
}
