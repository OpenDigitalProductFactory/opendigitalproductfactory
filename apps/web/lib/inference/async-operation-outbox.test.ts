import { describe, expect, it, vi } from "vitest";

import type { AsyncOperationTransitionRecord } from "./async-operation-store";
import {
  ASYNC_OPERATION_TRANSITION_DELIVERY_CAP,
  AsyncOperationOutboxUnavailableError,
  publishAsyncOperationTransitions,
  type AsyncOperationOutboxStore,
} from "./async-operation-outbox";

const now = new Date("2026-09-04T12:00:00.000Z");
const transition: AsyncOperationTransitionRecord = {
  id: "transition-1",
  operationId: "operation-1",
  sequence: 2,
  status: "running",
  checkpoint: { phase: "provider-progress" },
  occurredAt: now,
  deliveryAttempts: 0,
  deliveredAt: null,
};

function store(rows: AsyncOperationTransitionRecord[] = [transition]): AsyncOperationOutboxStore {
  return {
    listUndeliveredTransitions: vi.fn().mockResolvedValue(rows),
    markTransitionDeliveryAttempt: vi.fn().mockResolvedValue(true),
    markTransitionDelivered: vi.fn().mockResolvedValue(undefined),
  };
}

describe("publishAsyncOperationTransitions", () => {
  it("publishes the canonical typed event and acknowledges it after delivery", async () => {
    const outbox = store();
    const publish = vi.fn().mockResolvedValue(undefined);

    await expect(publishAsyncOperationTransitions({ store: outbox, publish, now: () => now }))
      .resolves.toEqual({ delivered: 1, failed: 0, deadLettered: [] });

    expect(outbox.listUndeliveredTransitions).toHaveBeenCalledWith({
      limit: undefined,
      maxAttempts: ASYNC_OPERATION_TRANSITION_DELIVERY_CAP,
    });
    expect(outbox.markTransitionDeliveryAttempt).toHaveBeenCalledWith("transition-1");
    expect(publish).toHaveBeenCalledWith({
      eventId: "async-operation:operation-1:transition:2",
      name: "inference/async-operation.transitioned",
      data: {
        operationId: "operation-1",
        sequence: 2,
        status: "running",
        checkpoint: { phase: "provider-progress" },
        occurredAt: now.toISOString(),
      },
    });
    expect(outbox.markTransitionDelivered).toHaveBeenCalledWith("transition-1", now);
  });

  it("leaves the row undelivered when publication fails", async () => {
    const outbox = store();
    const publish = vi.fn().mockRejectedValue(new Error("transport unavailable"));

    await expect(publishAsyncOperationTransitions({ store: outbox, publish, now: () => now }))
      .resolves.toEqual({ delivered: 0, failed: 1, deadLettered: [] });
    expect(outbox.markTransitionDeliveryAttempt).toHaveBeenCalledOnce();
    expect(outbox.markTransitionDelivered).not.toHaveBeenCalled();
  });

  // BI-6BB830E4: one transition that always fails must not hold back the rest.
  it("delivers later operations past a failing transition and holds only that operation's later rows", async () => {
    const poison = { ...transition, id: "poison-1", operationId: "operation-poison", sequence: 1 };
    const poisonLater = { ...transition, id: "poison-2", operationId: "operation-poison", sequence: 2 };
    const healthy = { ...transition, id: "healthy-1", operationId: "operation-healthy", sequence: 1 };
    const outbox = store([poison, poisonLater, healthy]);
    const publish = vi.fn(async (event: { data: { operationId: string } }) => {
      if (event.data.operationId === "operation-poison") throw new Error("payload rejected");
    });

    await expect(publishAsyncOperationTransitions({ store: outbox, publish, now: () => now }))
      .resolves.toEqual({ delivered: 1, failed: 1, deadLettered: [] });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(outbox.markTransitionDeliveryAttempt).not.toHaveBeenCalledWith("poison-2");
    expect(outbox.markTransitionDelivered).toHaveBeenCalledWith("healthy-1", now);
  });

  it("dead-letters a transition on its last allowed attempt", async () => {
    const lastTry = { ...transition, deliveryAttempts: ASYNC_OPERATION_TRANSITION_DELIVERY_CAP - 1 };
    const outbox = store([lastTry]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const publish = vi.fn().mockRejectedValue(new Error("payload rejected"));

    await expect(publishAsyncOperationTransitions({ store: outbox, publish, now: () => now }))
      .resolves.toEqual({ delivered: 0, failed: 1, deadLettered: ["transition-1"] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dead-lettered"), 1, ASYNC_OPERATION_TRANSITION_DELIVERY_CAP, "transition-1");
    warn.mockRestore();
  });

  it("stops the pass when two operations fail and nothing was delivered (the transport is down)", async () => {
    const first = { ...transition, id: "a-1", operationId: "operation-a" };
    const second = { ...transition, id: "b-1", operationId: "operation-b" };
    const third = { ...transition, id: "c-1", operationId: "operation-c" };
    const outbox = store([first, second, third]);
    const publish = vi.fn().mockRejectedValue(new Error("connection refused"));

    await expect(publishAsyncOperationTransitions({ store: outbox, publish, now: () => now }))
      .rejects.toBeInstanceOf(AsyncOperationOutboxUnavailableError);
    expect(outbox.markTransitionDeliveryAttempt).toHaveBeenCalledTimes(2);
    expect(outbox.markTransitionDeliveryAttempt).not.toHaveBeenCalledWith("c-1");
  });

  it("skips a stale outbox snapshot when another publisher already delivered it", async () => {
    const outbox = store();
    vi.mocked(outbox.markTransitionDeliveryAttempt).mockResolvedValue(false);
    const publish = vi.fn();

    await expect(publishAsyncOperationTransitions({ store: outbox, publish, now: () => now }))
      .resolves.toEqual({ delivered: 0, failed: 0, deadLettered: [] });
    expect(publish).not.toHaveBeenCalled();
    expect(outbox.markTransitionDelivered).not.toHaveBeenCalled();
  });
});
