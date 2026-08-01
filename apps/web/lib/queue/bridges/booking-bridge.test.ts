import { describe, it, expect, vi, beforeEach } from "vitest";

const { storefrontBooking, storefrontItem, workItem, workQueue, recordQueueTransition } = vi.hoisted(() => ({
  storefrontBooking: { findUnique: vi.fn() },
  storefrontItem: { findUnique: vi.fn() },
  workItem: { findFirst: vi.fn(), create: vi.fn() },
  workQueue: { upsert: vi.fn() },
  recordQueueTransition: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: { storefrontBooking, storefrontItem, workItem, workQueue },
}));
vi.mock("@/lib/queue/queue-telemetry", () => ({ recordQueueTransition }));

import { bridgeBookingToWorkItem, dispatchQueueId } from "./booking-bridge";

const confirmedBooking = {
  id: "bk-1",
  bookingRef: "BK-abc123",
  storefrontId: "sf-1",
  itemId: "item-1",
  customerName: "Dana Rivera",
  scheduledAt: new Date("2026-07-08T14:00:00Z"),
  durationMinutes: 90,
  status: "confirmed",
  providerId: "sp-1",
  notes: "Gate code 4421",
  provider: { name: "Alex the HVAC tech" },
};

beforeEach(() => {
  storefrontBooking.findUnique.mockReset();
  storefrontItem.findUnique.mockReset();
  workItem.findFirst.mockReset();
  workItem.create.mockReset();
  workQueue.upsert.mockReset();
  recordQueueTransition.mockReset();
});

describe("dispatchQueueId", () => {
  it("is a stable per-storefront id", () => {
    expect(dispatchQueueId("sf-1")).toBe("dispatch-sf-1");
  });
});

describe("bridgeBookingToWorkItem", () => {
  it("returns null for a booking that is not confirmed", async () => {
    storefrontBooking.findUnique.mockResolvedValue({ ...confirmedBooking, status: "pending" });
    expect(await bridgeBookingToWorkItem("bk-1")).toBeNull();
    expect(workItem.create).not.toHaveBeenCalled();
  });

  it("returns null for a confirmed booking with no provider assigned", async () => {
    storefrontBooking.findUnique.mockResolvedValue({ ...confirmedBooking, providerId: null });
    expect(await bridgeBookingToWorkItem("bk-1")).toBeNull();
    expect(workItem.create).not.toHaveBeenCalled();
  });

  it("is idempotent — returns the existing live job WorkItem", async () => {
    storefrontBooking.findUnique.mockResolvedValue(confirmedBooking);
    workItem.findFirst.mockResolvedValue({ itemId: "WI-existing" });
    expect(await bridgeBookingToWorkItem("bk-1")).toBe("WI-existing");
    expect(workItem.create).not.toHaveBeenCalled();
    expect(recordQueueTransition).not.toHaveBeenCalled();
  });

  it("creates a physical WorkItem in the dispatch queue with an enqueued transition", async () => {
    storefrontBooking.findUnique.mockResolvedValue(confirmedBooking);
    workItem.findFirst.mockResolvedValue(null);
    storefrontItem.findUnique.mockResolvedValue({ name: "AC Repair" });
    workQueue.upsert.mockResolvedValue({ id: "wq-dispatch", queueId: "dispatch-sf-1" });
    const created = { itemId: "WI-job", createdAt: new Date("2026-07-06T12:00:00Z") };
    workItem.create.mockResolvedValue(created);

    const id = await bridgeBookingToWorkItem("bk-1", "priority");
    expect(id).toBe("WI-job");

    // Queue upsert keyed on the stable per-storefront dispatch id.
    expect(workQueue.upsert.mock.calls[0]![0].where).toEqual({ queueId: "dispatch-sf-1" });

    const data = workItem.create.mock.calls[0]![0].data;
    expect(data.sourceType).toBe("field-service-job");
    expect(data.sourceId).toBe("bk-1");
    expect(data.effortClass).toBe("physical");
    expect(data.urgency).toBe("priority");
    expect(data.queueId).toBe("wq-dispatch");
    expect(data.status).toBe("confirmed");
    expect(data.dueAt).toEqual(confirmedBooking.scheduledAt);
    expect(data.title).toContain("AC Repair");
    expect(data.title).toContain("Dana Rivera");
    expect(data.description).toContain("Alex the HVAC tech");

    const tel = recordQueueTransition.mock.calls[0]![0];
    expect(tel.queueKey).toBe("cwq:wq-dispatch");
    expect(tel.transition).toBe("enqueued");
    expect(tel.itemId).toBe("WI-job");
  });

  it("falls back to a generic service name when the item is missing", async () => {
    storefrontBooking.findUnique.mockResolvedValue(confirmedBooking);
    workItem.findFirst.mockResolvedValue(null);
    storefrontItem.findUnique.mockResolvedValue(null);
    workQueue.upsert.mockResolvedValue({ id: "wq", queueId: "dispatch-sf-1" });
    workItem.create.mockResolvedValue({ itemId: "WI-2", createdAt: new Date() });
    await bridgeBookingToWorkItem("bk-1");
    expect(workItem.create.mock.calls[0]![0].data.title).toContain("Service");
  });
});
