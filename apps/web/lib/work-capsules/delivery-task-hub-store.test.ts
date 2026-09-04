import { describe, expect, it, vi } from "vitest";

import {
  decodeDeliveryTaskCursor,
  encodeDeliveryTaskCursor,
  loadDeliveryTaskHubPage,
  loadDeliveryTaskHubRow,
} from "./delivery-task-hub-store";

const now = new Date("2026-09-04T12:00:00.000Z");
const cursorSecret = "test-delivery-task-cursor-secret";

function db(rows: unknown[]) {
  return { workroom: { findMany: vi.fn().mockResolvedValue(rows), findUnique: vi.fn() } };
}

describe("delivery task hub store", () => {
  it("fixes the time window, page bound, order, and nested evidence bounds", async () => {
    const fake = db([]);
    const result = await loadDeliveryTaskHubPage(fake, { now });

    expect(fake.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ updatedAt: { gte: new Date("2026-08-05T12:00:00.000Z") } }),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 41,
      select: expect.objectContaining({
        activities: expect.objectContaining({ take: 5 }),
        runtimeVerifications: expect.objectContaining({ take: 1 }),
      }),
    }));
    expect(result).toEqual({ rows: [], nextCursor: null, observedAt: now.toISOString() });
  });

  it("round-trips an opaque bounded cursor and rejects tampering", () => {
    const cursor = encodeDeliveryTaskCursor({
      id: "row-40",
      updatedAt: "2026-09-01T12:00:00.000Z",
      windowStart: "2026-08-05T12:00:00.000Z",
    }, { secret: cursorSecret });
    expect(cursor).not.toContain("row-40");
    expect(cursor.split(".")).toHaveLength(2);
    expect(decodeDeliveryTaskCursor(cursor, { secret: cursorSecret })).toEqual({
      id: "row-40",
      updatedAt: "2026-09-01T12:00:00.000Z",
      windowStart: "2026-08-05T12:00:00.000Z",
    });
    expect(() => decodeDeliveryTaskCursor("not-a-cursor", { secret: cursorSecret })).toThrow(/cursor/i);
    const [encoded, signature] = cursor.split(".");
    const payload = JSON.parse(Buffer.from(encoded!, "base64url").toString("utf8"));
    const tampered = `${Buffer.from(JSON.stringify({ ...payload, windowStart: "2025-01-01T00:00:00.000Z" })).toString("base64url")}.${signature}`;
    expect(() => decodeDeliveryTaskCursor(tampered, { secret: cursorSecret })).toThrow(/cursor/i);
  });

  it("uses the returned cursor without widening its original window", async () => {
    const fake = db([]);
    const cursor = encodeDeliveryTaskCursor({
      id: "row-40",
      updatedAt: "2026-09-01T12:00:00.000Z",
      windowStart: "2026-08-05T12:00:00.000Z",
    }, { secret: cursorSecret });

    await loadDeliveryTaskHubPage(fake, { now: new Date("2026-09-05T12:00:00.000Z"), cursor, cursorSecret });

    expect(fake.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        updatedAt: { gte: new Date("2026-08-05T12:00:00.000Z") },
        AND: [{ OR: [
          { updatedAt: { lt: new Date("2026-09-01T12:00:00.000Z") } },
          { updatedAt: new Date("2026-09-01T12:00:00.000Z"), id: { lt: "row-40" } },
        ] }],
      }),
    }));
  });

  it("expires a previously valid signed cursor after its bounded observation window", async () => {
    const fake = db([]);
    const cursor = encodeDeliveryTaskCursor({
      id: "row-40",
      updatedAt: "2026-09-01T12:00:00.000Z",
      windowStart: "2026-08-05T12:00:00.000Z",
    }, { secret: cursorSecret });

    await expect(loadDeliveryTaskHubPage(fake, {
      now: new Date("2026-09-05T12:00:00.001Z"),
      cursor,
      cursorSecret,
    })).rejects.toThrow(/cursor/i);
    expect(fake.workroom.findMany).not.toHaveBeenCalled();
  });

  it("reloads one internal Workroom id without scanning the corpus", async () => {
    const fake = db([]);
    fake.workroom.findUnique.mockResolvedValue({ id: "row-1", capsuleId: "WC-1", archivedAt: new Date() });

    await expect(loadDeliveryTaskHubRow(fake, "row-1", { now })).resolves.toEqual({ capsuleId: "WC-1", row: null });
    expect(fake.workroom.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "row-1" } }));
    expect(fake.workroom.findMany).not.toHaveBeenCalled();
  });

  it("removes a signalled Workroom that is outside the fixed 30-day live window", async () => {
    const fake = db([]);
    fake.workroom.findUnique.mockResolvedValue({
      id: "row-1",
      capsuleId: "WC-1",
      archivedAt: null,
      updatedAt: new Date("2026-08-05T11:59:59.999Z"),
    });

    await expect(loadDeliveryTaskHubRow(fake, "row-1", { now })).resolves.toEqual({
      capsuleId: "WC-1",
      row: null,
    });
  });

  it("enriches only the bounded page and contains an async read failure per row", async () => {
    const source = (id: string) => ({
      id,
      capsuleId: `WC-${id}`,
      title: id,
      objective: "Bounded delivery",
      status: "working",
      source: "build-studio",
      executorKind: null,
      executorRef: null,
      backlogItemId: null,
      repositoryFullName: null,
      headBranch: null,
      pullRequestUrl: null,
      leaseExpiresAt: null,
      updatedAt: now,
      lastSyncedAt: null,
      taskRun: null,
      activities: [],
      runtimeVerifications: [],
    });
    const fake = db([source("1"), source("2")]);
    const loadAsyncOperation = vi.fn()
      .mockResolvedValueOnce({
        coreHandleAvailable: true,
        status: "running",
        observedAt: now.toISOString(),
        progressPct: 25,
        progressMessage: "Working",
      })
      .mockRejectedValueOnce(new Error("denied"));

    const result = await loadDeliveryTaskHubPage(fake, { now, loadAsyncOperation });

    expect(loadAsyncOperation).toHaveBeenCalledTimes(2);
    expect(loadAsyncOperation).toHaveBeenNthCalledWith(1, { capsuleId: "WC-1", taskRunId: null });
    expect(result.rows[0]?.asyncOperation).toEqual(expect.objectContaining({
      coreHandleAvailable: true,
      status: "running",
    }));
    expect(result.rows[1]?.asyncOperation).toEqual({ coreHandleAvailable: false });
  });

  it("advances a row observation when its authorized async operation changes later", async () => {
    const fake = db([{
      id: "1",
      capsuleId: "WC-1",
      title: "Async delivery",
      objective: "Observe the canonical async state",
      status: "working",
      source: "build-studio",
      executorKind: null,
      executorRef: null,
      backlogItemId: null,
      repositoryFullName: null,
      headBranch: null,
      pullRequestUrl: null,
      leaseExpiresAt: null,
      updatedAt: new Date("2026-09-04T12:00:00.000Z"),
      lastSyncedAt: null,
      taskRun: null,
      activities: [],
      runtimeVerifications: [],
    }]);

    const result = await loadDeliveryTaskHubPage(fake, {
      now: new Date("2026-09-04T12:10:00.000Z"),
      loadAsyncOperation: vi.fn().mockResolvedValue({
        coreHandleAvailable: true,
        operationId: "operation-1",
        status: "completed",
        observedAt: "2026-09-04T12:05:00.000Z",
        progressPct: 100,
        progressMessage: "Complete",
      }),
    });

    expect(result.rows[0]).toMatchObject({
      observedAt: "2026-09-04T12:05:00.000Z",
      asyncOperation: { status: "completed" },
    });
  });
});
