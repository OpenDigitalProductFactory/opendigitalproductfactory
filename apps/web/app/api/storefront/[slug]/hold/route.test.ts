import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: unknown }) => ({
      body,
      status: init?.status ?? 200,
      headers: {
        set: vi.fn(),
      },
    }),
  },
}));

vi.mock("@dpf/db", () => {
  const prisma = {
    storefrontConfig: { findFirst: vi.fn() },
    storefrontItem: { findFirst: vi.fn() },
    bookingHold: {
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(prisma),
    ),
  };
  return { prisma };
});

vi.mock("@/lib/storefront/hospitality-capacity-repository.server", () => ({
  allocateHospitalityCapacity: vi.fn(),
  resolveHospitalityResourceForProvider: vi.fn(),
}));

import { prisma } from "@dpf/db";
import {
  allocateHospitalityCapacity,
  resolveHospitalityResourceForProvider,
} from "@/lib/storefront/hospitality-capacity-repository.server";
import { POST } from "./route";

function request(body: Record<string, unknown>) {
  return {
    json: vi.fn(async () => body),
    headers: { get: vi.fn(() => null) },
  };
}

describe("restaurant booking hold capacity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      id: "storefront-1",
      organizationId: "org-1",
      archetype: { archetypeId: "restaurant" },
    } as never);
    vi.mocked(prisma.bookingHold.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.storefrontItem.findFirst).mockResolvedValue({
      id: "item-1",
    } as never);
    vi.mocked(resolveHospitalityResourceForProvider).mockResolvedValue({
      id: "table-1",
      legacyServiceProviderId: "provider-1",
      status: "active",
    });
    vi.mocked(prisma.bookingHold.create).mockResolvedValue({
      id: "hold-1",
      holderToken: "token-1",
      expiresAt: new Date("2026-07-30T18:10:00.000Z"),
    } as never);
  });

  it("returns the canonical API error envelope for invalid hold requests", async () => {
    const response = (await POST(request({}) as never, {
      params: Promise.resolve({ slug: "restaurant" }),
    })) as unknown as {
      body: { code: string; message: string };
      status: number;
    };

    expect(response).toMatchObject({
      status: 400,
      body: {
        code: "INVALID_ARGUMENT",
        message: "itemId, slotStart, and slotEnd are required",
      },
    });
  });

  it("creates the hold and structured capacity allocation in one transaction", async () => {
    const response = (await POST(
      request({
        itemId: "item-1",
        providerId: "provider-1",
        slotStart: "2026-07-30T18:00:00.000Z",
        slotEnd: "2026-07-30T19:00:00.000Z",
      }) as never,
      { params: Promise.resolve({ slug: "restaurant" }) },
    )) as unknown as { body: unknown; status: number };

    expect(response.status).toBe(201);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.bookingHold.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        storefrontId: "storefront-1",
        providerId: "provider-1",
        hospitalityResourceId: "table-1",
      }),
      select: { id: true, holderToken: true, expiresAt: true },
    });
    expect(allocateHospitalityCapacity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        storefrontId: "storefront-1",
        resourceId: "table-1",
        bookingHoldId: "hold-1",
        demandType: "hold",
        demandRef: "token-1",
      }),
    );
  });

  it("does not use the raceable preflight hold query for structured resources", async () => {
    await POST(
      request({
        itemId: "item-1",
        providerId: "provider-1",
        slotStart: "2026-07-30T18:00:00.000Z",
        slotEnd: "2026-07-30T19:00:00.000Z",
      }) as never,
      { params: Promise.resolve({ slug: "restaurant" }) },
    );
    expect(prisma.bookingHold.findFirst).not.toHaveBeenCalled();
  });

  it("refuses a Restaurant hold when the provider is not a table resource", async () => {
    vi.mocked(resolveHospitalityResourceForProvider).mockResolvedValue(null);

    const response = (await POST(
      request({
        itemId: "item-1",
        providerId: "generic-provider",
        slotStart: "2026-07-30T18:00:00.000Z",
        slotEnd: "2026-07-30T19:00:00.000Z",
      }) as never,
      { params: Promise.resolve({ slug: "restaurant" }) },
    )) as unknown as {
      body: { code: string; message: string };
      status: number;
    };

    expect(response).toEqual(expect.objectContaining({
      status: 409,
      body: {
        code: "CAPACITY_CONFIGURATION_REQUIRED",
        message: "That table is not available for reservations. Please choose another time.",
      },
    }));
    expect(prisma.bookingHold.create).not.toHaveBeenCalled();
  });

  it("refuses a Restaurant hold when no table provider is selected", async () => {
    const response = (await POST(
      request({
        itemId: "item-1",
        slotStart: "2026-07-30T18:00:00.000Z",
        slotEnd: "2026-07-30T19:00:00.000Z",
      }) as never,
      { params: Promise.resolve({ slug: "restaurant" }) },
    )) as unknown as {
      body: { code: string; message: string };
      status: number;
    };

    expect(response).toEqual(expect.objectContaining({
      status: 409,
      body: {
        code: "CAPACITY_CONFIGURATION_REQUIRED",
        message: "That table is not available for reservations. Please choose another time.",
      },
    }));
    expect(prisma.bookingHold.create).not.toHaveBeenCalled();
  });
});
