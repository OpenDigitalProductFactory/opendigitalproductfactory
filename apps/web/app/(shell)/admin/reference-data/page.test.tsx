import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  countryCount: vi.fn(),
  countryFindMany: vi.fn(),
  countryFindUnique: vi.fn(),
  regionCount: vi.fn(),
  regionFindMany: vi.fn(),
  regionFindUnique: vi.fn(),
  cityCount: vi.fn(),
  cityFindMany: vi.fn(),
  workLocationCount: vi.fn(),
  workLocationFindMany: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    country: {
      count: mocks.countryCount,
      findMany: mocks.countryFindMany,
      findUnique: mocks.countryFindUnique,
    },
    region: {
      count: mocks.regionCount,
      findMany: mocks.regionFindMany,
      findUnique: mocks.regionFindUnique,
    },
    city: {
      count: mocks.cityCount,
      findMany: mocks.cityFindMany,
    },
    workLocation: {
      count: mocks.workLocationCount,
      findMany: mocks.workLocationFindMany,
    },
  },
}));

vi.mock("@/components/admin/AdminTabNav", () => ({
  AdminTabNav: () => null,
}));
vi.mock("@/components/admin/CountryPanel", () => ({
  CountryPanel: () => null,
}));
vi.mock("@/components/admin/RegionPanel", () => ({
  RegionPanel: () => null,
}));
vi.mock("@/components/admin/CityPanel", () => ({
  CityPanel: () => null,
}));
vi.mock("@/components/admin/WorkLocationPanel", () => ({
  WorkLocationPanel: () => null,
}));

import AdminReferenceDataPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.countryCount.mockResolvedValue(70);
  mocks.regionCount.mockResolvedValue(90);
  mocks.cityCount.mockResolvedValue(120);
  mocks.workLocationCount.mockResolvedValue(140);
  mocks.countryFindUnique.mockResolvedValue({
    id: "country-1",
    name: "Australia",
    iso2: "AU",
  });
  mocks.regionFindUnique.mockResolvedValue({
    id: "region-1",
    name: "New South Wales",
    code: "NSW",
    country: { id: "country-1", name: "Australia", iso2: "AU" },
  });
  mocks.countryFindMany.mockResolvedValue([]);
  mocks.regionFindMany.mockResolvedValue([]);
  mocks.cityFindMany.mockResolvedValue([]);
  mocks.workLocationFindMany.mockResolvedValue([]);
});

describe("AdminReferenceDataPage", () => {
  it("uses bounded, parent-scoped queries for every rendered list", async () => {
    await AdminReferenceDataPage({
      searchParams: Promise.resolve({
        countryQ: "aus",
        countryPage: "2",
        regionCountry: "country-1",
        regionQ: "new",
        regionPage: "3",
        cityRegion: "region-1",
        cityQ: "spring",
        cityPage: "4",
        workLocationQ: "hq",
        workLocationPage: "5",
      }),
    });

    expect(mocks.countryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 25, take: 25 }),
    );
    expect(mocks.regionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ countryId: "country-1" }),
        skip: 50,
        take: 25,
      }),
    );
    expect(mocks.cityFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ regionId: "region-1" }),
        skip: 75,
        take: 25,
      }),
    );
    expect(mocks.workLocationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 100, take: 25 }),
    );
  });

  it("does not count or list unscoped regions and cities", async () => {
    await AdminReferenceDataPage({
      searchParams: Promise.resolve({}),
    });

    expect(mocks.regionCount).not.toHaveBeenCalled();
    expect(mocks.regionFindMany).not.toHaveBeenCalled();
    expect(mocks.cityCount).not.toHaveBeenCalled();
    expect(mocks.cityFindMany).not.toHaveBeenCalled();
    expect(mocks.countryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25 }),
    );
    expect(mocks.workLocationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25 }),
    );
  });
});
