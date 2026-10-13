import { beforeEach, describe, it, expect, vi } from "vitest";
import { assertLocalGpuFree } from "@/lib/inference/host-gpu-admission";

vi.mock("@/lib/inference/host-gpu-admission", () => ({ assertLocalGpuFree: vi.fn() }));
import {
  ResourceLane,
  LaneBusyError,
  getResourceLane,
  localInferenceMaxQueueDepth,
  localInferenceAutonomousAgingMs,
  withLocalInferenceLock,
  LOCAL_INFERENCE_LANE_KEY,
} from "./resource-lane";
import type { QueueTransitionInput } from "./queue-telemetry";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ResourceLane serialization", () => {
  it("runs one call at a time in FIFO order", async () => {
    const lane = new ResourceLane("compute:test", { record: () => {} });
    const order: string[] = [];
    const a = deferred<void>();
    const b = deferred<void>();

    const p1 = lane.run(async () => {
      order.push("a-start");
      await a.promise;
      order.push("a-end");
    });
    const p2 = lane.run(async () => {
      order.push("b-start");
      await b.promise;
      order.push("b-end");
    });

    // b must not start until a finishes.
    await Promise.resolve();
    expect(order).toEqual(["a-start"]);
    a.resolve();
    await p1;
    expect(order).toEqual(["a-start", "a-end", "b-start"]);
    b.resolve();
    await p2;
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("a failing call never wedges the lane", async () => {
    const lane = new ResourceLane("compute:test", { record: () => {} });
    await expect(lane.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // The next call still runs.
    await expect(lane.run(async () => 42)).resolves.toBe(42);
  });

  it("returns the fn's resolved value", async () => {
    const lane = new ResourceLane("compute:test", { record: () => {} });
    await expect(lane.run(async () => "ok")).resolves.toBe("ok");
  });

  it("serves an interactive waiter before an older autonomous waiter", async () => {
    const lane = new ResourceLane("compute:test", { record: () => {} });
    const holderGate = deferred<void>();
    const order: string[] = [];

    const holder = lane.run(async () => {
      order.push("holder");
      await holderGate.promise;
    }, { priority: "autonomous", autonomousAgingMs: 1_000 });
    await Promise.resolve();

    const autonomous = lane.run(async () => {
      order.push("autonomous");
    }, { priority: "autonomous", autonomousAgingMs: 1_000 });
    const interactive = lane.run(async () => {
      order.push("interactive");
    }, { priority: "interactive", autonomousAgingMs: 1_000 });

    holderGate.resolve();
    await Promise.all([holder, autonomous, interactive]);

    expect(order).toEqual(["holder", "interactive", "autonomous"]);
  });

  it("promotes an aged autonomous waiter ahead of newer interactive work", async () => {
    let clock = 0;
    const lane = new ResourceLane("compute:test", { record: () => {}, now: () => clock });
    const holderGate = deferred<void>();
    const order: string[] = [];

    const holder = lane.run(async () => {
      order.push("holder");
      await holderGate.promise;
    }, { priority: "autonomous", autonomousAgingMs: 100 });
    await Promise.resolve();

    clock = 10;
    const autonomous = lane.run(async () => {
      order.push("autonomous");
    }, { priority: "autonomous", autonomousAgingMs: 100 });
    clock = 150;
    const interactive = lane.run(async () => {
      order.push("interactive");
    }, { priority: "interactive", autonomousAgingMs: 100 });

    holderGate.resolve();
    await Promise.all([holder, autonomous, interactive]);

    expect(order).toEqual(["holder", "autonomous", "interactive"]);
  });
});

describe("ResourceLane bounded admission", () => {
  it("is unbounded by default (never rejects, matches the promise chain)", async () => {
    const lane = new ResourceLane("compute:test", { record: () => {} });
    const gate = deferred<void>();
    const runs = [
      lane.run(() => gate.promise),
      lane.run(async () => "second"),
      lane.run(async () => "third"),
    ];
    // None reject despite three queued behind a held slot.
    gate.resolve();
    await expect(Promise.all(runs)).resolves.toEqual([undefined, "second", "third"]);
  });

  it("rejects with LaneBusyError once waiting exceeds maxQueueDepth", async () => {
    const lane = new ResourceLane("compute:test", { record: () => {} });
    const gate = deferred<void>();
    // First call takes the slot (waiting goes 1 then 0 as it starts).
    const held = lane.run(() => gate.promise, { maxQueueDepth: 1 });
    // Let the first call start (waiting drops to 0).
    await Promise.resolve();
    // One more may WAIT (waiting → 1). A third at depth 1 is refused.
    const waiter = lane.run(async () => "queued", { maxQueueDepth: 1 });
    await expect(
      lane.run(async () => "refused", { maxQueueDepth: 1 }),
    ).rejects.toBeInstanceOf(LaneBusyError);

    gate.resolve();
    await expect(held).resolves.toBeUndefined();
    await expect(waiter).resolves.toBe("queued");
  });

  it("LaneBusyError carries the lane key and depth", async () => {
    const lane = new ResourceLane("compute:gpu", { record: () => {} });
    const gate = deferred<void>();
    lane.run(() => gate.promise, { maxQueueDepth: 0 }).catch(() => {});
    await Promise.resolve();
    try {
      await lane.run(async () => "x", { maxQueueDepth: 0 });
      throw new Error("expected LaneBusyError");
    } catch (err) {
      expect(err).toBeInstanceOf(LaneBusyError);
      expect((err as LaneBusyError).laneKey).toBe("compute:gpu");
      expect((err as LaneBusyError).code).toBe("lane_busy");
    }
    gate.resolve();
  });

  it("expires and removes a queued waiter without ever executing it", async () => {
    vi.useFakeTimers();
    try {
      const lane = new ResourceLane("compute:gpu", { record: () => {} });
      const holderGate = deferred<void>();
      const holder = lane.run(() => holderGate.promise);
      await Promise.resolve();

      const expiredFn = vi.fn(async () => "must-not-run");
      const timeout = Object.assign(new Error("admission expired"), {
        code: "INFERENCE_ADMISSION_TIMEOUT",
      });
      const waiting = lane.run(expiredFn, {
        waitTimeoutMs: 1_000,
        waitTimeoutError: () => timeout,
      });
      const rejected = expect(waiting).rejects.toBe(timeout);
      expect(lane.depth()).toBe(1);

      await vi.advanceTimersByTimeAsync(1_000);
      await rejected;
      expect(lane.depth()).toBe(0);

      holderGate.resolve();
      await holder;
      expect(expiredFn).not.toHaveBeenCalled();
      await expect(lane.run(async () => "next")).resolves.toBe("next");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ResourceLane telemetry", () => {
  it("emits enqueued → started → finished with lane key and durations", async () => {
    const events: QueueTransitionInput[] = [];
    let clock = 1000;
    const lane = new ResourceLane("compute:gpu", {
      record: (e) => events.push(e),
      now: () => (clock += 5),
    });
    await lane.run(async () => "done");

    expect(events.map((e) => e.transition)).toEqual(["enqueued", "started", "finished"]);
    expect(events.every((e) => e.queueKey === "compute:gpu")).toBe(true);
    expect(events.every((e) => e.itemKind === "compute")).toBe(true);
    const finished = events[2]!;
    expect(finished.outcome).toBe("success");
    expect(typeof finished.durations?.processMs).toBe("number");
  });

  it("records a failed outcome when fn throws", async () => {
    const events: QueueTransitionInput[] = [];
    const lane = new ResourceLane("compute:gpu", { record: (e) => events.push(e) });
    await lane.run(async () => { throw new Error("x"); }).catch(() => {});
    expect(events.at(-1)!.outcome).toBe("failed");
  });
});

describe("getResourceLane", () => {
  it("returns the same instance for a key", () => {
    const a = getResourceLane("compute:shared");
    const b = getResourceLane("compute:shared");
    expect(a).toBe(b);
  });
});

describe("localInferenceMaxQueueDepth", () => {
  const KEY = "DPF_LOCAL_INFERENCE_MAX_QUEUE_DEPTH";
  it("is null when unset (unbounded)", () => {
    delete process.env[KEY];
    expect(localInferenceMaxQueueDepth()).toBeNull();
  });
  it("parses a positive integer", () => {
    process.env[KEY] = "8";
    expect(localInferenceMaxQueueDepth()).toBe(8);
    delete process.env[KEY];
  });
  it("is null for invalid values", () => {
    process.env[KEY] = "-1";
    expect(localInferenceMaxQueueDepth()).toBeNull();
    process.env[KEY] = "abc";
    expect(localInferenceMaxQueueDepth()).toBeNull();
    delete process.env[KEY];
  });
});

describe("localInferenceAutonomousAgingMs", () => {
  const KEY = "DPF_LOCAL_INFERENCE_AUTONOMOUS_AGING_MS";
  it("defaults to the interactive admission budget", () => {
    delete process.env[KEY];
    expect(localInferenceAutonomousAgingMs()).toBe(120_000);
  });
  it("accepts a positive operator override and rejects invalid values", () => {
    process.env[KEY] = "45000";
    expect(localInferenceAutonomousAgingMs()).toBe(45_000);
    process.env[KEY] = "0";
    expect(localInferenceAutonomousAgingMs()).toBe(120_000);
    delete process.env[KEY];
  });
});

describe("withLocalInferenceLock — the ONE local-GPU admission gate (BI-98572A51)", () => {
  beforeEach(() => {
    vi.mocked(assertLocalGpuFree).mockReset().mockResolvedValue(undefined);
  });

  it("serializes concurrent local-inference callers strictly one at a time", async () => {
    // Simulates chat and a build specialist both wanting the single GPU: only
    // one runs at a time, the other waits — never double-subscribed.
    let active = 0;
    let maxActive = 0;
    const gate = deferred<void>();
    const run = () =>
      withLocalInferenceLock(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await gate.promise;
        active--;
        return "ok";
      });
    const a = run(); // "chat"
    const b = run(); // "build specialist"
    // Both scheduled, but only one may be inside the lane.
    await expect.poll(() => maxActive).toBe(1);
    gate.resolve();
    await expect(a).resolves.toBe("ok");
    await expect(b).resolves.toBe("ok");
    expect(maxActive).toBe(1);
  });

  it("acquires the canonical LOCAL_INFERENCE_LANE_KEY singleton (chat + build share it)", () => {
    // getResourceLane is one-lane-per-key, so every caller of withLocalInferenceLock —
    // chat-adapter and opencode-dispatch alike — operates the same instance.
    expect(getResourceLane(LOCAL_INFERENCE_LANE_KEY)).toBe(getResourceLane(LOCAL_INFERENCE_LANE_KEY));
  });

  it("does not probe host occupancy until a queued caller owns the lane", async () => {
    const holderGate = deferred<void>();
    const holder = withLocalInferenceLock(async () => holderGate.promise, {
      modelId: "qwen",
      origin: "autonomous",
    });
    await expect.poll(() => vi.mocked(assertLocalGpuFree).mock.calls.length).toBe(1);

    const interactive = withLocalInferenceLock(async () => "interactive", {
      modelId: "qwen",
      origin: "interactive",
    });
    await Promise.resolve();
    expect(assertLocalGpuFree).toHaveBeenCalledTimes(1);

    holderGate.resolve();
    await holder;
    await expect(interactive).resolves.toBe("interactive");
    expect(assertLocalGpuFree).toHaveBeenCalledTimes(2);
  });

  it("preserves the interactive admission budget and never dispatches an expired waiter", async () => {
    const key = "DPF_INFERENCE_ADMISSION_TIMEOUT_MS";
    process.env[key] = "1000";
    vi.useFakeTimers();
    try {
      const holderGate = deferred<void>();
      const holder = withLocalInferenceLock(() => holderGate.promise, {
        modelId: "qwen",
        origin: "autonomous",
      });
      await Promise.resolve();

      const expiredFn = vi.fn(async () => "must-not-run");
      const waiting = withLocalInferenceLock(expiredFn, {
        modelId: "qwen",
        origin: "interactive",
      });
      const rejected = expect(waiting).rejects.toMatchObject({
        code: "INFERENCE_ADMISSION_TIMEOUT",
      });

      await vi.advanceTimersByTimeAsync(1_000);
      await rejected;
      holderGate.resolve();
      await holder;
      expect(expiredFn).not.toHaveBeenCalled();
    } finally {
      delete process.env[key];
      vi.useRealTimers();
    }
  });
});

describe("ResourceLane parent cancellation", () => {
  it("removes an aborted priority waiter and its timeout before the next dispatch", async () => {
    vi.useFakeTimers();
    const lane = new ResourceLane("compute:priority-parent", { record: () => {} });
    const hold = deferred<void>();
    const active = lane.run(() => hold.promise);
    await Promise.resolve();
    const abort = new AbortController();
    const dispatch = vi.fn(async () => "expired");
    const canceled = lane.run(dispatch, {
      priority: "interactive", signal: abort.signal, waitTimeoutMs: 500,
    }).catch(error => error);
    const next = lane.run(async () => "background", { priority: "autonomous" });
    try {
      abort.abort(new Error("parent expired"));
      expect((await canceled).message).toBe("parent expired");
      expect(lane.depth()).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(lane.depth()).toBe(1);
      expect(dispatch).not.toHaveBeenCalled();
      hold.resolve();
      await active;
      await expect(next).resolves.toBe("background");
      expect(lane.depth()).toBe(0);
    } finally {
      hold.resolve();
      await active;
      vi.useRealTimers();
    }
  });

  it("removes a canceled waiter without releasing the active GPU holder", async () => {
    const lane = new ResourceLane("compute:parent-cancel", { record: () => {} });
    const hold = deferred<void>();
    const active = lane.run(() => hold.promise);
    await Promise.resolve();
    const abort = new AbortController();
    let calls = 0;
    const canceled = lane.run(async () => { calls++; }, { signal: abort.signal }).catch(error => error);
    try {
      expect(lane.depth()).toBe(1);
      abort.abort(new Error("parent expired"));
      await Promise.resolve();
      expect(lane.depth()).toBe(0);
      expect(calls).toBe(0);
    } finally {
      hold.resolve();
      await active;
      await canceled;
    }
    expect(calls).toBe(0);
    await expect(lane.run(async () => "next")).resolves.toBe("next");
  });
});
