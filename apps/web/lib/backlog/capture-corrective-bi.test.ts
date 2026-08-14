import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const findMany = vi.fn();
const create = vi.fn();
const update = vi.fn();
const activityFindMany = vi.fn();
const activityCreateMany = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      findMany: (...a: unknown[]) => findMany(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
    backlogItemActivity: {
      findMany: (...a: unknown[]) => activityFindMany(...a),
      createMany: (...a: unknown[]) => activityCreateMany(...a),
    },
  },
}));

import {
  captureCorrectiveFailureBI,
  correctiveFingerprint,
  recordCorrectiveRecoveryEvidence,
} from "./capture-corrective-bi";

beforeEach(() => {
  findFirst.mockReset();
  create.mockReset();
  update.mockReset();
  findMany.mockReset();
  activityFindMany.mockReset();
  activityCreateMany.mockReset();
});

describe("recordCorrectiveRecoveryEvidence", () => {
  const recovery = {
    runId: "SUR-RECOVERED",
    currentSha: "before-sha",
    targetSha: "target-sha",
    deployedSha: "deployed-sha",
    completedAt: new Date("2026-08-14T00:00:00.000Z"),
  };

  it("records one non-closing recovery activity per active item and run", async () => {
    findMany.mockResolvedValue([
      { id: "row-1", itemId: "BI-ONE", body: "failureFingerprint: abcdef0123456789\nclass: unknown" },
      { id: "row-2", itemId: "BI-TWO", body: "failureFingerprint: fedcba9876543210\nclass: environment" },
    ]);
    activityFindMany.mockResolvedValue([{ backlogItemId: "row-2" }]);
    activityCreateMany.mockResolvedValue({ count: 1 });

    const result = await recordCorrectiveRecoveryEvidence({
      source: "self-upgrade-failure",
      recovery,
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        source: "self-upgrade-failure",
        status: { notIn: ["done", "deferred"] },
      },
    }));
    expect(activityFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        backlogItemId: { in: ["row-1", "row-2"] },
        kind: "recovery_observed",
        summary: "Recovery observed in SUR-RECOVERED",
      }),
    }));
    expect(activityCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        id: expect.stringMatching(/^recovery_[0-9a-f]{24}$/),
        backlogItemId: "row-1",
        kind: "recovery_observed",
        summary: "Recovery observed in SUR-RECOVERED",
        payload: {
          source: "self-upgrade-failure",
          failureFingerprint: "abcdef0123456789",
          recoveryRunId: "SUR-RECOVERED",
          currentSha: "before-sha",
          targetSha: "target-sha",
          deployedSha: "deployed-sha",
          completedAt: "2026-08-14T00:00:00.000Z",
          statusMutated: false,
        },
      })],
      skipDuplicates: true,
    });
    expect(result).toEqual({ action: "recorded", itemIds: ["BI-ONE"], activityCount: 1 });
    expect(update).not.toHaveBeenCalled();
    expect(activityCreateMany.mock.calls[0][0].data[0].payload).not.toHaveProperty("evidenceKind");
  });

  it("is best-effort when recovery evidence storage is unavailable", async () => {
    findMany.mockRejectedValue(new Error("db unavailable"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(recordCorrectiveRecoveryEvidence({
        source: "self-upgrade-failure",
        recovery,
      })).resolves.toEqual({ action: "skipped", reason: "error" });
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe("correctiveFingerprint", () => {
  it("is stable for the same (source, signature) and is 16 hex chars", () => {
    const a = correctiveFingerprint("build-failure", "qa:Verify checkout");
    const b = correctiveFingerprint("build-failure", "qa:Verify checkout");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("differs by source and by signature", () => {
    expect(correctiveFingerprint("build-failure", "x")).not.toBe(
      correctiveFingerprint("self-upgrade-failure", "x"),
    );
    expect(correctiveFingerprint("build-failure", "x")).not.toBe(
      correctiveFingerprint("build-failure", "y"),
    );
  });
});

describe("captureCorrectiveFailureBI", () => {
  it("creates a fingerprinted corrective BI on first failure", async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue({ itemId: "BI-ABCD1234" });

    const res = await captureCorrectiveFailureBI({
      source: "build-failure",
      signature: "qa:Verify checkout",
      title: "[build-failure] 1 task(s) failed: Verify checkout",
      body: "buildId: FB-1\nfailedTasks: 1",
    });

    const fp = correctiveFingerprint("build-failure", "qa:Verify checkout");
    expect(res).toEqual({ action: "created", itemId: "BI-ABCD1234", fingerprint: fp });
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.source).toBe("build-failure");
    expect(data.workType).toBe("bug");
    expect(data.status).toBe("triaging");
    expect(data.type).toBe("product");
    expect(data.body).toContain(`failureFingerprint: ${fp}`);
    expect(update).not.toHaveBeenCalled();
  });

  it("dedups to occurrenceCount++ when an open item with the same signature exists", async () => {
    findFirst.mockResolvedValue({ id: "row-1", itemId: "BI-EXISTING" });

    const res = await captureCorrectiveFailureBI({
      source: "self-upgrade-failure",
      signature: "unknown|trace",
      title: "t",
      body: "b",
    });

    expect(res).toEqual({
      action: "updated",
      itemId: "BI-EXISTING",
      fingerprint: correctiveFingerprint("self-upgrade-failure", "unknown|trace"),
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data.occurrenceCount).toEqual({ increment: 1 });
    expect(create).not.toHaveBeenCalled();
  });

  it("dedups by the stable fingerprint regardless of run id in the body", async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue({ itemId: "BI-1" });
    const fp = correctiveFingerprint("self-upgrade-failure", "unknown|same-trace");

    await captureCorrectiveFailureBI({ source: "self-upgrade-failure", signature: "unknown|same-trace", title: "t", body: "runId: SUR-AAA" });
    await captureCorrectiveFailureBI({ source: "self-upgrade-failure", signature: "unknown|same-trace", title: "t", body: "runId: SUR-BBB" });

    for (const call of findFirst.mock.calls) {
      expect(call[0].where.body.contains).toBe(`failureFingerprint: ${fp}`);
      expect(call[0].where.source).toBe("self-upgrade-failure");
    }
  });

  it("is best-effort: a prisma error returns skipped and never throws", async () => {
    findFirst.mockRejectedValue(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await captureCorrectiveFailureBI({ source: "build-failure", signature: "x", title: "t", body: "b" });
      expect(res).toEqual({ action: "skipped", reason: "error" });
    } finally {
      errSpy.mockRestore();
    }
  });
});
