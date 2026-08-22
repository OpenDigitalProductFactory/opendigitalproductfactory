const SUBJECT_TYPE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUBJECT_TYPE_MAX_LENGTH = 63;

export type SubjectReference = {
  subjectType: string;
  subjectId: string;
};

export function readSubjectReference(input: unknown): SubjectReference | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const { subjectType, subjectId } = input as Record<string, unknown>;
  if (
    typeof subjectType !== "string" ||
    subjectType.length > SUBJECT_TYPE_MAX_LENGTH ||
    !SUBJECT_TYPE_PATTERN.test(subjectType) ||
    typeof subjectId !== "string" ||
    subjectId.trim().length === 0
  ) {
    return null;
  }

  return { subjectType, subjectId: subjectId.trim() };
}

export function patientSubjectReference(patientProfileId: string): SubjectReference {
  const reference = readSubjectReference({
    subjectType: "patient-profile",
    subjectId: patientProfileId,
  });

  if (!reference) {
    throw new Error("A non-empty patient profile ID is required");
  }

  return reference;
}
