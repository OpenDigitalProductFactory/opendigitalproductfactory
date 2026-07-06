import { describe, it, expect } from "vitest";
import {
  ResourceLane,
  LaneBusyError,
  getResourceLane,
  localInferenceMaxQueueDepth,
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
