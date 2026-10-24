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

  it("accepts a newer authorized async state when the Workroom timestamp is unchanged", () => {
    const initial: DeliveryTaskHubClientState = {
      rows: [{
        capsuleId: "WC-1",
        title: "Current",
        observedAt: "2026-09-04T12:00:00.000Z",
        asyncOperation: {
          coreHandleAvailable: true,
          operationId: "operation-1",
          status: "running",
          observedAt: "2026-09-04T12:00:00.000Z",
          progressPct: 50,
          progressMessage: "Running",
        },
      } as never],
      nextCursor: null,
      observedAt: "2026-09-04T12:00:00.000Z",
      error: null,
    };

    const merged = mergeDeliveryTaskHubEvent(initial, {
      type: "upsert",
      observedAt: "2026-09-04T12:05:00.000Z",
      row: {
        capsuleId: "WC-1",
        title: "Current",
        observedAt: "2026-09-04T12:05:00.000Z",
        asyncOperation: {
          coreHandleAvailable: true,
          operationId: "operation-1",
          status: "completed",
          observedAt: "2026-09-04T12:05:00.000Z",
          progressPct: 100,
          progressMessage: "Complete",
        },
      } as never,
    });

    expect(merged.rows[0]?.asyncOperation).toMatchObject({ status: "completed" });
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

  it("coalesces repeated events for one Workroom while its row reload is in flight", async () => {
    let onEvent: (event: { workCapsuleId: string; activityId: string }) => void | Promise<void> = () => {};
    let resolveFirstReload: ((value: { capsuleId: string; row: never }) => void) | undefined;
    const firstReload = new Promise<{ capsuleId: string; row: never }>((resolve) => {
      resolveFirstReload = resolve;
    });
    const loadRow = vi.fn()
      .mockReturnValueOnce(firstReload)
      .mockResolvedValue({ capsuleId: "WC-1", row: { capsuleId: "WC-1", observedAt: "2026-09-04T12:02:00.000Z" } });
    const stop = await startDeliveryTaskHubSession({
      send: vi.fn(),
      loadSnapshot: vi.fn().mockResolvedValue({ rows: [], nextCursor: null, observedAt: "2026-09-04T12:00:00.000Z" }),
      loadRow,
      subscribe: vi.fn(async (listener) => {
        onEvent = listener;
        return vi.fn();
      }),
    });

    const reloads = [
      onEvent({ workCapsuleId: "WC-1", activityId: "activity-1" }),
      onEvent({ workCapsuleId: "WC-1", activityId: "activity-2" }),
      onEvent({ workCapsuleId: "WC-1", activityId: "activity-3" }),
    ];
    await vi.waitFor(() => expect(loadRow).toHaveBeenCalledTimes(1));
    resolveFirstReload?.({ capsuleId: "WC-1", row: { capsuleId: "WC-1", observedAt: "2026-09-04T12:01:00.000Z" } as never });
    await Promise.all(reloads);

    expect(loadRow).toHaveBeenCalledTimes(2);
    stop();
  });

  it("bounds distinct pending Workrooms and repairs overflow with a canonical snapshot", async () => {
    let onEvent: (event: { workCapsuleId: string; activityId: string }) => void | Promise<void> = () => {};
    let resolveFirstReload: ((value: { capsuleId: string; row: never }) => void) | undefined;
    const firstReload = new Promise<{ capsuleId: string; row: never }>((resolve) => {
      resolveFirstReload = resolve;
    });
    const loadSnapshot = vi.fn()
      .mockResolvedValueOnce({ rows: [], nextCursor: null, observedAt: "2026-09-04T12:00:00.000Z" })
      .mockResolvedValueOnce({ rows: [], nextCursor: null, observedAt: "2026-09-04T12:01:00.000Z" });
    const loadRow = vi.fn()
      .mockReturnValueOnce(firstReload)
      .mockResolvedValue({ capsuleId: "WC-X", row: null });
    const stop = await startDeliveryTaskHubSession({
      send: vi.fn(),
      loadSnapshot,
      loadRow,
      subscribe: vi.fn(async (listener) => {
        onEvent = listener;
        return vi.fn();
      }),
    });

    const events = Array.from({ length: 45 }, (_, index) =>
      onEvent({ workCapsuleId: `workroom-${index}`, activityId: `activity-${index}` }));
    await vi.waitFor(() => expect(loadRow).toHaveBeenCalledTimes(1));
    resolveFirstReload?.({ capsuleId: "WC-0", row: null as never });
    await Promise.all(events);
    await vi.waitFor(() => expect(loadSnapshot).toHaveBeenCalledTimes(2));

    expect(loadRow.mock.calls.length).toBeLessThanOrEqual(41);
    stop();
  });
});
