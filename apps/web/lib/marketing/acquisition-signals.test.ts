import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  storefrontBooking: { count: vi.fn() },
  storefrontInquiry: { count: vi.fn() },
  storefrontOrder: { count: vi.fn() },
  storefrontDonation: { count: vi.fn() },
  engagement: { groupBy: vi.fn() },
  opportunity: { groupBy: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));

import { loadAcquisitionSignals } from "./acquisition-signals";

beforeEach(() => {
  vi.clearAllMocks();
  db.storefrontBooking.count.mockResolvedValue(4);
  db.storefrontInquiry.count.mockResolvedValue(3);
  db.storefrontOrder.count.mockResolvedValue(2);
  db.storefrontDonation.count.mockResolvedValue(1);
  db.engagement.groupBy.mockResolvedValue([
    { status: "open", _count: 5 },
    { status: "closed", _count: 2 },
  ]);
  db.opportunity.groupBy.mockResolvedValue([{ stage: "qualified", _count: 3 }]);
});

describe("loadAcquisitionSignals", () => {
  it("totals every inbound demand type for the window", async () => {
    const signals = await loadAcquisitionSignals({ storefrontId: "sf-1", days: 30 });
    expect(signals.inbox).toEqual({
      days: 30,
      bookings: 4,
      inquiries: 3,
      orders: 2,
      donations: 1,
      total: 10,
    });
  });

  it("scopes each count to the storefront and the lookback window", async () => {
    await loadAcquisitionSignals({ storefrontId: "sf-1", days: 7 });
    for (const counter of [
      db.storefrontBooking.count,
      db.storefrontInquiry.count,
      db.storefrontOrder.count,
      db.storefrontDonation.count,
    ]) {
      expect(counter).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            storefrontId: "sf-1",
            createdAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        }),
      );
    }
  });

  it("projects the pipeline as status/stage keyed counts", async () => {
    const signals = await loadAcquisitionSignals({ storefrontId: "sf-1", days: 30 });
    expect(signals.pipeline.engagements).toEqual({ open: 5, closed: 2 });
    expect(signals.pipeline.opportunities).toEqual({ qualified: 3 });
  });

  it("reports zeroes rather than omitting a demand type when nothing arrived", async () => {
    db.storefrontBooking.count.mockResolvedValue(0);
    db.storefrontInquiry.count.mockResolvedValue(0);
    db.storefrontOrder.count.mockResolvedValue(0);
    db.storefrontDonation.count.mockResolvedValue(0);
    db.engagement.groupBy.mockResolvedValue([]);
    db.opportunity.groupBy.mockResolvedValue([]);

    const signals = await loadAcquisitionSignals({ storefrontId: "sf-1", days: 30 });
    expect(signals.inbox.total).toBe(0);
    expect(signals.pipeline).toEqual({ engagements: {}, opportunities: {} });
  });
});
