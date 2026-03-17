import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "test-user-1" } }),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    country: { findMany: vi.fn() },
    region: { findMany: vi.fn(), create: vi.fn() },
    city: { findMany: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import {
  searchCountries,
  searchRegions,
  searchCities,
  createRegion,
  createCity,
  forceCreateRegion,
  forceCreateCity,
} from "./reference-data";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// searchCountries
// ---------------------------------------------------------------------------
describe("searchCountries", () => {
  it("returns countries matching query", async () => {
    const countries = [
      { id: "c1", name: "Australia", iso2: "AU", iso3: "AUS", phoneCode: "+61" },
      { id: "c2", name: "Austria", iso2: "AT", iso3: "AUT", phoneCode: "+43" },
    ];
    vi.mocked(prisma.country.findMany).mockResolvedValue(countries);

    const result = await searchCountries("aus");

    expect(result).toEqual(countries);
    expect(prisma.country.findMany).toHaveBeenCalledWith({
      where: {
        status: "active",
        OR: [
          { name: { contains: "aus", mode: "insensitive" } },
          { iso2: { contains: "aus", mode: "insensitive" } },
          { iso3: { contains: "aus", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, iso2: true, iso3: true, phoneCode: true },
      orderBy: { name: "asc" },
      take: 20,
    });
  });

  it("returns empty array for empty/whitespace query", async () => {
    const result = await searchCountries("   ");
    expect(result).toEqual([]);
    expect(prisma.country.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// searchRegions
// ---------------------------------------------------------------------------
describe("searchRegions", () => {
  it("returns regions scoped to countryId", async () => {
    const regions = [
      { id: "r1", name: "New South Wales", code: "NSW" },
      { id: "r2", name: "New Zealand Region", code: null },
    ];
    vi.mocked(prisma.region.findMany).mockResolvedValue(regions);

    const result = await searchRegions("country-1", "new");

    expect(result).toEqual(regions);
    expect(prisma.region.findMany).toHaveBeenCalledWith({
      where: {
        countryId: "country-1",
        status: "active",
        OR: [
          { name: { contains: "new", mode: "insensitive" } },
          { code: { contains: "new", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
      take: 20,
    });
  });

  it("returns empty array for empty/whitespace query", async () => {
    const result = await searchRegions("country-1", "");
    expect(result).toEqual([]);
    expect(prisma.region.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// searchCities
// ---------------------------------------------------------------------------
describe("searchCities", () => {
  it("returns cities scoped to regionId", async () => {
    const cities = [{ id: "ci1", name: "Sydney" }];
    vi.mocked(prisma.city.findMany).mockResolvedValue(cities);

    const result = await searchCities("region-1", "syd");

    expect(result).toEqual(cities);
    expect(prisma.city.findMany).toHaveBeenCalledWith({
      where: {
        regionId: "region-1",
        status: "active",
        name: { contains: "syd", mode: "insensitive" },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 20,
    });
  });

  it("returns empty array for empty/whitespace query", async () => {
    const result = await searchCities("region-1", "  ");
    expect(result).toEqual([]);
    expect(prisma.city.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createRegion
// ---------------------------------------------------------------------------
describe("createRegion", () => {
  it("returns suggestions when near-match exists", async () => {
    const existing = [
      { id: "r1", name: "Queensland", code: "QLD" },
    ];
    vi.mocked(prisma.region.findMany).mockResolvedValue(existing);

    const result = await createRegion("country-1", "Queens", "QLD");

    expect(result.ok).toBe(false);
    expect(result.suggestions).toEqual(existing);
    expect(prisma.region.create).not.toHaveBeenCalled();
  });

  it("creates when no near-match exists", async () => {
    vi.mocked(prisma.region.findMany).mockResolvedValue([]);
    vi.mocked(prisma.region.create).mockResolvedValue({
      id: "r-new",
      name: "Tasmania",
      code: "TAS",
    });

    const result = await createRegion("country-1", "Tasmania", "TAS");

    expect(result.ok).toBe(true);
    expect(result.created).toEqual({ id: "r-new", name: "Tasmania", code: "TAS" });
    expect(prisma.region.create).toHaveBeenCalledWith({
      data: {
        name: "Tasmania",
        code: "TAS",
        countryId: "country-1",
        status: "active",
      },
      select: { id: true, name: true, code: true },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/employee");
  });

  it("rejects empty/whitespace name", async () => {
    const result = await createRegion("country-1", "   ");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/name/i);
    expect(prisma.region.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createCity
// ---------------------------------------------------------------------------
describe("createCity", () => {
  it("returns suggestions when near-match exists", async () => {
    const existing = [{ id: "ci1", name: "Melbourne" }];
    vi.mocked(prisma.city.findMany).mockResolvedValue(existing);

    const result = await createCity("region-1", "Melb");

    expect(result.ok).toBe(false);
    expect(result.suggestions).toEqual(existing);
    expect(prisma.city.create).not.toHaveBeenCalled();
  });

  it("creates when no near-match exists", async () => {
    vi.mocked(prisma.city.findMany).mockResolvedValue([]);
    vi.mocked(prisma.city.create).mockResolvedValue({
      id: "ci-new",
      name: "Hobart",
    });

    const result = await createCity("region-1", "Hobart");

    expect(result.ok).toBe(true);
    expect(result.created).toEqual({ id: "ci-new", name: "Hobart" });
    expect(prisma.city.create).toHaveBeenCalledWith({
      data: {
        name: "Hobart",
        regionId: "region-1",
        status: "active",
      },
      select: { id: true, name: true },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/employee");
  });

  it("rejects empty/whitespace name", async () => {
    const result = await createCity("region-1", "  ");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/name/i);
  });
});

// ---------------------------------------------------------------------------
// forceCreateRegion
// ---------------------------------------------------------------------------
describe("forceCreateRegion", () => {
  it("creates directly without near-match check", async () => {
    vi.mocked(prisma.region.create).mockResolvedValue({
      id: "r-force",
      name: "Queensland",
      code: "QLD",
    });

    const result = await forceCreateRegion("country-1", "Queensland", "QLD");

    expect(result.ok).toBe(true);
    expect(result.created).toEqual({ id: "r-force", name: "Queensland", code: "QLD" });
    expect(prisma.region.findMany).not.toHaveBeenCalled();
    expect(prisma.region.create).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/employee");
  });
});

// ---------------------------------------------------------------------------
// forceCreateCity
// ---------------------------------------------------------------------------
describe("forceCreateCity", () => {
  it("creates directly without near-match check", async () => {
    vi.mocked(prisma.city.create).mockResolvedValue({
      id: "ci-force",
      name: "Melbourne",
    });

    const result = await forceCreateCity("region-1", "Melbourne");

    expect(result.ok).toBe(true);
    expect(result.created).toEqual({ id: "ci-force", name: "Melbourne" });
    expect(prisma.city.findMany).not.toHaveBeenCalled();
    expect(prisma.city.create).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/employee");
  });
});
