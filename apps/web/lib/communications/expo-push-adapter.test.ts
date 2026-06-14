import { describe, it, expect, vi } from "vitest";
import { createExpoPushAdapter, isPushEnabled } from "./expo-push-adapter";
import type { SendCommunicationInput } from "./channel-types";

const baseInput: SendCommunicationInput = {
  channel: "push",
  target: {
    targetType: "work-item",
    targetId: "WI-1",
    recipientUserId: "u1",
  },
  title: "New job",
  body: "Compressor swap",
  urgency: "urgent",
  deepLink: "/jobs/WI-1",
};

describe("createExpoPushAdapter", () => {
  it("sends to registered devices and returns sent", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, ticketIds: ["t1"] });
    const adapter = createExpoPushAdapter({
      loadDeviceTokens: async () => ["ExponentPushToken[a]"],
      send,
    });
    const result = await adapter.send(baseInput);
    expect(send).toHaveBeenCalled();
    expect(result).toMatchObject({
      channel: "push",
      status: "sent",
      providerMessageId: "t1",
    });
  });

  it("fails when the recipient has no registered devices", async () => {
    const adapter = createExpoPushAdapter({
      loadDeviceTokens: async () => [],
      send: vi.fn(),
    });
    const result = await adapter.send(baseInput);
    expect(result).toMatchObject({
      status: "failed",
      errorCode: "no_registered_devices",
    });
  });

  it("fails without a recipient user", async () => {
    const adapter = createExpoPushAdapter({
      loadDeviceTokens: async () => ["ExponentPushToken[a]"],
      send: vi.fn(),
    });
    const result = await adapter.send({
      ...baseInput,
      target: { ...baseInput.target, recipientUserId: undefined },
    });
    expect(result).toMatchObject({
      status: "failed",
      errorCode: "missing_recipient_user",
    });
  });

  it("maps an Expo send failure", async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ ok: false, ticketIds: [], error: "Expo push HTTP 500" });
    const adapter = createExpoPushAdapter({
      loadDeviceTokens: async () => ["ExponentPushToken[a]"],
      send,
    });
    const result = await adapter.send(baseInput);
    expect(result).toMatchObject({
      status: "failed",
      errorCode: "expo_send_failed",
    });
  });
});

describe("isPushEnabled", () => {
  it("reflects the DPF_PUSH_ENABLED flag", () => {
    const prev = process.env.DPF_PUSH_ENABLED;
    process.env.DPF_PUSH_ENABLED = "true";
    expect(isPushEnabled()).toBe(true);
    process.env.DPF_PUSH_ENABLED = "false";
    expect(isPushEnabled()).toBe(false);
    if (prev === undefined) delete process.env.DPF_PUSH_ENABLED;
    else process.env.DPF_PUSH_ENABLED = prev;
  });
});
