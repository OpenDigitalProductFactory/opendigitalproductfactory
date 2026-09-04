import { describe, expect, it } from "vitest";

import {
  assertSubjectOrganization,
  patientSubjectReference,
  readScopedSubjectReference,
  readSubjectReference,
  scopedSubjectReference,
} from "./subject-reference";

describe("subject reference", () => {
  it("creates the canonical patient-profile reference", () => {
    expect(patientSubjectReference("patient-a")).toEqual({
      subjectKindSlug: "patient-profile",
      subjectRef: "patient-a",
    });
  });

  it.each(["animal", "asset", "vehicle-fleet-item"])(
    "accepts the open subject slug %s",
    (subjectKindSlug) => {
      expect(readSubjectReference({ subjectKindSlug, subjectRef: "subject-a" })).toEqual({
        subjectKindSlug,
        subjectRef: "subject-a",
      });
    },
  );

  it.each([
    { subjectKindSlug: "Animal", subjectRef: "subject-a" },
    { subjectKindSlug: "animal welfare", subjectRef: "subject-a" },
    { subjectKindSlug: "animal", subjectRef: "" },
    { subjectKindSlug: "animal", subjectRef: "   " },
    { subjectKindSlug: "animal", subjectRef: null },
  ])("rejects malformed references", (input) => {
    expect(readSubjectReference(input)).toBeNull();
  });

  it("round-trips a versioned organization-scoped animal reference", () => {
    const reference = scopedSubjectReference({
      organizationId: "org-rescue",
      subjectKindSlug: "animal-profile",
      subjectRef: "animal-1",
    });

    expect(reference).toEqual({
      version: "subject-reference.v1",
      organizationId: "org-rescue",
      subjectKindSlug: "animal-profile",
      subjectRef: "animal-1",
    });
    expect(readScopedSubjectReference(reference)).toEqual(reference);
  });

  it("rejects unknown versions and cross-organization use", () => {
    expect(readScopedSubjectReference({
      version: "subject-reference.v2",
      organizationId: "org-rescue",
      subjectKindSlug: "animal-profile",
      subjectRef: "animal-1",
    })).toBeNull();

    expect(() => assertSubjectOrganization(
      scopedSubjectReference({
        organizationId: "org-rescue",
        subjectKindSlug: "animal-profile",
        subjectRef: "animal-1",
      }),
      "org-other",
    )).toThrow("Subject reference belongs to another organization");
  });
});
