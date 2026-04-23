import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontItem: { findFirst: vi.fn() },
    serviceProvider: { findMany: vi.fn() },
    providerAvailability: { findMany: vi.fn() },
    storefrontBooking: { findMany: vi.fn() },
    bookingHold: { findMany: vi.fn() },
  },
}));

vi.mock("@dpf/validators", () => ({
  bookingConfigSchema: {
    safeParse: (data: unknown) => ({ success: true, data }),
  },
}));

import { computeAvailableSlots, getAvailableDates } from "./compute-slots";
import { prisma } from "@dpf/db";

const mockItem = {
  id: "item-1",
  itemId: "itm-abc",
  storefrontId: "sf-1",
  bookingConfig: {
    durationMinutes: 45,
    schedulingPattern: "slot",
    assignmentMode: "next-available",
  },
  storefront: { timezone: "Europe/London", id: "sf-1" },
};

const mockProvider = {
  id: "prov-1",
  providerId: "SP-0001",
  name: "Alice",
  avatarUrl: null,
  priority: 0,
  weight: 100,
  isActive: true,
};

function nextWeekdayIso(targetWeekday: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  const today = date.getUTCDay();
  let delta = (targetWeekday - today + 7) % 7;
  if (delta === 0) {
    delta = 7;
  }
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

describe("computeAvailableSlots", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns slots for next-available mode", async () => {
    vi.mocked(prisma.storefrontItem.findFirst).mockResolvedValue(mockItem as never);
    vi.mocked(prisma.serviceProvider.findMany).mockResolvedValue([mockProvider] as never);
    vi.mocked(prisma.providerAvailability.findMany).mockResolvedValue([
      { days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", date: null, isBlocked: false },
    ] as never);
    // Note: storefrontBooking.findMany is called twice — once for busy periods on the target date,
    // once for weekly booking counts (round-robin). Mock both calls returning empty.
    vi.mocked(prisma.storefrontBooking.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.bookingHold.findMany).mockResolvedValue([] as never);

    const result = await computeAvailableSlots("itm-abc", nextWeekdayIso(1)); // next Monday
    expect(result.mode).toBe("next-available");
    if (result.mode === "next-available") {
      expect(result.slots.length).toBeGreaterThan(0);
      const first = result.slots[0];
      expect(first?.startTime).toBe("09:00");
      expect(first?.providerId).toBe("prov-1");
    }
  });

  it("returns error when item not found", async () => {
    vi.mocked(prisma.storefrontItem.findFirst).mockResolvedValue(null as never);
    await expect(computeAvailableSlots("missing", nextWeekdayIso(1))).rejects.toThrow("Item not found");
  });

  it("returns empty slots when no providers", async () => {
    vi.mocked(prisma.storefrontItem.findFirst).mockResolvedValue(mockItem as never);
    vi.mocked(prisma.serviceProvider.findMany).mockResolvedValue([] as never);

    const result = await computeAvailableSlots("itm-abc", nextWeekdayIso(1));
    if (result.mode === "next-available") {
      expect(result.slots).toEqual([]);
    }
  });
});

describe("getAvailableDates", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns dates that have at least one provider with availability", async () => {
    vi.mocked(prisma.storefrontItem.findFirst).mockResolvedValue(mockItem as never);
    vi.mocked(prisma.serviceProvider.findMany).mockResolvedValue([mockProvider] as never);
    vi.mocked(prisma.providerAvailability.findMany).mockResolvedValue([
      { days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", date: null, isBlocked: false },
    ] as never);
    vi.mocked(prisma.storefrontBooking.findMany).mockResolvedValue([] as never);

    const dates = await getAvailableDates("itm-abc", "2026-03");
    expect(dates.length).toBeGreaterThan(15);
    const weekendDates = dates.filter((d) => {
      const day = new Date(d).getUTCDay();
      return day === 0 || day === 6;
    });
    expect(weekendDates).toEqual([]);
  });
});
