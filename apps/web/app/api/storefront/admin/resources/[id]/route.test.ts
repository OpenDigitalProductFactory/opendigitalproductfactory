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
import { PATCH } from "./route";

describe("housing resource update route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      organizationId: "org-1",
      archetype: {
        activationProfile: {
          profileType: "standard",
          modules: [],
          billingReadinessMode: "none",
          customerGraph: "none",
          estateSeparation: "shared",
          processProfile: {
            catalogModes: ["donation"], subjectTypes: ["animal"], housesSubjects: true,
            schedulesSubjects: true,
            resourceKinds: [{ kindSlug: "kennel", capacityUnit: "animals", maxCapacity: 100 }],
          },
        },
      },
    } as never);
    vi.mocked(prisma.resource.findFirst).mockResolvedValue({
      id: "kennel-1", organizationId: "org-1", domain: "care", kindSlug: "kennel",
      label: "D1", capacity: 1, capacityUnit: "animals", serviceArea: "Dog ward",
      blockedReason: null, lifecycle: "active", version: 2,
    } as never);
    vi.mocked(prisma.resource.updateMany).mockResolvedValue({ count: 0 } as never);
  });

  it("returns a stable 409 code for an optimistic version conflict", async () => {
    const response = (await PATCH(
      { json: async () => ({ expectedVersion: 1, label: "D1 clean", idempotencyKey: "rename" }) } as never,
      { params: Promise.resolve({ id: "kennel-1" }) },
    )) as unknown as { status: number; body: { code: string } };
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("resource_conflict");
  });
});
