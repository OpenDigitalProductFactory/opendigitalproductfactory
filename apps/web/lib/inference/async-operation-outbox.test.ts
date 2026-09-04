import { describe, expect, it, vi } from "vitest";

import type { AsyncOperationTransitionRecord } from "./async-operation-store";
import {
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
      .resolves.toEqual({ delivered: 1 });

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
      .rejects.toThrow("transport unavailable");
    expect(outbox.markTransitionDeliveryAttempt).toHaveBeenCalledOnce();
    expect(outbox.markTransitionDelivered).not.toHaveBeenCalled();
  });

  it("skips a stale outbox snapshot when another publisher already delivered it", async () => {
    const outbox = store();
    vi.mocked(outbox.markTransitionDeliveryAttempt).mockResolvedValue(false);
    const publish = vi.fn();

    await expect(publishAsyncOperationTransitions({ store: outbox, publish, now: () => now }))
      .resolves.toEqual({ delivered: 0 });
    expect(publish).not.toHaveBeenCalled();
    expect(outbox.markTransitionDelivered).not.toHaveBeenCalled();
  });
});
