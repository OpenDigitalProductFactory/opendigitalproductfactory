import { describe, expect, it, vi } from "vitest";

// BI-C64EDA33 (AC-2): a leased effect worker runs side effects and reports each
// result back as a command; it never writes room state itself.

import { createEffectWorker, effectBackoffMs, effectResultCommandId, RetireEffectError, type EffectReport } from "./effect-worker.server";
import type { ClaimedEffect } from "./workroom-effect-store";

const effect = (over: Partial<ClaimedEffect> = {}): ClaimedEffect => ({
  id: "e1", workCapsuleId: "row-1", capsuleId: "WC-1", commandId: "cmd", kind: "start-turn", processBound: true,
  sessionGeneration: "gen-1", payload: { prompt: "go" }, attemptCount: 1, maxAttempts: 3, ...over,
});

function harness(batches: ClaimedEffect[][], execute: (e: ClaimedEffect) => Promise<Record<string, unknown> | void>) {
  const queue = [...batches];
  const reports: Array<[string, EffectReport]> = [];
  const claim = vi.fn(async () => queue.shift() ?? []);
  const worker = createEffectWorker({
    owner: "host-1", claim, recoverExpired: vi.fn(async () => 0), liveGenerations: () => ["gen-1"], execute,
    report: async (e, r) => { reports.push([e.id, r]); }, log: () => {},
  });
  return { worker, claim, reports };
}

describe("the effect worker", () => {
  it("runs each claimed effect and reports its result", async () => {
    const h = harness([[effect()]], async () => ({ turnId: "t1" }));
    await expect(h.worker.drain()).resolves.toBe(1);
    expect(h.reports).toEqual([["e1", { outcome: "succeeded", final: true, result: { turnId: "t1" } }]]);
    expect(h.claim).toHaveBeenCalledWith(expect.objectContaining({ owner: "host-1", liveGenerations: ["gen-1"] }));
  });

  it("reports a failure for retry with backoff, and as final once attempts run out", async () => {
    const boom = async () => { throw new Error("provider busy"); };
    const h = harness([[effect({ attemptCount: 1 })], [effect({ id: "e2", attemptCount: 3 })]], boom);
    await h.worker.drain();
    expect(h.reports[0]).toEqual(["e1", { outcome: "failed", final: false, error: "provider busy", retryAfterMs: effectBackoffMs(1) }]);
    expect(h.reports[1]).toEqual(["e2", { outcome: "failed", final: true, error: "provider busy", retryAfterMs: undefined }]);
  });

  it("retires an effect whose provider process is gone instead of retrying it", async () => {
    const h = harness([[effect()]], async () => { throw new RetireEffectError("process gone"); });
    await h.worker.drain();
    expect(h.reports).toEqual([["e1", { outcome: "retired", final: true, error: "process gone" }]]);
  });

  it("keeps going when a report fails: the lease expires and the deterministic id makes the next report a replay", async () => {
    const worker = createEffectWorker({
      owner: "h", claim: vi.fn().mockResolvedValueOnce([effect()]).mockResolvedValue([]), recoverExpired: async () => 0,
      liveGenerations: () => [], execute: async () => ({}), report: async () => { throw new Error("db down"); }, log: () => {},
    });
    await expect(worker.drain()).resolves.toBe(1);
    expect(effectResultCommandId(effect({ attemptCount: 2 }))).toBe("effect-result:e1:2");
  });

  it("shares one pass between concurrent callers, and runs another when kicked during it", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = harness([[effect()], [effect({ id: "e2" })]], async (e) => { if (e.id === "e1") await gate; return {}; });
    const first = h.worker.drain();
    const second = h.worker.drain();
    release();
    await Promise.all([first, second]);
    expect(h.reports.map(([id]) => id)).toEqual(["e1", "e2"]);
  });

  it("backs off exponentially, capped at a minute", () => {
    expect([1, 2, 3, 10].map(effectBackoffMs)).toEqual([1000, 2000, 4000, 60_000]);
  });
});
