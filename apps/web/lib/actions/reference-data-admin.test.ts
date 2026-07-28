import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    country: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    region: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    city: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    address: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    workLocation: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import {
  toggleCountryStatus,
  updateRegion,
  toggleRegionStatus,
  updateCity,
  toggleCityStatus,
  linkWorkLocationAddress,
  unlinkWorkLocationAddress,
  previewCityMerge,
  mergeCity,
  previewRegionMerge,
  mergeRegion,
  searchAdminRegions,
  searchRegionMergeCandidates,
  searchCityMergeCandidates,
} from "./reference-data-admin";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const adminSession = {
  user: { id: "u1", email: "admin@test.com", platformRole: "HR-000", isSuperuser: false },
};

const nonAdminSession = {
  user: { id: "u2", email: "user@test.com", platformRole: "HR-500", isSuperuser: false },
};

function mockAdmin() {
  vi.mocked(auth).mockResolvedValue(adminSession as never);
  vi.mocked(can).mockReturnValue(true);
}

function mockNonAdmin() {
  vi.mocked(auth).mockResolvedValue(nonAdminSession as never);
  vi.mocked(can).mockReturnValue(false);
}

function mockUnauthenticated() {
  vi.mocked(auth).mockResolvedValue(null as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Auth checks ─────────────────────────────────────────────────────────────

describe("authorization", () => {
  it("rejects unauthenticated user", async () => {
    mockUnauthenticated();
    const result = await toggleCountryStatus("c1");
    expect(result).toEqual({ ok: false, message: "Unauthorized" });
  });

  it("rejects non-admin user", async () => {
    mockNonAdmin();
    const result = await toggleCountryStatus("c1");
    expect(result).toEqual({ ok: false, message: "Unauthorized" });
  });

  it("rejects non-admin for all actions", async () => {
    mockNonAdmin();

    expect(await toggleCountryStatus("c1")).toEqual({ ok: false, message: "Unauthorized" });
    expect(await updateRegion("r1", { name: "Test" })).toEqual({ ok: false, message: "Unauthorized" });
    expect(await toggleRegionStatus("r1")).toEqual({ ok: false, message: "Unauthorized" });
    expect(await updateCity("ci1", { name: "Test" })).toEqual({ ok: false, message: "Unauthorized" });
    expect(await toggleCityStatus("ci1")).toEqual({ ok: false, message: "Unauthorized" });
    expect(await linkWorkLocationAddress("loc1", {
      label: "work",
      addressLine1: "123 Main St",
      cityId: "ci1",
      postalCode: "12345",
    })).toEqual({ ok: false, message: "Unauthorized" });
    expect(await unlinkWorkLocationAddress("loc1")).toEqual({ ok: false, message: "Unauthorized" });
  });
});

// ─── Bounded admin reference search ──────────────────────────────────────────

describe("bounded admin reference search", () => {
  it("searches regions across countries with an explicit result bound", async () => {
    mockAdmin();
    vi.mocked(prisma.region.findMany).mockResolvedValue([] as never);

    await searchAdminRegions("new");

    expect(prisma.region.findMany).toHaveBeenCalledWith({
      where: {
        status: "active",
        OR: [
          { name: { contains: "new", mode: "insensitive" } },
          { code: { contains: "new", mode: "insensitive" } },
          { country: { name: { contains: "new", mode: "insensitive" } } },
        ],
      },
      select: {
        id: true,
        name: true,
        code: true,
        country: { select: { id: true, name: true, iso2: true } },
      },
      orderBy: [{ name: "asc" }, { country: { name: "asc" } }],
      take: 20,
    });
  });

  it("scopes region merge candidates and excludes the loser", async () => {
    mockAdmin();
    vi.mocked(prisma.region.findMany).mockResolvedValue([] as never);

    await searchRegionMergeCandidates("country-1", "loser-1", "south");

    expect(prisma.region.findMany).toHaveBeenCalledWith({
      where: {
        countryId: "country-1",
        id: { not: "loser-1" },
        status: "active",
        OR: [
          { name: { contains: "south", mode: "insensitive" } },
          { code: { contains: "south", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
      take: 20,
    });
  });

  it("scopes city merge candidates and excludes the loser", async () => {
    mockAdmin();
    vi.mocked(prisma.city.findMany).mockResolvedValue([] as never);

    await searchCityMergeCandidates("region-1", "loser-1", "spring");

    expect(prisma.city.findMany).toHaveBeenCalledWith({
      where: {
        regionId: "region-1",
        id: { not: "loser-1" },
        status: "active",
        name: { contains: "spring", mode: "insensitive" },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 20,
    });
  });

  it("does not query for empty or unauthorized searches", async () => {
    mockAdmin();
    expect(await searchAdminRegions("  ")).toEqual([]);
    expect(prisma.region.findMany).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockNonAdmin();
    expect(await searchAdminRegions("new")).toEqual([]);
    expect(prisma.region.findMany).not.toHaveBeenCalled();
  });
});

// ─── toggleCountryStatus ─────────────────────────────────────────────────────

describe("toggleCountryStatus", () => {
  it("flips active to inactive", async () => {
    mockAdmin();
    vi.mocked(prisma.country.findUnique).mockResolvedValue({
      id: "c1", name: "Australia", status: "active",
    } as never);
    vi.mocked(prisma.country.update).mockResolvedValue({} as never);

    const result = await toggleCountryStatus("c1");

    expect(result.ok).toBe(true);
    expect(result.message).toContain("inactive");
    expect(prisma.country.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "inactive" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/reference-data");
    expect(revalidatePath).toHaveBeenCalledWith("/employee");
  });

  it("flips inactive to active", async () => {
    mockAdmin();
    vi.mocked(prisma.country.findUnique).mockResolvedValue({
      id: "c1", name: "Australia", status: "inactive",
    } as never);
    vi.mocked(prisma.country.update).mockResolvedValue({} as never);

    const result = await toggleCountryStatus("c1");

    expect(result.ok).toBe(true);
    expect(result.message).toContain("active");
    expect(prisma.country.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "active" },
    });
  });

  it("returns error for non-existent country", async () => {
    mockAdmin();
    vi.mocked(prisma.country.findUnique).mockResolvedValue(null);

    const result = await toggleCountryStatus("c-missing");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not found");
  });
});

// ─── updateRegion ────────────────────────────────────────────────────────────

describe("updateRegion", () => {
  it("updates region name", async () => {
    mockAdmin();
    vi.mocked(prisma.region.findUnique).mockResolvedValue({ id: "r1" } as never);
    vi.mocked(prisma.region.update).mockResolvedValue({} as never);

    const result = await updateRegion("r1", { name: "New South Wales" });

    expect(result.ok).toBe(true);
    expect(prisma.region.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { name: "New South Wales" },
    });
  });

  it("validates non-empty name", async () => {
    mockAdmin();

    const result = await updateRegion("r1", { name: "   " });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("cannot be empty");
    expect(prisma.region.update).not.toHaveBeenCalled();
  });

  it("trims whitespace from name", async () => {
    mockAdmin();
    vi.mocked(prisma.region.findUnique).mockResolvedValue({ id: "r1" } as never);
    vi.mocked(prisma.region.update).mockResolvedValue({} as never);

    await updateRegion("r1", { name: "  Victoria  " });

    expect(prisma.region.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { name: "Victoria" },
    });
  });

  it("updates region code", async () => {
    mockAdmin();
    vi.mocked(prisma.region.findUnique).mockResolvedValue({ id: "r1" } as never);
    vi.mocked(prisma.region.update).mockResolvedValue({} as never);

    const result = await updateRegion("r1", { code: "VIC" });

    expect(result.ok).toBe(true);
    expect(prisma.region.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { code: "VIC" },
    });
  });

  it("returns error for non-existent region", async () => {
    mockAdmin();
    vi.mocked(prisma.region.findUnique).mockResolvedValue(null);

    const result = await updateRegion("r-missing", { name: "Test" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not found");
  });
});

// ─── toggleRegionStatus ──────────────────────────────────────────────────────

describe("toggleRegionStatus", () => {
  it("flips active to inactive", async () => {
    mockAdmin();
    vi.mocked(prisma.region.findUnique).mockResolvedValue({
      id: "r1", name: "Queensland", status: "active",
    } as never);
    vi.mocked(prisma.region.update).mockResolvedValue({} as never);

    const result = await toggleRegionStatus("r1");

    expect(result.ok).toBe(true);
    expect(result.message).toContain("inactive");
    expect(prisma.region.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { status: "inactive" },
    });
  });
});

// ─── updateCity ──────────────────────────────────────────────────────────────

describe("updateCity", () => {
  it("updates city name", async () => {
    mockAdmin();
    vi.mocked(prisma.city.findUnique).mockResolvedValue({ id: "ci1" } as never);
    vi.mocked(prisma.city.update).mockResolvedValue({} as never);

    const result = await updateCity("ci1", { name: "Sydney" });

    expect(result.ok).toBe(true);
    expect(prisma.city.update).toHaveBeenCalledWith({
      where: { id: "ci1" },
      data: { name: "Sydney", nameNormalized: "sydney" },
    });
  });

  it("validates non-empty name", async () => {
    mockAdmin();

    const result = await updateCity("ci1", { name: "  " });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("cannot be empty");
    expect(prisma.city.update).not.toHaveBeenCalled();
  });
});

// ─── toggleCityStatus ────────────────────────────────────────────────────────

describe("toggleCityStatus", () => {
  it("flips active to inactive", async () => {
    mockAdmin();
    vi.mocked(prisma.city.findUnique).mockResolvedValue({
      id: "ci1", name: "Brisbane", status: "active",
    } as never);
    vi.mocked(prisma.city.update).mockResolvedValue({} as never);

    const result = await toggleCityStatus("ci1");

    expect(result.ok).toBe(true);
    expect(result.message).toContain("inactive");
    expect(prisma.city.update).toHaveBeenCalledWith({
      where: { id: "ci1" },
      data: { status: "inactive" },
    });
  });
});

// ─── linkWorkLocationAddress ─────────────────────────────────────────────────

describe("linkWorkLocationAddress", () => {
  it("creates address and links to work location", async () => {
    mockAdmin();
    vi.mocked(prisma.workLocation.findUnique).mockResolvedValue({ id: "loc1" } as never);
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: unknown) => {
      const tx = {
        address: { create: vi.fn().mockResolvedValue({ id: "addr1" }) },
        workLocation: { update: vi.fn().mockResolvedValue({}) },
      };
      await (fn as (tx: Record<string, unknown>) => Promise<void>)(tx);
      return undefined;
    }) as never);

    const result = await linkWorkLocationAddress("loc1", {
      label: "headquarters",
      addressLine1: "100 George St",
      cityId: "ci1",
      postalCode: "2000",
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("linked");
  });

  it("rejects empty address line 1", async () => {
    mockAdmin();

    const result = await linkWorkLocationAddress("loc1", {
      label: "work",
      addressLine1: "  ",
      cityId: "ci1",
      postalCode: "12345",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Address line 1");
  });

  it("rejects invalid label", async () => {
    mockAdmin();

    const result = await linkWorkLocationAddress("loc1", {
      label: "invalid-label",
      addressLine1: "123 Main St",
      cityId: "ci1",
      postalCode: "12345",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Invalid label");
  });

  it("rejects empty postal code", async () => {
    mockAdmin();

    const result = await linkWorkLocationAddress("loc1", {
      label: "work",
      addressLine1: "123 Main St",
      cityId: "ci1",
      postalCode: "  ",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Postal code");
  });

  it("returns error for non-existent work location", async () => {
    mockAdmin();
    vi.mocked(prisma.workLocation.findUnique).mockResolvedValue(null);

    const result = await linkWorkLocationAddress("loc-missing", {
      label: "work",
      addressLine1: "123 Main St",
      cityId: "ci1",
      postalCode: "12345",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("not found");
  });
});

// ─── unlinkWorkLocationAddress ───────────────────────────────────────────────

describe("unlinkWorkLocationAddress", () => {
  it("sets addressId to null and soft-deletes address", async () => {
    mockAdmin();
    vi.mocked(prisma.workLocation.findUnique).mockResolvedValue({
      id: "loc1", addressId: "addr1",
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: unknown) => {
      const tx = {
        workLocation: { update: vi.fn().mockResolvedValue({}) },
        address: { update: vi.fn().mockResolvedValue({}) },
      };
      await (fn as (tx: Record<string, unknown>) => Promise<void>)(tx);
      // Verify the calls happened with correct arguments
      expect(tx.workLocation.update).toHaveBeenCalledWith({
        where: { id: "loc1" },
        data: { addressId: null },
      });
      expect(tx.address.update).toHaveBeenCalledWith({
        where: { id: "addr1" },
        data: { status: "inactive" },
      });
      return undefined;
    }) as never);

    const result = await unlinkWorkLocationAddress("loc1");

    expect(result.ok).toBe(true);
    expect(result.message).toContain("soft-deleted");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/reference-data");
    expect(revalidatePath).toHaveBeenCalledWith("/employee");
  });

  it("returns error when location has no address", async () => {
    mockAdmin();
    vi.mocked(prisma.workLocation.findUnique).mockResolvedValue({
      id: "loc1", addressId: null,
    } as never);

    const result = await unlinkWorkLocationAddress("loc1");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("no linked address");
  });

  it("returns error for non-existent work location", async () => {
    mockAdmin();
    vi.mocked(prisma.workLocation.findUnique).mockResolvedValue(null);

    const result = await unlinkWorkLocationAddress("loc-missing");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("not found");
  });
});

// ─── Reference-data merge (MDM-5) ─────────────────────────────────────────────

describe("city merge", () => {
  it("rejects merging a city into itself", async () => {
    mockAdmin();
    vi.mocked(prisma.city.findUnique)
      .mockResolvedValueOnce({ id: "c1", regionId: "r1", name: "Springfield" } as never)
      .mockResolvedValueOnce({ id: "c1", regionId: "r1", name: "Springfield" } as never);

    const result = await mergeCity("c1", "c1");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("itself");
  });

  it("rejects merging cities across regions", async () => {
    mockAdmin();
    vi.mocked(prisma.city.findUnique)
      .mockResolvedValueOnce({ id: "c1", regionId: "r1", name: "A" } as never)
      .mockResolvedValueOnce({ id: "c2", regionId: "r2", name: "B" } as never);

    const result = await mergeCity("c1", "c2");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("different regions");
  });

  it("repoints addresses and tombstones the loser on a valid merge", async () => {
    mockAdmin();
    vi.mocked(prisma.city.findUnique)
      .mockResolvedValueOnce({ id: "c1", regionId: "r1", name: "Calfornia City" } as never)
      .mockResolvedValueOnce({ id: "c2", regionId: "r1" } as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma)) as never,
    );

    const result = await mergeCity("c1", "c2");

    expect(result.ok).toBe(true);
    expect(prisma.address.updateMany).toHaveBeenCalledWith({
      where: { cityId: "c1" },
      data: { cityId: "c2" },
    });
    expect(prisma.city.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "superseded", mergedIntoId: "c2" },
    });
  });

  it("previewCityMerge reports the address impact without mutating", async () => {
    mockAdmin();
    vi.mocked(prisma.city.findUnique)
      .mockResolvedValueOnce({ id: "c1", regionId: "r1", name: "Calfornia City" } as never)
      .mockResolvedValueOnce({ id: "c2", regionId: "r1", name: "California City" } as never);
    vi.mocked(prisma.address.count).mockResolvedValue(3 as never);

    const result = await previewCityMerge("c1", "c2");

    expect(result.ok).toBe(true);
    expect(result.impact).toEqual({ citiesRepointed: 0, citiesMerged: 1, addressesAffected: 3 });
    expect(prisma.address.updateMany).not.toHaveBeenCalled();
    expect(prisma.city.update).not.toHaveBeenCalled();
  });
});

describe("region merge", () => {
  it("rejects cross-country region merges", async () => {
    mockAdmin();
    vi.mocked(prisma.region.findUnique)
      .mockResolvedValueOnce({ id: "r1", countryId: "us", name: "Calfornia" } as never)
      .mockResolvedValueOnce({ id: "r2", countryId: "ca", name: "California" } as never);

    const result = await mergeRegion("r1", "r2");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("different countries");
  });

  it("repoints non-colliding cities, merges colliding ones, and tombstones the loser region", async () => {
    mockAdmin();
    vi.mocked(prisma.region.findUnique)
      .mockResolvedValueOnce({ id: "r1", countryId: "us", name: "Calfornia" } as never)
      .mockResolvedValueOnce({ id: "r2", countryId: "us" } as never);
    // loser cities: "san francisco" collides with survivor; "fresno" does not
    vi.mocked(prisma.city.findMany)
      .mockResolvedValueOnce([
        { id: "lc1", nameNormalized: "san francisco" },
        { id: "lc2", nameNormalized: "fresno" },
      ] as never)
      .mockResolvedValueOnce([{ id: "sc1", nameNormalized: "san francisco" }] as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma)) as never,
    );

    const result = await mergeRegion("r1", "r2");

    expect(result.ok).toBe(true);
    // colliding city merged into survivor city
    expect(prisma.address.updateMany).toHaveBeenCalledWith({
      where: { cityId: "lc1" },
      data: { cityId: "sc1" },
    });
    expect(prisma.city.update).toHaveBeenCalledWith({
      where: { id: "lc1" },
      data: { status: "superseded", mergedIntoId: "sc1" },
    });
    // non-colliding city repointed to survivor region
    expect(prisma.city.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["lc2"] } },
      data: { regionId: "r2" },
    });
    // loser region tombstoned
    expect(prisma.region.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { status: "superseded", mergedIntoId: "r2" },
    });
  });
});
