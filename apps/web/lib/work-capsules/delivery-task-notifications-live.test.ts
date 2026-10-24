import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    workroom: { findMany: mocks.findMany },
    notification: { findFirst: vi.fn(), createMany: vi.fn() },
  },
}));
vi.mock("@/lib/attention/notify-live", () => ({
  resolveOperatorRecipient: vi.fn(),
}));
vi.mock("@/lib/tak/agent-event-bus", () => ({
  agentEventBus: { broadcastSystem: vi.fn() },
}));

import { reconcileDeliveryTaskNotificationsLive } from "./delivery-task-notifications-live";

describe("live delivery task notification selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
  });

  it("selects recently expired envelopes even when their Workroom and TaskRun are old", async () => {
    const now = new Date("2026-09-04T12:00:00.000Z");

    await reconcileDeliveryTaskNotificationsLive(now);

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{
          taskRun: {
            actionEnvelopes: {
              some: {
                status: { in: ["proposed", "approved"] },
                expiresAt: {
                  gte: new Date("2026-09-04T11:30:00.000Z"),
                  lte: now,
                },
              },
            },
          },
        }]),
      }),
      take: 100,
    }));
  });
});
