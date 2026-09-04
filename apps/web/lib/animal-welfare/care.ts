export type CareRecordKind =
  | "condition" | "allergy" | "medication" | "vaccination" | "procedure"
  | "weight" | "observation" | "behavior" | "note";

export type AnimalCareRecord = {
  id: string;
  organizationId: string;
  subjectKindSlug: "animal-profile";
  subjectRef: string;
  kind: CareRecordKind;
  status: "active" | "superseded" | "entered-in-error";
  value?: string;
  unit?: string;
  effectiveAt: Date;
  authorPrincipalId: string;
  correctsId?: string;
  supersededById?: string;
  correctionReason?: string;
  recordedAt: Date;
};

export function recordCareFact(input: Omit<AnimalCareRecord, "subjectKindSlug" | "status" | "recordedAt"> & { recordedAt?: Date }): AnimalCareRecord {
  if (!input.organizationId || !input.subjectRef || !input.authorPrincipalId) {
    throw new Error("Care facts require organization, subject, and author");
  }
  return {
    ...input,
    subjectKindSlug: "animal-profile",
    status: "active",
    recordedAt: input.recordedAt ?? new Date(),
  };
}

export function correctCareRecord(
  original: AnimalCareRecord,
  input: { id: string; value: string; reason: string; authorPrincipalId: string; recordedAt: Date },
) {
  if (original.status !== "active") throw new Error("Only an active care fact can be corrected");
  if (!input.reason.trim()) throw new Error("A correction reason is required");
  const correction: AnimalCareRecord = {
    ...original,
    id: input.id,
    value: input.value,
    status: "active",
    correctsId: original.id,
    supersededById: undefined,
    correctionReason: input.reason,
    authorPrincipalId: input.authorPrincipalId,
    recordedAt: input.recordedAt,
  };
  return {
    prior: { ...original, status: "superseded" as const, supersededById: input.id },
    correction,
  };
}
