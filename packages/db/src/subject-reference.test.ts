import { describe, expect, it } from "vitest";

import {
  patientSubjectReference,
  readSubjectReference,
} from "./subject-reference";

describe("subject reference", () => {
  it("creates the canonical patient-profile reference", () => {
    expect(patientSubjectReference("patient-a")).toEqual({
      subjectType: "patient-profile",
      subjectId: "patient-a",
    });
  });

  it.each(["animal", "asset", "vehicle-fleet-item"])(
    "accepts the open subject slug %s",
    (subjectType) => {
      expect(readSubjectReference({ subjectType, subjectId: "subject-a" })).toEqual({
        subjectType,
        subjectId: "subject-a",
      });
    },
  );

  it.each([
    { subjectType: "Animal", subjectId: "subject-a" },
    { subjectType: "animal welfare", subjectId: "subject-a" },
    { subjectType: "animal", subjectId: "" },
    { subjectType: "animal", subjectId: "   " },
    { subjectType: "animal", subjectId: null },
  ])("rejects malformed references", (input) => {
    expect(readSubjectReference(input)).toBeNull();
  });
});
