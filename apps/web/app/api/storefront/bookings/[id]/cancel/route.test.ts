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

vi.mock("@dpf/db", () => {
  const prisma = {
    storefrontBooking: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(prisma),
    ),
  };
  return { prisma };
});

vi.mock("@/lib/products/product-sold-commercial-persistence", () => ({
  transitionProductSoldByEvidence: vi.fn(),
}));

vi.mock("@/lib/storefront/hospitality-capacity-repository.server", () => ({
  releaseHospitalityCapacityByDemand: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { releaseHospitalityCapacityByDemand } from "@/lib/storefront/hospitality-capacity-repository.server";
import { POST } from "./route";

describe("restaurant booking cancellation capacity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.storefrontBooking.findUnique).mockResolvedValue({
      id: "booking-1",
      bookingRef: "BK-1",
      organizationId: "org-1",
      status: "confirmed",
    } as never);
  });

  it("cancels the booking and releases its structured allocation atomically", async () => {
    const response = (await POST(
      { json: vi.fn(async () => ({ reason: "Guest cancelled" })) } as never,
      { params: Promise.resolve({ id: "booking-1" }) },
    )) as unknown as { status: number };

    expect(response.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(releaseHospitalityCapacityByDemand).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        demandType: "booking",
        demandRef: "BK-1",
        reason: "Guest cancelled",
      }),
    );
  });
});
