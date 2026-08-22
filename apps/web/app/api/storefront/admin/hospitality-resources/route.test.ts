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
    hospitalityResource: { findMany: vi.fn(), create: vi.fn() },
    resource: { findMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(
      async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback(prisma),
    ),
  };
  return { prisma };
});

import { prisma } from "@dpf/db";
import { GET, POST } from "./route";

const restaurantActivationProfile = {
  profileType: "standard",
  modules: [],
  billingReadinessMode: "none",
  customerGraph: "none",
  estateSeparation: "shared",
  processProfile: {
    catalogModes: ["priced"],
    subjectTypes: [],
    housesSubjects: false,
    schedulesSubjects: false,
    resourceKinds: [
      { kindSlug: "table", capacityUnit: "seats", maxCapacity: 100 },
    ],
  },
};

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
      timezone: "UTC",
      archetype: { activationProfile: restaurantActivationProfile },
    } as never);
    vi.mocked(prisma.serviceProvider.create).mockResolvedValue({
      id: "provider-1",
    } as never);
    vi.mocked(prisma.hospitalityResource.create).mockResolvedValue({
      id: "table-1",
      resourceId: "HR-1",
      organizationId: "organization-1",
      storefrontId: "storefront-1",
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
      legacyServiceProviderId: "provider-1",
    } as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.resource.upsert).mockResolvedValue({ id: "canonical-1" } as never);
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
    expect(prisma.resource.upsert).toHaveBeenCalledWith({
      where: { sourceRef: "HospitalityResource:table-1" },
      create: expect.objectContaining({
        domain: "hospitality",
        kindSlug: "table",
        capacityUnit: "seats",
        sourceRef: "HospitalityResource:table-1",
      }),
      update: expect.objectContaining({
        label: "Aster",
        capacity: 4,
        capacityUnit: "seats",
      }),
    });
  });

  it("prefers canonical resource values while retaining the legacy public id", async () => {
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      id: "storefront-1",
      organizationId: "organization-1",
      timezone: "UTC",
      archetype: { activationProfile: restaurantActivationProfile },
    } as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([
      {
        id: "canonical-1",
        resourceKey: "HR-1",
        label: "Aster canonical",
        kindSlug: "table",
        lifecycle: "active",
        capacity: 6,
        capacityUnit: "seats",
        serviceArea: "Main dining",
        blockedReason: null,
        attributes: { shape: "round" },
        sourceRef: "HospitalityResource:table-1",
        version: 2,
        availability: [],
      },
    ] as never);
    vi.mocked(prisma.hospitalityResource.findMany).mockResolvedValue([
      {
        id: "table-1",
        resourceId: "HR-1",
        label: "Aster legacy",
        kind: "table",
        status: "active",
        capacity: 4,
        capacityUnit: "seats",
        serviceArea: "Main dining",
        blockedReason: null,
        attributes: { shape: "round" },
        version: 1,
        availability: [],
      },
    ] as never);

    const response = (await GET()) as unknown as {
      status: number;
      body: { resources: Array<{ id: string; label: string; capacity: number }> };
    };

    expect(response.status).toBe(200);
    expect(response.body.resources).toEqual([
      expect.objectContaining({
        id: "table-1",
        label: "Aster canonical",
        capacity: 6,
      }),
    ]);
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
