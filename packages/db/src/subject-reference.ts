const SUBJECT_KIND_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUBJECT_KIND_SLUG_MAX_LENGTH = 63;

export type SubjectReference = {
  subjectKindSlug: string;
  subjectRef: string;
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
