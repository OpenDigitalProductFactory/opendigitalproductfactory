const SUBJECT_KIND_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUBJECT_KIND_SLUG_MAX_LENGTH = 63;

export type SubjectReference = {
  subjectKindSlug: string;
  subjectRef: string;
};

export const SUBJECT_REFERENCE_VERSION = "subject-reference.v1" as const;

export type ScopedSubjectReference = SubjectReference & {
  version: typeof SUBJECT_REFERENCE_VERSION;
  organizationId: string;
};

export function readSubjectReference(input: unknown): SubjectReference | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const { subjectKindSlug, subjectRef } = input as Record<string, unknown>;
  if (
    typeof subjectKindSlug !== "string" ||
    subjectKindSlug.length > SUBJECT_KIND_SLUG_MAX_LENGTH ||
    !SUBJECT_KIND_SLUG_PATTERN.test(subjectKindSlug) ||
    typeof subjectRef !== "string" ||
    subjectRef.trim().length === 0
  ) {
    return null;
  }

  return { subjectKindSlug, subjectRef: subjectRef.trim() };
}

export function patientSubjectReference(patientProfileId: string): SubjectReference {
  const reference = readSubjectReference({
    subjectKindSlug: "patient-profile",
    subjectRef: patientProfileId,
  });

  if (!reference) {
    throw new Error("A non-empty patient profile ID is required");
  }

  return reference;
}

export function readScopedSubjectReference(input: unknown): ScopedSubjectReference | null {
  if (typeof input !== "object" || input === null) return null;
  const candidate = input as Record<string, unknown>;
  const base = readSubjectReference(candidate);
  if (
    !base ||
    candidate.version !== SUBJECT_REFERENCE_VERSION ||
    typeof candidate.organizationId !== "string" ||
    candidate.organizationId.trim().length === 0
  ) {
    return null;
  }
  return {
    version: SUBJECT_REFERENCE_VERSION,
    organizationId: candidate.organizationId.trim(),
    ...base,
  };
}

export function scopedSubjectReference(input: Omit<ScopedSubjectReference, "version">): ScopedSubjectReference {
  const reference = readScopedSubjectReference({ version: SUBJECT_REFERENCE_VERSION, ...input });
  if (!reference) throw new Error("A valid organization-scoped subject reference is required");
  return reference;
}

export function assertSubjectOrganization(
  reference: ScopedSubjectReference,
  organizationId: string,
): ScopedSubjectReference {
  if (reference.organizationId !== organizationId) {
    throw new Error("Subject reference belongs to another organization");
  }
  return reference;
}
