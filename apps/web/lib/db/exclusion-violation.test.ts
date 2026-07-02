import { describe, it, expect } from "vitest";
import { isExclusionViolation } from "./exclusion-violation";

describe("isExclusionViolation", () => {
  it("detects the driver SQLSTATE on meta.code", () => {
    expect(isExclusionViolation({ meta: { code: "23P01" } })).toBe(true);
  });

  it("detects the SQLSTATE embedded in the message", () => {
    expect(isExclusionViolation(new Error("db error 23P01 whatever"))).toBe(true);
  });

  it("detects the 'exclusion constraint' phrase", () => {
    expect(
      isExclusionViolation(new Error("conflicting key value violates exclusion constraint"))
    ).toBe(true);
  });

  it("detects our named constraints via the _no_overlap suffix", () => {
    expect(
      isExclusionViolation(new Error('violates constraint "RentalAgreement_no_overlap"'))
    ).toBe(true);
  });

  it("returns false for unique-constraint (P2002) and unrelated errors", () => {
    expect(isExclusionViolation({ code: "P2002", message: "Unique constraint failed" })).toBe(false);
    expect(isExclusionViolation(new Error("some other failure"))).toBe(false);
    expect(isExclusionViolation(null)).toBe(false);
    expect(isExclusionViolation(undefined)).toBe(false);
    expect(isExclusionViolation("string error")).toBe(false);
  });
});
