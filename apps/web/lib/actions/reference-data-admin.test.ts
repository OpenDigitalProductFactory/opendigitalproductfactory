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
    country: { findUnique: vi.fn(), update: vi.fn() },
    region: { findUnique: vi.fn(), update: vi.fn() },
    city: { findUnique: vi.fn(), update: vi.fn() },
    address: { create: vi.fn(), update: vi.fn() },
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
      data: { name: "Sydney" },
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
