import { describe, expect, it, vi } from "vitest";

import {
  WORK_CAPSULE_ACTIVITY_CHANNEL,
  parseWorkCapsuleActivityEvent,
  publishWorkCapsuleActivityEvent,
  serializeWorkCapsuleActivityEvent,
  subscribeToWorkCapsuleActivityEvents,
} from "./activity-events";

describe("Workroom activity push events", () => {
  it("serializes and parses a valid activity event", () => {
    const event = { workCapsuleId: "cm-work-1", activityId: "act-1" };
    expect(parseWorkCapsuleActivityEvent(serializeWorkCapsuleActivityEvent(event))).toEqual(event);
  });

  it("rejects malformed notification payloads", () => {
    expect(parseWorkCapsuleActivityEvent("")).toBeNull();
    expect(parseWorkCapsuleActivityEvent("not-json")).toBeNull();
    expect(parseWorkCapsuleActivityEvent(JSON.stringify({ workCapsuleId: "", activityId: "act" }))).toBeNull();
    expect(parseWorkCapsuleActivityEvent(JSON.stringify({ workCapsuleId: "wc" }))).toBeNull();
  });

  it("publishes through pg_notify with the canonical channel", async () => {
    const pool = { query: vi.fn().mockResolvedValue({}) };

    await expect(
      publishWorkCapsuleActivityEvent({ workCapsuleId: "cm-work-1", activityId: "act-1" }, pool),
    ).resolves.toBe(true);

    expect(pool.query).toHaveBeenCalledWith("SELECT pg_notify($1, $2)", [
      WORK_CAPSULE_ACTIVITY_CHANNEL,
      JSON.stringify({ workCapsuleId: "cm-work-1", activityId: "act-1" }),
    ]);
  });

  it("fails open when publish transport is unavailable", async () => {
    await expect(
      publishWorkCapsuleActivityEvent({ workCapsuleId: "cm-work-1", activityId: "act-1" }, null),
    ).resolves.toBe(false);

    await expect(
      publishWorkCapsuleActivityEvent(
        { workCapsuleId: "cm-work-1", activityId: "act-1" },
        { query: vi.fn().mockRejectedValue(new Error("db unavailable")) },
      ),
    ).resolves.toBe(false);
  });

  it("subscribes to matching notifications and ignores unrelated payloads", async () => {
    const notificationHandlers: Array<(message: { channel?: string; payload?: string }) => void> = [];
    const client = {
      query: vi.fn().mockResolvedValue({}),
      on: vi.fn((event: "notification", handler: (message: { channel?: string; payload?: string }) => void) => {
        if (event === "notification") notificationHandlers.push(handler);
      }),
      off: vi.fn(),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(client) };
    const onEvent = vi.fn();

    const unsubscribe = await subscribeToWorkCapsuleActivityEvents(onEvent, pool);

    expect(client.query).toHaveBeenCalledWith(`LISTEN ${WORK_CAPSULE_ACTIVITY_CHANNEL}`);
    const emit = notificationHandlers[0]!;
    expect(emit).toBeTypeOf("function");
    emit({ channel: "something_else", payload: JSON.stringify({ workCapsuleId: "x", activityId: "a" }) });
    emit({ channel: WORK_CAPSULE_ACTIVITY_CHANNEL, payload: "bad-json" });
    emit({
      channel: WORK_CAPSULE_ACTIVITY_CHANNEL,
      payload: JSON.stringify({ workCapsuleId: "cm-work-1", activityId: "act-1" }),
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ workCapsuleId: "cm-work-1", activityId: "act-1" });

    unsubscribe();
    expect(client.off).toHaveBeenCalledWith("notification", expect.any(Function));
    expect(client.query).toHaveBeenCalledWith(`UNLISTEN ${WORK_CAPSULE_ACTIVITY_CHANNEL}`);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
