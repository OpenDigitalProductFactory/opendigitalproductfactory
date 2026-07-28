import { describe, expect, it } from "vitest";
import {
  REFERENCE_DATA_PAGE_SIZE,
  buildReferenceDataHref,
  createReferenceDataQueryPlan,
  parseReferenceDataSearchParams,
  resolvePageWindow,
} from "./reference-data-read-model";

describe("parseReferenceDataSearchParams", () => {
  it("normalizes namespaced filters and rejects invalid page values", () => {
    expect(
      parseReferenceDataSearchParams({
        countryQ: "  aus  ",
        countryPage: "2",
        regionCountry: " country-1 ",
        regionQ: ["new", "ignored"],
        regionPage: "-4",
        cityRegion: "region-1",
        cityPage: "1.5",
        workLocationQ: " headquarters ",
        workLocationPage: "999999999999999999999",
      }),
    ).toEqual({
      countries: { query: "aus", page: 2 },
      regions: { countryId: "country-1", query: "new", page: 1 },
      cities: { regionId: "region-1", query: "", page: 1 },
      workLocations: { query: "headquarters", page: 1 },
    });
  });

  it("caps free-text filters before they reach Prisma", () => {
    const parsed = parseReferenceDataSearchParams({
      countryQ: "x".repeat(500),
    });

    expect(parsed.countries.query).toHaveLength(100);
  });
});

describe("resolvePageWindow", () => {
  it("clamps an out-of-range page and returns a bounded window", () => {
    expect(resolvePageWindow(50, 51)).toEqual({
      page: 3,
      pageCount: 3,
      skip: 50,
      take: REFERENCE_DATA_PAGE_SIZE,
      total: 51,
    });
  });

  it("uses page one for an empty result set", () => {
    expect(resolvePageWindow(8, 0)).toEqual({
      page: 1,
      pageCount: 1,
      skip: 0,
      take: REFERENCE_DATA_PAGE_SIZE,
      total: 0,
    });
  });
});

describe("createReferenceDataQueryPlan", () => {
  it("bounds every list and scopes child queries to their selected parent", () => {
    const plan = createReferenceDataQueryPlan(
      {
        countries: { query: "aus", page: 2 },
        regions: { countryId: "country-1", query: "new", page: 3 },
        cities: { regionId: "region-1", query: "spring", page: 4 },
        workLocations: { query: "hq", page: 5 },
      },
      {
        countries: 70,
        regions: 90,
        cities: 120,
        workLocations: 140,
      },
    );

    expect(plan.countries.findMany).toMatchObject({
      skip: 25,
      take: 25,
      where: {
        OR: [
          { name: { contains: "aus", mode: "insensitive" } },
          { iso2: { contains: "aus", mode: "insensitive" } },
          { iso3: { contains: "aus", mode: "insensitive" } },
        ],
      },
    });
    expect(plan.regions.findMany).toMatchObject({
      skip: 50,
      take: 25,
      where: {
        countryId: "country-1",
        OR: [
          { name: { contains: "new", mode: "insensitive" } },
          { code: { contains: "new", mode: "insensitive" } },
        ],
      },
    });
    expect(plan.cities.findMany).toMatchObject({
      skip: 75,
      take: 25,
      where: {
        regionId: "region-1",
        name: { contains: "spring", mode: "insensitive" },
      },
    });
    expect(plan.workLocations.findMany).toMatchObject({
      skip: 100,
      take: 25,
      where: { name: { contains: "hq", mode: "insensitive" } },
    });
  });

  it("does not issue unscoped region or city list queries", () => {
    const plan = createReferenceDataQueryPlan(
      {
        countries: { query: "", page: 1 },
        regions: { countryId: "", query: "", page: 1 },
        cities: { regionId: "", query: "", page: 1 },
        workLocations: { query: "", page: 1 },
      },
      { countries: 1, regions: 0, cities: 0, workLocations: 1 },
    );

    expect(plan.regions.findMany).toBeNull();
    expect(plan.cities.findMany).toBeNull();
  });
});

describe("buildReferenceDataHref", () => {
  it("preserves unrelated panel state and resets the changed panel page", () => {
    expect(
      buildReferenceDataHref(
        {
          countryQ: "aus",
          countryPage: "3",
          regionCountry: "country-1",
          regionQ: "new",
          regionPage: "4",
          cityRegion: "region-1",
        },
        { regionQ: "south", regionPage: null },
      ),
    ).toBe(
      "/admin/reference-data?cityRegion=region-1&countryPage=3&countryQ=aus&regionCountry=country-1&regionQ=south",
    );
  });

  it("omits empty values and emits the canonical route with no query", () => {
    expect(buildReferenceDataHref({ countryQ: "aus" }, { countryQ: "" })).toBe(
      "/admin/reference-data",
    );
  });
});
