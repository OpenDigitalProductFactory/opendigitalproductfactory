import { describe, expect, it } from "vitest";
import { getDefaultEmploymentTypes, getDefaultWorkLocations } from "./workforce-seed";

describe("workforce seed defaults", () => {
  it("returns stable employment types", () => {
    expect(getDefaultEmploymentTypes().map((item) => item.employmentTypeId)).toEqual([
      "emp-full-time",
      "emp-part-time",
      "emp-contractor",
      "emp-intern",
      "emp-advisor",
    ]);
  });

  it("returns a default remote work location", () => {
    expect(getDefaultWorkLocations().map((item) => item.locationId)).toContain("loc-remote");
  });
});
