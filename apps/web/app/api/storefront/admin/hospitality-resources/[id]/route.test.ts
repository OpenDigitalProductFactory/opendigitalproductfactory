import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { type: "admin" } })),
}));

vi.mock("@/lib/shared/new-id", () => ({
  newId: vi.fn(() => "fixture-id"),
}));

vi.mock("@dpf/db", () => {
  const prisma = {
    hospitalityResource: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    hospitalityResourceAvailability: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    providerAvailability: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    serviceProvider: { update: vi.fn() },
    $transaction: vi.fn(
      async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback(prisma),
    ),
  };
  return { prisma };
});

import { prisma } from "@dpf/db";
import { PUT } from "./route";

function request(body: Record<string, unknown>) {
  return { json: vi.fn(async () => body) };
}

const routeContext = { params: Promise.resolve({ id: "resource-1" }) };

describe("hospitality resource schedule management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.hospitalityResource.findFirst).mockResolvedValue({
      id: "resource-1",
      organizationId: "org-1",
      legacyServiceProviderId: "provider-1",
    } as never);
    vi.mocked(
      prisma.hospitalityResourceAvailability.deleteMany,
    ).mockResolvedValue({ count: 0 } as never);
    vi.mocked(
      prisma.hospitalityResourceAvailability.createMany,
    ).mockResolvedValue({ count: 2 } as never);
    vi.mocked(prisma.providerAvailability.deleteMany).mockResolvedValue({
      count: 0,
    } as never);
    vi.mocked(prisma.providerAvailability.createMany).mockResolvedValue({
      count: 2,
    } as never);
    vi.mocked(prisma.hospitalityResource.findUnique).mockResolvedValue({
      id: "resource-1",
      resourceId: "HR-1",
      label: "Aster",
      kind: "table",
      status: "active",
      capacity: 4,
      capacityUnit: "seats",
      serviceArea: "Dining room",
      blockedReason: null,
      version: 1,
      availability: [
        {
          id: "availability-1",
          days: [5, 6],
          startTime: "17:00",
          endTime: "22:00",
          date: null,
          kind: "available",
          reason: null,
        },
      ],
    } as never);
  });

  it("writes authoritative table availability and the slot-engine compatibility projection atomically", async () => {
    const response = (await PUT(
      request({
        availability: [
          { days: [5, 6], startTime: "17:00", endTime: "22:00" },
        ],
        exceptions: [
          {
            date: "2026-08-01",
            isBlocked: true,
            startTime: "00:00",
            endTime: "23:59",
            reason: "Private event",
          },
        ],
      }) as never,
      routeContext,
    )) as unknown as {
      status: number;
      body: { resource: { availability: unknown[] } };
    };

    expect(response.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(
      prisma.hospitalityResourceAvailability.createMany,
    ).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          organizationId: "org-1",
          resourceId: "resource-1",
          kind: "available",
          days: [5, 6],
        }),
        expect.objectContaining({
          organizationId: "org-1",
          resourceId: "resource-1",
          kind: "blocked",
          reason: "Private event",
        }),
      ]),
    });
    expect(prisma.providerAvailability.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          providerId: "provider-1",
          days: [5, 6],
          isBlocked: false,
        }),
        expect.objectContaining({
          providerId: "provider-1",
          isBlocked: true,
          reason: "Private event",
        }),
      ]),
    });
    expect(response.body.resource.availability).toEqual([
      expect.objectContaining({ isBlocked: false, days: [5, 6] }),
    ]);
  });

  it("rejects invalid or reversed availability windows before opening a transaction", async () => {
    const response = (await PUT(
      request({
        availability: [
          { days: [5], startTime: "22:00", endTime: "17:00" },
        ],
        exceptions: [],
      }) as never,
      routeContext,
    )) as unknown as {
      status: number;
      body: { code: string; message: string };
    };

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: "INVALID_ARGUMENT",
      message: "Valid weekly availability and dated exceptions are required",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
