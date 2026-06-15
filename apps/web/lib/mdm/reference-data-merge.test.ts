import { describe, expect, it } from "vitest";

import {
  planRegionMerge,
  validateCityMergePair,
  validateRegionMergePair,
  type RefCity,
} from "@/lib/mdm/reference-data-merge";

describe("planRegionMerge", () => {
  it("repoints loser cities that have no name collision in the survivor", () => {
    const loser: RefCity[] = [
      { id: "c1", nameNormalized: "san francisco" },
      { id: "c2", nameNormalized: "oakland" },
    ];
    const survivor: RefCity[] = [{ id: "s1", nameNormalized: "los angeles" }];
    const plan = planRegionMerge(loser, survivor);
    expect(plan.cityRepoints.sort()).toEqual(["c1", "c2"]);
    expect(plan.cityMerges).toEqual([]);
  });

  it("merges loser cities into a same-named survivor city (avoids name-uniqueness collision)", () => {
    const loser: RefCity[] = [
      { id: "c1", nameNormalized: "san francisco" }, // collides
      { id: "c2", nameNormalized: "oakland" }, // unique
    ];
    const survivor: RefCity[] = [{ id: "s1", nameNormalized: "san francisco" }];
    const plan = planRegionMerge(loser, survivor);
    expect(plan.cityRepoints).toEqual(["c2"]);
    expect(plan.cityMerges).toEqual([{ loserCityId: "c1", survivorCityId: "s1" }]);
  });

  it("handles an empty loser region", () => {
    expect(planRegionMerge([], [{ id: "s1", nameNormalized: "x" }])).toEqual({
      cityRepoints: [],
      cityMerges: [],
    });
  });
});

describe("validateRegionMergePair", () => {
  it("rejects merging a region into itself", () => {
    expect(
      validateRegionMergePair({ id: "r1", countryId: "us" }, { id: "r1", countryId: "us" }),
    ).toBe("same-record");
  });

  it("rejects cross-country region merges", () => {
    expect(
      validateRegionMergePair({ id: "r1", countryId: "us" }, { id: "r2", countryId: "ca" }),
    ).toBe("different-country");
  });

  it("accepts a valid same-country pair", () => {
    expect(
      validateRegionMergePair({ id: "r1", countryId: "us" }, { id: "r2", countryId: "us" }),
    ).toBeNull();
  });
});

describe("validateCityMergePair", () => {
  it("rejects merging a city into itself and across regions", () => {
    expect(validateCityMergePair({ id: "c1", regionId: "r1" }, { id: "c1", regionId: "r1" })).toBe("same-record");
    expect(validateCityMergePair({ id: "c1", regionId: "r1" }, { id: "c2", regionId: "r2" })).toBe("different-region");
  });

  it("accepts a valid same-region pair", () => {
    expect(validateCityMergePair({ id: "c1", regionId: "r1" }, { id: "c2", regionId: "r1" })).toBeNull();
  });
});
