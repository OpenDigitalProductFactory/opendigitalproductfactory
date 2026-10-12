import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { readDeadLetters } from "./dead-letters";

// BI-BC5C47D4: the two bounded retry paths' dead letters, read without side effects.
describe("readDeadLetters", () => {
  it("counts exhausted job runs and capped outbox transitions with their latest", async () => {
    const db = {
      jobRun: {
        count: vi.fn(async () => 3),
        findFirst: vi.fn(async () => ({ functionKey: "agent/child-thread-run", error: "lease_expired_exhausted: x", finishedAt: new Date("2026-10-08T04:00:00Z") })),
      },
      asyncInferenceOperationTransition: {
        count: vi.fn(async () => 0),
        findFirst: vi.fn(async () => null),
      },
    };
    const result = await readDeadLetters(db);

    expect(db.jobRun.count).toHaveBeenCalledWith({ where: { status: "failed", error: { startsWith: "lease_expired_exhausted" } } });
    expect(db.asyncInferenceOperationTransition.count).toHaveBeenCalledWith({
      where: { deliveredAt: null, deliveryAttempts: { gte: 24 } },
    });
    expect(result).toEqual([
      expect.objectContaining({
        queueKey: "dead-letter:job-engine",
        count: 3,
        latest: { at: "2026-10-08T04:00:00.000Z", reason: "agent/child-thread-run", detail: "lease_expired_exhausted: x" },
      }),
      expect.objectContaining({ queueKey: "dead-letter:async-operation-outbox", count: 0, latest: null }),
    ]);
  });
});
