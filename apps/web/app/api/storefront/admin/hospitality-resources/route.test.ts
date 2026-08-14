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
    storefrontConfig: { findFirst: vi.fn() },
    serviceProvider: { create: vi.fn() },
    providerService: { createMany: vi.fn() },
    hospitalityResource: { create: vi.fn() },
    $transaction: vi.fn(
      async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback(prisma),
    ),
  };
  return { prisma };
});

import { prisma } from "@dpf/db";
import { POST } from "./route";

function request(body: Record<string, unknown>) {
  return { json: vi.fn(async () => body) };
}

describe("hospitality table creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      id: "storefront-1",
      organizationId: "organization-1",
      items: [],
    } as never);
    vi.mocked(prisma.serviceProvider.create).mockResolvedValue({
      id: "provider-1",
    } as never);
    vi.mocked(prisma.hospitalityResource.create).mockResolvedValue({
      id: "table-1",
      resourceId: "HR-1",
      label: "Aster",
      kind: "table",
      status: "active",
      capacity: 4,
      capacityUnit: "seats",
      serviceArea: "Main dining",
      blockedReason: null,
      attributes: {
        shape: "booth",
        combinationGroup: "main-banquette",
      },
      version: 1,
    } as never);
  });

  it("persists validated table shape and combination structure", async () => {
    const response = (await POST(
      request({
        storefrontId: "storefront-1",
        label: "Aster",
        capacity: 4,
        serviceArea: "Main dining",
        shape: "booth",
        combinationGroup: "main-banquette",
        combinableWith: [],
      }) as never,
    )) as unknown as {
      status: number;
      body: { resource: { attributes: unknown } };
    };

    expect(response.status).toBe(201);
    expect(prisma.hospitalityResource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attributes: {
          shape: "booth",
          combinationGroup: "main-banquette",
          bookingAccess: "online",
        },
      }),
      select: expect.objectContaining({ attributes: true }),
    });
    expect(response.body.resource.attributes).toEqual({
      shape: "booth",
      combinationGroup: "main-banquette",
    });
  });

  it("rejects an unsupported shape before creating compatibility records", async () => {
    const response = (await POST(
      request({
        storefrontId: "storefront-1",
        label: "Aster",
        capacity: 4,
        shape: "starburst",
      }) as never,
    )) as unknown as {
      status: number;
      body: { code: string; message: string };
    };

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Choose a supported table shape.");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
