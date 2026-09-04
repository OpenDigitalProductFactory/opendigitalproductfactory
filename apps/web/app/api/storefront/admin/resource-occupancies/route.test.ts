import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { type: "admin" } })) }));
vi.mock("@dpf/db", () => ({ prisma: { storefrontConfig: { findFirst: vi.fn() } } }));
vi.mock("@/lib/resource-scheduling/resource-occupancy", () => ({
  OccupancyCommandError: class OccupancyCommandError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
  placeResourceOccupant: vi.fn(),
  releaseResourceOccupant: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { placeResourceOccupant } from "@/lib/resource-scheduling/resource-occupancy";
import { POST } from "./route";

describe("housing occupancy route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.storefrontConfig.findFirst).mockResolvedValue({
      organizationId: "org-1",
      archetype: {
        activationProfile: {
          profileType: "standard", modules: [], billingReadinessMode: "none",
          customerGraph: "none", estateSeparation: "shared",
          processProfile: {
            catalogModes: ["donation"], subjectTypes: ["animal"], housesSubjects: true,
            schedulesSubjects: true,
            resourceKinds: [
              { kindSlug: "kennel", capacityUnit: "animals", maxCapacity: 100 },
              { kindSlug: "foster-home", capacityUnit: "animals", maxCapacity: 12 },
            ],
          },
        },
      },
    } as never);
    vi.mocked(placeResourceOccupant).mockResolvedValue({ allocationId: "allocation-1" } as never);
  });

  it("derives organization and allowed housing kinds before placing", async () => {
    const response = (await POST({
      json: async () => ({
        action: "place", animalRef: "animal-1", destinationResourceId: "foster-1",
        placedAt: "2026-09-04T12:00:00.000Z", idempotencyKey: "move-1",
      }),
    } as never)) as unknown as { status: number };
    expect(response.status).toBe(200);
    expect(placeResourceOccupant).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      allowedKinds: ["kennel", "foster-home"],
    }));
  });
});
