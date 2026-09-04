import { describe, expect, it, vi } from "vitest";

import {
  mergeDeliveryTaskHubEvent,
  startDeliveryTaskHubSession,
  type DeliveryTaskHubClientState,
} from "./delivery-task-stream";

describe("delivery task hub stream", () => {
  it("subscribes once, emits a bounded snapshot, then reloads only the signalled Workroom", async () => {
    let onEvent: (event: { workCapsuleId: string; activityId: string }) => void = () => {};
    const unsubscribe = vi.fn();
    const send = vi.fn();
    const loadRow = vi.fn().mockResolvedValue({ capsuleId: "WC-1", row: { capsuleId: "WC-1", observedAt: "2026-09-04T12:01:00.000Z" } });
    const stop = await startDeliveryTaskHubSession({
      send,
      loadSnapshot: vi.fn().mockResolvedValue({ rows: [], nextCursor: null, observedAt: "2026-09-04T12:00:00.000Z" }),
      loadRow,
      subscribe: vi.fn(async (listener) => {
        onEvent = listener;
        return unsubscribe;
      }),
    });

    expect(send).toHaveBeenNthCalledWith(1, { type: "snapshot", rows: [], nextCursor: null, observedAt: "2026-09-04T12:00:00.000Z" });
    await onEvent({ workCapsuleId: "row-1", activityId: "activity-1" });
    expect(loadRow).toHaveBeenCalledTimes(1);
    expect(loadRow).toHaveBeenCalledWith("row-1");
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ type: "upsert", row: expect.objectContaining({ capsuleId: "WC-1" }) }));

    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("retains confirmed rows across errors and ignores older upserts", () => {
    const initial: DeliveryTaskHubClientState = {
      rows: [{ capsuleId: "WC-1", title: "Current", observedAt: "2026-09-04T12:02:00.000Z" } as never],
      nextCursor: null,
      observedAt: "2026-09-04T12:02:00.000Z",
      error: null,
    };
    const errored = mergeDeliveryTaskHubEvent(initial, { type: "error", error: "reload_failed", observedAt: "2026-09-04T12:03:00.000Z" });
    const stale = mergeDeliveryTaskHubEvent(errored, {
      type: "upsert",
      observedAt: "2026-09-04T12:01:00.000Z",
      row: { capsuleId: "WC-1", title: "Old", observedAt: "2026-09-04T12:01:00.000Z" } as never,
    });

    expect(errored.rows).toHaveLength(1);
    expect(stale.rows[0]?.title).toBe("Current");
    expect(stale.error).toBe("reload_failed");
  });

  it("continues bounded row reconciliation when the initial snapshot fails", async () => {
    let onEvent: (event: { workCapsuleId: string; activityId: string }) => void = () => {};
    const loadRow = vi.fn().mockResolvedValue({ capsuleId: "WC-1", row: { capsuleId: "WC-1", observedAt: "2026-09-04T12:01:00.000Z" } });
    const send = vi.fn();
    const stop = await startDeliveryTaskHubSession({
      send,
      loadSnapshot: vi.fn().mockRejectedValue(new Error("database unavailable")),
      loadRow,
      subscribe: vi.fn(async (listener) => {
        onEvent = listener;
        return vi.fn();
      }),
    });

    await onEvent({ workCapsuleId: "row-1", activityId: "activity-1" });
    expect(send).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: "error", error: "snapshot_failed" }));
    expect(loadRow).toHaveBeenCalledWith("row-1");
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ type: "upsert" }));
    stop();
  });
});
