import { describe, expect, it, vi } from "vitest";

import {
  FEDERATION_DELIVERY_QUEUE_ID,
  finishFederationDeliveryJob,
  scheduleFederationDeliveryJob,
} from "./delivery-queue";

describe("federation delivery queue", () => {
  it("upserts one idempotent WorkItem per mirror and emits enqueue telemetry", async () => {
    const upsertQueue = vi.fn().mockResolvedValue({ id: "queue-db-id" });
    const upsertItem = vi.fn().mockResolvedValue({ itemId: "job-1" });
    const telemetry = vi.fn().mockResolvedValue(undefined);

    await scheduleFederationDeliveryJob({
      workQueue: { upsert: upsertQueue },
      workItem: { upsert: upsertItem, update: vi.fn(), updateMany: vi.fn() },
    }, "fdmo_1", new Date("2026-08-09T02:00:00.000Z"), telemetry);

    expect(upsertQueue).toHaveBeenCalledWith(expect.objectContaining({
      where: { queueId: FEDERATION_DELIVERY_QUEUE_ID },
    }));
    expect(upsertItem).toHaveBeenCalledWith(expect.objectContaining({
      where: { sourceKey: "federation-demand:fdmo_1" },
      create: expect.objectContaining({ sourceType: "federation-demand-delivery", sourceId: "fdmo_1" }),
    }));
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({
      queueKey: `cwq:${FEDERATION_DELIVERY_QUEUE_ID}`,
      itemKind: "federation-demand",
      transition: "enqueued",
    }));
  });

  it("stores retry scheduling on WorkItem rather than FederatedRecordMirror", async () => {
    const update = vi.fn().mockResolvedValue({});
    const telemetry = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-08-09T02:00:00.000Z");

    await finishFederationDeliveryJob({
      workQueue: { upsert: vi.fn() },
      workItem: { upsert: vi.fn(), update, updateMany: vi.fn() },
    }, {
      itemId: "job-1",
      attemptCount: 0,
      outcome: "retry",
      error: "peer unavailable",
      now,
      nextAttemptAt: new Date("2026-08-09T02:00:30.000Z"),
    }, telemetry);

    expect(update).toHaveBeenCalledWith({
      where: { itemId: "job-1" },
      data: expect.objectContaining({
        status: "queued",
        attemptCount: 1,
        nextAttemptAt: new Date("2026-08-09T02:00:30.000Z"),
        lastError: "peer unavailable",
      }),
    });
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({ transition: "requeued" }));
  });

  it("re-scheduling a job that is already queued records no new enqueued transition (BI-1A8887C7)", async () => {
    // Telemetry records state transitions, not repeated polls: queued -> queued
    // is not an `enqueued` event. Only a job entering the queue (new, or back
    // from completed/failed/in-progress) is.
    const telemetry = vi.fn().mockResolvedValue(undefined);
    const findUnique = vi.fn().mockResolvedValue({ itemId: "job-1", status: "queued" });
    const db = {
      workQueue: { upsert: vi.fn().mockResolvedValue({ id: "queue-db-id" }) },
      workItem: {
        upsert: vi.fn().mockResolvedValue({ itemId: "job-1" }),
        update: vi.fn(), updateMany: vi.fn(), findUnique,
      },
    };

    await scheduleFederationDeliveryJob(db, "fdmo_1", new Date("2026-08-09T02:00:00.000Z"), telemetry);
    await scheduleFederationDeliveryJob(db, "fdmo_1", new Date("2026-08-09T02:05:00.000Z"), telemetry);

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { sourceKey: "federation-demand:fdmo_1" },
    }));
    expect(telemetry).not.toHaveBeenCalled();
  });

  it("still records enqueued when a completed job re-enters the queue", async () => {
    const telemetry = vi.fn().mockResolvedValue(undefined);
    await scheduleFederationDeliveryJob({
      workQueue: { upsert: vi.fn().mockResolvedValue({ id: "queue-db-id" }) },
      workItem: {
        upsert: vi.fn().mockResolvedValue({ itemId: "job-1" }),
        update: vi.fn(), updateMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ itemId: "job-1", status: "completed" }),
      },
    }, "fdmo_1", new Date("2026-08-09T02:00:00.000Z"), telemetry);

    expect(telemetry).toHaveBeenCalledTimes(1);
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({ transition: "enqueued", itemId: "job-1" }));
  });
});
