import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    employeeAddress: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { getEmployeeAddresses } from "./address-data";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getEmployeeAddresses
// ---------------------------------------------------------------------------
describe("getEmployeeAddresses", () => {
  it("returns addresses with full geographic hierarchy", async () => {
    const mockData = [
      {
        id: "ea-1",
        isPrimary: true,
        createdAt: new Date("2026-01-01"),
        address: {
          id: "addr-1",
          label: "home",
          addressLine1: "123 Main St",
          addressLine2: null,
          postalCode: "2000",
          status: "active",
          city: {
            id: "city-1",
            name: "Sydney",
            region: {
              id: "region-1",
              name: "New South Wales",
              country: {
                id: "country-1",
                name: "Australia",
                iso2: "AU",
                phoneCode: "+61",
              },
            },
          },
        },
      },
      {
        id: "ea-2",
        isPrimary: false,
        createdAt: new Date("2026-02-01"),
        address: {
          id: "addr-2",
          label: "work",
          addressLine1: "456 Office Blvd",
          addressLine2: "Level 10",
          postalCode: "3000",
          status: "active",
          city: {
            id: "city-2",
            name: "Melbourne",
            region: {
              id: "region-2",
              name: "Victoria",
              country: {
                id: "country-1",
                name: "Australia",
                iso2: "AU",
                phoneCode: "+61",
              },
            },
          },
        },
      },
    ];
    vi.mocked(prisma.employeeAddress.findMany).mockResolvedValue(mockData as any);

    const result = await getEmployeeAddresses("emp-1");

    expect(result).toEqual(mockData);
    expect(result).toHaveLength(2);
    expect(result[0].isPrimary).toBe(true);
    expect(result[0].address.city.region.country.iso2).toBe("AU");
    expect(prisma.employeeAddress.findMany).toHaveBeenCalledWith({
      where: {
        employeeProfileId: "emp-1",
        address: { status: "active" },
      },
      include: {
        address: {
          include: {
            city: {
              include: {
                region: {
                  include: {
                    country: {
                      select: { id: true, name: true, iso2: true, phoneCode: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
  });

  it("returns empty array when no addresses exist", async () => {
    vi.mocked(prisma.employeeAddress.findMany).mockResolvedValue([]);

    const result = await getEmployeeAddresses("emp-no-addr");

    expect(result).toEqual([]);
  });
});
