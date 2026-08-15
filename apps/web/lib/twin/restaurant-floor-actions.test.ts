import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findConfig: vi.fn(),
  findBooking: vi.fn(),
  createBooking: vi.fn(),
  findResource: vi.fn(),
  updateResource: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: { findFirst: mocks.findConfig },
    storefrontBooking: {
      findUnique: mocks.findBooking,
      create: mocks.createBooking,
    },
    hospitalityResource: {
      findFirst: mocks.findResource,
      updateMany: mocks.updateResource,
    },
  },
}));

import {
  createRestaurantWalkIn,
  setRestaurantTableBookingAccess,
} from "./restaurant-floor-actions";

describe("createRestaurantWalkIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: { id: "host-1", platformRole: "platform_admin", isSuperuser: true },
    });
    mocks.findConfig.mockResolvedValue({
      id: "storefront-1",
      organizationId: "org-1",
      items: [{ id: "booking-item-1" }],
    });
    mocks.findBooking.mockResolvedValue(null);
    mocks.createBooking.mockResolvedValue({ id: "booking-1", bookingRef: "BK-WALKIN1" });
    mocks.findResource.mockResolvedValue({
      id: "table-1",
      organizationId: "org-1",
      attributes: { shape: "round", bookingAccess: "online" },
      version: 4,
    });
    mocks.updateResource.mockResolvedValue({ count: 1 });
  });

  it("protects a table from external booking behind its resource version", async () => {
    await expect(setRestaurantTableBookingAccess({
      resourceId: "table-1",
      expectedVersion: 4,
      bookingAccess: "in-house",
      idempotencyKey: "table-access:fixture-1",
    })).resolves.toMatchObject({
      status: "confirmed",
      newVersion: "5",
      changedFacts: [{ entityId: "table-1", field: "bookingAccess", value: "in-house" }],
    });
    expect(mocks.updateResource).toHaveBeenCalledWith({
      where: { id: "table-1", organizationId: "org-1", version: 4 },
      data: {
        attributes: { shape: "round", bookingAccess: "in-house" },
        version: { increment: 1 },
      },
    });
  });

  it("creates a named waiting party without fabricating contact data", async () => {
    await expect(
      createRestaurantWalkIn({
        name: "  Riley Chen  ",
        covers: 3,
        idempotencyKey: "walk-in:fixture-1",
      }),
    ).resolves.toMatchObject({ ok: true, bookingId: "booking-1", replayed: false });

    expect(mocks.createBooking).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerName: "Riley Chen",
        customerEmail: null,
        customerPhone: null,
        covers: 3,
        demandKind: "walk-in",
        status: "waiting",
        scheduledAt: expect.any(Date),
      }),
      select: { id: true, bookingRef: true },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/workspace");
  });

  it("replays the same host operation without creating a duplicate", async () => {
    mocks.findBooking.mockResolvedValue({ id: "booking-1", bookingRef: "BK-WALKIN1" });

    await expect(
      createRestaurantWalkIn({ name: "Riley Chen", covers: 3, idempotencyKey: "walk-in:fixture-1" }),
    ).resolves.toMatchObject({ ok: true, replayed: true });
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it("rejects invalid party facts before writing", async () => {
    await expect(
      createRestaurantWalkIn({ name: "", covers: 0, idempotencyKey: "walk-in:fixture-2" }),
    ).resolves.toEqual({ ok: false, error: "Enter a party name and a party size from 1 to 30." });
    expect(mocks.findConfig).not.toHaveBeenCalled();
  });
});
