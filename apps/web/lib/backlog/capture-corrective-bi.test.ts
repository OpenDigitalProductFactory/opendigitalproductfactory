import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

import { captureCorrectiveFailureBI, correctiveFingerprint } from "./capture-corrective-bi";

beforeEach(() => {
  findFirst.mockReset();
  create.mockReset();
  update.mockReset();
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
