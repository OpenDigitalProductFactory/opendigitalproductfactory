import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deliveryAttemptCreate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    communicationDeliveryAttempt: { create: mocks.deliveryAttemptCreate },
  },
}));

import { recordDeliveryAttempt } from "./delivery-evidence";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deliveryAttemptCreate.mockResolvedValue({ attemptId: "attempt-1" });
});

describe("recordDeliveryAttempt", () => {
  it("persists target, urgency, provider id, and sent timestamp", async () => {
    await expect(
      recordDeliveryAttempt({
        channel: "in-app",
        target: {
          targetType: "work-item",
          targetId: "WI-1",
          recipientUserId: "user-1",
        },
        urgency: "priority",
        result: {
          channel: "in-app",
          status: "sent",
          providerMessageId: "notif-1",
        },
      }),
    ).resolves.toEqual({ attemptId: "attempt-1" });

    expect(mocks.deliveryAttemptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channelType: "in-app",
        targetType: "work-item",
        targetId: "WI-1",
        providerMessageId: "notif-1",
        status: "sent",
        urgency: "priority",
        errorCode: null,
        errorMessage: null,
        sentAt: expect.any(Date),
      }),
      select: { attemptId: true },
    });
  });

  it("persists failures with error details and without sent timestamp", async () => {
    await recordDeliveryAttempt({
      channel: "teams",
      target: { targetType: "agent-thread", targetId: "thread-1" },
      urgency: "urgent",
      result: {
        channel: "teams",
        status: "failed",
        errorCode: "adapter_not_registered",
        errorMessage: "No adapter.",
      },
    });

    expect(mocks.deliveryAttemptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channelType: "teams",
        targetType: "agent-thread",
        targetId: "thread-1",
        providerMessageId: null,
        status: "failed",
        urgency: "urgent",
        errorCode: "adapter_not_registered",
        errorMessage: "No adapter.",
        sentAt: null,
      }),
      select: { attemptId: true },
    });
  });
});
