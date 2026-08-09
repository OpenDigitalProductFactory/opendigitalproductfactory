import { describe, expect, it } from "vitest";
import { ownerEvidenceObservedAtFromRevisions } from "./owner-change-evidence";

describe("ownerEvidenceObservedAtFromRevisions", () => {
  it("projects the newest accepted timestamps supplied by the canonical query", () => {
    expect(ownerEvidenceObservedAtFromRevisions([
      { field: "uxTestResults", createdAt: new Date("2026-07-30T12:02:00.000Z") },
      { field: "acceptanceMet", createdAt: new Date("2026-07-30T12:01:00.000Z") },
    ])).toEqual({
      acceptance: "2026-07-30T12:01:00.000Z",
      ux: "2026-07-30T12:02:00.000Z",
    });
  });

  it("fails closed when no accepted evidence revisions are available", () => {
    expect(ownerEvidenceObservedAtFromRevisions(undefined)).toEqual({
      acceptance: null,
      ux: null,
    });
  });
});
