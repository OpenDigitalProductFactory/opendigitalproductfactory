import { describe, expect, it, vi } from "vitest";
import { markTaskRunWorking } from "@/lib/observability/heartbeat";
import { createHash } from "node:crypto";
import { createSemanticReviewRequest } from "./semantic-review-request";

vi.mock("@/lib/observability/heartbeat", () => ({ markTaskRunWorking: vi.fn() }));

import {
  claimSemanticReviewSingleFlight,
  completeSemanticReviewSingleFlight,
  createPrismaSemanticReviewSingleFlightStore,
  type SemanticReviewRunRow,
  type SemanticReviewSingleFlightStore,
} from "./semantic-review-single-flight";

function memoryStore(): SemanticReviewSingleFlightStore & { rows: SemanticReviewRunRow[] } {
  const rows: SemanticReviewRunRow[] = [];
  return {
    rows,
    async list(repeatedPatternKey) {
      return rows
        .filter((row) => row.repeatedPatternKey === repeatedPatternKey)
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(0, 10);
    },
    async find(taskRunId) {
      return rows.find((row) => row.taskRunId === taskRunId) ?? null;
    },
    async create(input) {
      await Promise.resolve();
      if (rows.some((row) => row.taskRunId === input.taskRunId)) {
        throw Object.assign(new Error("unique taskRunId"), { code: "P2002" });
      }
      const row: SemanticReviewRunRow = {
        ...input,
        status: "working",
        progressPayload: null,
        createdAt: new Date(Date.now() + rows.length),
      };
      rows.push(row);
      return row;
    },
    async update(taskRunId, update) {
      const row = rows.find((candidate) => candidate.taskRunId === taskRunId);
      if (!row) throw new Error(`missing ${taskRunId}`);
      Object.assign(row, update);
      return row;
    },
  };
}

const input = (gateKey = "a".repeat(64)) => ({
  gateKey,
  userId: "user-1",
  capsuleId: "WC-TEST",
  title: "Review immutable change",
  objective: "Review the exact committed delivery packet once.",
});

describe("semantic review TaskRun adapter", () => {
  const durablePacket = () => createSemanticReviewRequest({
    surface: "external", authorSurface: "codex-desktop", artifactType: "code-change",
    title: "Review exact diff", artifact: "exact diff\n", verificationEvidence: "Focused tests pass",
    changedFiles: ["apps/web/lib/example.ts"],
    identity: { capsuleId: "WC-TEST", baseTreeHash: "a".repeat(40), headTreeHash: "b".repeat(40),
      diffDigest: createHash("sha256").update("exact diff\n").digest("hex"), specialistIds: [] },
  }, { userId: "user-1", agentId: null, apiTokenId: "token-1", authSource: "pat" });

  it.each(["user", "capsule", "digest", "gate"])("refuses a mismatched %s before writing the durable admission", async (mismatch) => {
    const packet = durablePacket();
    if (mismatch === "digest") packet.digest = "0".repeat(64);
    const taskRun = { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() };
    const store = createPrismaSemanticReviewSingleFlightStore({ taskRun }, { packet });
    await expect(store.create({ ...input(), taskRunId: "TR-GATE-TEST",
      repeatedPatternKey: `gate:${packet.gateKey}`, gateKey: mismatch === "gate" ? "a".repeat(64) : packet.gateKey, attempt: 1,
      ...(mismatch === "user" ? { userId: "other-user" } : {}),
      ...(mismatch === "capsule" ? { capsuleId: "WC-OTHER" } : {}),
    })).rejects.toThrow(/packet binding/i);
    expect(taskRun.create).not.toHaveBeenCalled();
  });

  it("atomically persists the immutable packet and queue intent before execution", async () => {
    const packet = durablePacket();
    const taskRun = {
      findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(),
      create: vi.fn().mockImplementation(async ({ data }) => ({ ...data, createdAt: new Date() })),
    };
    const store = createPrismaSemanticReviewSingleFlightStore({ taskRun } as never, { packet } as never);
    const row = await store.create({ ...input(packet.gateKey), taskRunId: "TR-GATE-TEST", repeatedPatternKey: `gate:${packet.gateKey}`, attempt: 1 });
    expect(taskRun.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: "submitted",
      artifacts: { create: expect.objectContaining({ parts: [{ kind: "data", data: packet }] }) },
      progressPayload: expect.objectContaining({ semanticReview: expect.objectContaining({ state: "pending", requestDigest: packet.digest }) }),
    }) }));
    expect(row.status).toBe("submitted");
    expect(taskRun.create.mock.calls[0]![0].data.artifacts.create).not.toHaveProperty("taskRunId");
    expect(markTaskRunWorking).not.toHaveBeenCalled();
  });

  it("uses the indexed repeated-pattern lookup with a bounded attempt window", async () => {
    const taskRun = {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };
    const store = createPrismaSemanticReviewSingleFlightStore({ taskRun } as never);

    await store.list(`gate:${"a".repeat(64)}`);

    expect(taskRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { repeatedPatternKey: `gate:${"a".repeat(64)}` },
      orderBy: { createdAt: "desc" },
      take: 10,
    }));
  });
});

describe("semantic review single-flight", () => {
  it.each(["stalled", "quiescing", "paused-for-upgrade", "paused-for-upgrade-forced"] as const)(
    "subscribes to %s without silently authorizing a new review attempt", async (status) => {
      const store = memoryStore();
      const admitted = await claimSemanticReviewSingleFlight(input(), store, async () => false);
      Object.assign(store.rows[0]!, { status });
      const repeated = await claimSemanticReviewSingleFlight(input(), store, async () => false);
      expect(repeated).toMatchObject({ disposition: "subscribed", taskRunId: admitted.taskRunId });
      expect(store.rows).toHaveLength(1);
    },
  );

  it("admits one executor and subscribes a concurrent caller to the same TaskRun", async () => {
    const store = memoryStore();
    const [left, right] = await Promise.all([
      claimSemanticReviewSingleFlight(input(), store, async () => false),
      claimSemanticReviewSingleFlight(input(), store, async () => false),
    ]);

    expect([left.disposition, right.disposition].sort()).toEqual(["admitted", "subscribed"]);
    expect(left.taskRunId).toBe(right.taskRunId);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.repeatedPatternKey).toBe(`gate:${"a".repeat(64)}`);
  });

  it("reuses completed evidence without creating or dispatching another attempt", async () => {
    const store = memoryStore();
    const admitted = await claimSemanticReviewSingleFlight(input(), store, async () => false);
    await completeSemanticReviewSingleFlight({
      taskRunId: admitted.taskRunId,
      evidenceRecordId: "EXT-1",
      resultClass: "pass",
    }, store);

    const reused = await claimSemanticReviewSingleFlight(
      input(),
      store,
      async (evidenceRecordId) => evidenceRecordId === "EXT-1",
    );

    expect(reused).toEqual(expect.objectContaining({
      disposition: "reused",
      taskRunId: admitted.taskRunId,
      evidenceRecordId: "EXT-1",
    }));
    expect(store.rows).toHaveLength(1);
  });

  it("creates one new attempt when terminal evidence is missing or stale", async () => {
    const store = memoryStore();
    const first = await claimSemanticReviewSingleFlight(input(), store, async () => false);
    await completeSemanticReviewSingleFlight({
      taskRunId: first.taskRunId,
      evidenceRecordId: "EXT-STALE",
      resultClass: "pass",
    }, store);

    const [left, right] = await Promise.all([
      claimSemanticReviewSingleFlight(input(), store, async () => false),
      claimSemanticReviewSingleFlight(input(), store, async () => false),
    ]);

    expect([left.disposition, right.disposition].sort()).toEqual(["admitted", "subscribed"]);
    expect(left.taskRunId).toBe(right.taskRunId);
    expect(left.taskRunId).not.toBe(first.taskRunId);
    expect(store.rows).toHaveLength(2);
  });

  it("does not coalesce different immutable gate keys", async () => {
    const store = memoryStore();
    const left = await claimSemanticReviewSingleFlight(input("a".repeat(64)), store, async () => false);
    const right = await claimSemanticReviewSingleFlight(input("b".repeat(64)), store, async () => false);

    expect(left.disposition).toBe("admitted");
    expect(right.disposition).toBe("admitted");
    expect(left.taskRunId).not.toBe(right.taskRunId);
    expect(store.rows).toHaveLength(2);
  });

  it("rejects an invalid gate key before writing a TaskRun", async () => {
    const store = memoryStore();

    await expect(claimSemanticReviewSingleFlight(input("bad"), store, async () => false))
      .rejects.toThrow(/gate key/i);
    expect(store.rows).toHaveLength(0);
  });
});
