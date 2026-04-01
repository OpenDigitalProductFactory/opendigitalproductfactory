import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: { findFirst: vi.fn() },
    address: { update: vi.fn(), findUnique: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { validateAddress } from "./address-validation";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// validateAddress
// ---------------------------------------------------------------------------
describe("validateAddress", () => {
  it("returns no-service when no geocoding service registered", async () => {
    vi.mocked(prisma.modelProvider.findFirst).mockResolvedValue(null);
    const result = await validateAddress("a1");
    expect(result).toEqual({ status: "no-service" });
  });

  it("queries modelProvider with correct filter criteria", async () => {
    vi.mocked(prisma.modelProvider.findFirst).mockResolvedValue(null);
    await validateAddress("a1");

    expect(prisma.modelProvider.findFirst).toHaveBeenCalledWith({
      where: {
        endpointType: "service",
        status: "active",
        OR: [
          { name: { contains: "geocod", mode: "insensitive" } },
          { name: { contains: "places", mode: "insensitive" } },
          { name: { contains: "mapbox", mode: "insensitive" } },
        ],
      },
    });
  });

  it("returns error when address is not found", async () => {
    vi.mocked(prisma.modelProvider.findFirst).mockResolvedValue({
      id: "mp-1",
      providerId: "geocoding-svc",
      name: "Geocoding Service",
      endpointType: "service",
      status: "active",
    } as any);
    vi.mocked(prisma.address.findUnique).mockResolvedValue(null);

    const result = await validateAddress("missing-addr");
    expect(result).toEqual({ status: "error", message: "Address not found" });
  });

  it("returns no-service placeholder when service exists but no API integration yet", async () => {
    vi.mocked(prisma.modelProvider.findFirst).mockResolvedValue({
      id: "mp-1",
      providerId: "geocoding-svc",
      name: "Geocoding Service",
      endpointType: "service",
      status: "active",
    } as any);
    vi.mocked(prisma.address.findUnique).mockResolvedValue({
      id: "addr-1",
      label: "home",
      addressLine1: "123 Main St",
      postalCode: "12345",
      city: {
        id: "city-1",
        name: "Springfield",
        region: {
          id: "reg-1",
          name: "Illinois",
          code: "IL",
          country: { id: "c-1", name: "United States", iso2: "US", phoneCode: "+1" },
        },
      },
    } as any);

    const result = await validateAddress("addr-1");
    // Currently returns no-service as placeholder until MCP integration is wired
    expect(result).toEqual({ status: "no-service" });
  });
});
