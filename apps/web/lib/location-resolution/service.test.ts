import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    country: { findMany: vi.fn() },
    region: { findMany: vi.fn(), create: vi.fn() },
    city: { findMany: vi.fn(), create: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { normalizeLocalityName } from "./normalize";
import {
  createLocality,
  forceCreateLocality,
  searchCountriesForLocation,
  searchLocalities,
  searchRegionsForLocation,
  suggestDuplicateLocalities,
} from "./service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeLocalityName", () => {
  it("normalizes case, diacritics, Unicode composition, and whitespace", () => {
    expect(normalizeLocalityName("  São   Tomé  ")).toBe("sao tome");
    expect(normalizeLocalityName("São Tomé")).toBe("sao tome");
  });

  it("keeps meaningful punctuation inside names", () => {
    expect(normalizeLocalityName("Winston-Salem")).toBe("winston-salem");
    expect(normalizeLocalityName("St. John's")).toBe("st. john's");
  });
});

describe("searchCountriesForLocation", () => {
  it("searches active countries by name and ISO codes", async () => {
    const countries = [{ id: "country-us", name: "United States", iso2: "US", iso3: "USA", phoneCode: "+1" }];
    vi.mocked(prisma.country.findMany).mockResolvedValue(countries as never);

    await expect(searchCountriesForLocation("us")).resolves.toEqual(countries);
    expect(prisma.country.findMany).toHaveBeenCalledWith({
      where: {
        status: "active",
        OR: [
          { name: { contains: "us", mode: "insensitive" } },
          { iso2: { contains: "us", mode: "insensitive" } },
          { iso3: { contains: "us", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, iso2: true, iso3: true, phoneCode: true },
      orderBy: { name: "asc" },
      take: 20,
    });
  });

  it("returns empty array for whitespace query", async () => {
    await expect(searchCountriesForLocation("   ")).resolves.toEqual([]);
    expect(prisma.country.findMany).not.toHaveBeenCalled();
  });
});

describe("searchRegionsForLocation", () => {
  it("searches active regions scoped to country", async () => {
    const regions = [{ id: "region-tx", name: "Texas", code: "TX" }];
    vi.mocked(prisma.region.findMany).mockResolvedValue(regions as never);

    await expect(searchRegionsForLocation("country-us", "tex")).resolves.toEqual(regions);
    expect(prisma.region.findMany).toHaveBeenCalledWith({
      where: {
        countryId: "country-us",
        status: "active",
        OR: [
          { name: { contains: "tex", mode: "insensitive" } },
          { code: { contains: "tex", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
      take: 20,
    });
  });
});

describe("searchLocalities", () => {
  it("searches active localities scoped to region", async () => {
    const localities = [{ id: "city-thorndale", name: "Thorndale" }];
    vi.mocked(prisma.city.findMany).mockResolvedValue(localities as never);

    await expect(searchLocalities("region-tx", "thor")).resolves.toEqual(localities);
    expect(prisma.city.findMany).toHaveBeenCalledWith({
      where: {
        regionId: "region-tx",
        status: "active",
        name: { contains: "thor", mode: "insensitive" },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 20,
    });
  });
});

describe("suggestDuplicateLocalities", () => {
  it("returns exact normalized matches before create", async () => {
    vi.mocked(prisma.city.findMany).mockResolvedValue([
      { id: "city-1", name: "Sao Tome" },
      { id: "city-2", name: "Thorndale" },
    ] as never);

    await expect(suggestDuplicateLocalities("region-1", "São Tomé")).resolves.toEqual([
      { id: "city-1", name: "Sao Tome" },
    ]);
  });
});

describe("createLocality", () => {
  it("returns suggestions when an exact normalized duplicate exists", async () => {
    vi.mocked(prisma.city.findMany).mockResolvedValue([{ id: "city-1", name: "Sao Tome" }] as never);

    const result = await createLocality({ regionId: "region-1", name: "São Tomé" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Similar localities");
    expect(result.suggestions).toEqual([{ id: "city-1", name: "Sao Tome" }]);
    expect(prisma.city.create).not.toHaveBeenCalled();
  });

  it("creates locality with current City table shape when no duplicate exists", async () => {
    vi.mocked(prisma.city.findMany).mockResolvedValue([]);
    vi.mocked(prisma.city.create).mockResolvedValue({ id: "city-new", name: "Thorndale" } as never);

    const result = await createLocality({ regionId: "region-tx", name: " Thorndale " });

    expect(result).toEqual({
      ok: true,
      message: 'Locality "Thorndale" created.',
      created: { id: "city-new", name: "Thorndale" },
    });
    expect(prisma.city.create).toHaveBeenCalledWith({
      data: {
        name: "Thorndale",
        regionId: "region-tx",
        status: "active",
      },
      select: { id: true, name: true },
    });
  });

  it("rejects empty/whitespace name", async () => {
    const result = await createLocality({ regionId: "region-1", name: "   " });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/required/i);
    expect(prisma.city.findMany).not.toHaveBeenCalled();
  });
});

describe("forceCreateLocality", () => {
  it("bypasses duplicate suggestions for steward-confirmed distinct localities", async () => {
    vi.mocked(prisma.city.create).mockResolvedValue({ id: "city-force", name: "Springfield" } as never);

    const result = await forceCreateLocality({ regionId: "region-1", name: "Springfield" });

    expect(result.ok).toBe(true);
    expect(prisma.city.findMany).not.toHaveBeenCalled();
    expect(prisma.city.create).toHaveBeenCalledWith({
      data: {
        name: "Springfield",
        regionId: "region-1",
        status: "active",
      },
      select: { id: true, name: true },
    });
  });
});
