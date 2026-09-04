import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { type: "admin" } })) }));
vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: { findFirst: vi.fn() },
    resource: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  },
}));

import { prisma } from "@dpf/db";
import { GET, POST } from "./route";

const activationProfile = {
  profileType: "standard",
  modules: [],
  billingReadinessMode: "none",
  customerGraph: "none",
  estateSeparation: "shared",
  processProfile: {
    catalogModes: ["donation"],
    subjectTypes: ["animal"],
    housesSubjects: true,
    schedulesSubjects: true,
    resourceKinds: [
      { kindSlug: "kennel", capacityUnit: "animals", maxCapacity: 100 },
      { kindSlug: "foster-home", capacityUnit: "animals", maxCapacity: 12 },
    ],
  },
};

describe("housing resource route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      id: "storefront-1",
      organizationId: "org-1",
      archetype: { activationProfile },
    } as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.resource.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.resource.create).mockResolvedValue({
      id: "foster-1",
      kindSlug: "foster-home",
      label: "Northside foster",
      capacity: 2,
      capacityUnit: "animals",
      serviceArea: "Northside",
      blockedReason: null,
      lifecycle: "active",
      version: 1,
    } as never);
  });

  it("lists resources using the active server-side organization", async () => {
    const response = (await GET()) as unknown as { status: number };
    expect(response.status).toBe(200);
    expect(prisma.resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) }),
    );
  });

  it("ignores caller authority and creates against the active organization", async () => {
    const response = (await POST({
      json: async () => ({
        organizationId: "attacker-org",
        label: "Northside foster",
        kindSlug: "foster-home",
        capacity: 2,
        serviceArea: "Northside",
        idempotencyKey: "setup:northside",
      }),
    } as never)) as unknown as { status: number };
    expect(response.status).toBe(201);
    expect(prisma.resource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: "org-1" }),
      select: expect.any(Object),
    });
  });
});
