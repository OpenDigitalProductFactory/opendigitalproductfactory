import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notificationCreate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    notification: { create: mocks.notificationCreate },
  },
}));

import { createCommunicationDispatcher } from "./dispatcher";
import { createInAppAdapter } from "./in-app-adapter";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notificationCreate.mockResolvedValue({ id: "notif-1" });
});

describe("communication dispatcher", () => {
  it("dispatches through the in-app adapter and returns a sent result", async () => {
    const dispatcher = createCommunicationDispatcher([createInAppAdapter()]);

    const result = await dispatcher.send({
      channel: "in-app",
      target: { targetType: "work-item", targetId: "WI-1", recipientUserId: "user-1" },
      title: "Approval needed",
      body: "Please review the request.",
      urgency: "priority",
      deepLink: "/workspace/my-queue",
    });

    expect(result).toEqual({
      channel: "in-app",
      status: "sent",
      providerMessageId: "notif-1",
    });
    expect(mocks.notificationCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: "work-queue",
        title: "Approval needed",
        body: "Please review the request.",
        deepLink: "/workspace/my-queue",
        read: false,
      },
    });
  });

  it("returns failed when no adapter is registered for the channel", async () => {
    const dispatcher = createCommunicationDispatcher([]);

    const result = await dispatcher.send({
      channel: "teams",
      target: { targetType: "work-item", targetId: "WI-1", recipientUserId: "user-1" },
      title: "Approval needed",
      body: "Please review the request.",
      urgency: "priority",
    });

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("adapter_not_registered");
  });
});
