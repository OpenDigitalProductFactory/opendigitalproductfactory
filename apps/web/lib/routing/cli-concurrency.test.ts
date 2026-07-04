import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  withCliSlot,
  cliConcurrencyStats,
  cliSaturationPercent,
  __resetCliConcurrencyForTest,
} from "./cli-concurrency";

// A controllable deferred task: resolves only when we call .finish().
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, finish: resolve };
}

describe("cli-concurrency gate", () => {
  const origEnv = process.env.DPF_CLI_MAX_CONCURRENCY;

  beforeEach(() => {
    __resetCliConcurrencyForTest();
    process.env.DPF_CLI_MAX_CONCURRENCY = "2";
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env.DPF_CLI_MAX_CONCURRENCY;
    else process.env.DPF_CLI_MAX_CONCURRENCY = origEnv;
    __resetCliConcurrencyForTest();
    vi.restoreAllMocks();
  });

  it("runs up to the cap concurrently and queues the rest", async () => {
    const a = deferred();
    const b = deferred();
    const c = deferred();

    const ranA = withCliSlot(() => a.promise);
    const ranB = withCliSlot(() => b.promise);
    const ranC = withCliSlot(() => c.promise);

    // Let microtasks flush so acquires settle.
    await Promise.resolve();
    await Promise.resolve();

    // Cap is 2 → A and B in flight, C queued.
    expect(cliConcurrencyStats()).toEqual({ inFlight: 2, queued: 1, max: 2 });

    // Finish A → its slot hands off to C.
    a.finish();
    await ranA;
    await Promise.resolve();
    expect(cliConcurrencyStats()).toMatchObject({ inFlight: 2, queued: 0 });

    b.finish();
    c.finish();
    await Promise.all([ranB, ranC]);
    expect(cliConcurrencyStats()).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it("releases the slot even when the task rejects (no permanent leak)", async () => {
    process.env.DPF_CLI_MAX_CONCURRENCY = "1";
    __resetCliConcurrencyForTest();

    const boom = withCliSlot(() => Promise.reject(new Error("cli blew up")));
    await expect(boom).rejects.toThrow("cli blew up");

    // Slot must be free again for the next caller.
    expect(cliConcurrencyStats()).toMatchObject({ inFlight: 0, queued: 0 });

    const ok = await withCliSlot(() => Promise.resolve("recovered"));
    expect(ok).toBe("recovered");
  });

  it("preserves FIFO order for queued callers", async () => {
    process.env.DPF_CLI_MAX_CONCURRENCY = "1";
    __resetCliConcurrencyForTest();

    const order: string[] = [];
    const first = deferred();

    const p1 = withCliSlot(async () => {
      order.push("start-1");
      await first.promise;
      order.push("end-1");
    });
    const p2 = withCliSlot(async () => {
      order.push("run-2");
    });
    const p3 = withCliSlot(async () => {
      order.push("run-3");
    });

    await Promise.resolve();
    // Only the first holds the single slot; 2 and 3 are queued in order.
    expect(cliConcurrencyStats()).toMatchObject({ inFlight: 1, queued: 2 });

    first.finish();
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual(["start-1", "end-1", "run-2", "run-3"]);
  });

  it("defaults to a cap of 4 when the env var is unset or invalid", async () => {
    delete process.env.DPF_CLI_MAX_CONCURRENCY;
    __resetCliConcurrencyForTest();
    expect(cliConcurrencyStats().max).toBe(4);

    process.env.DPF_CLI_MAX_CONCURRENCY = "not-a-number";
    expect(cliConcurrencyStats().max).toBe(4);

    process.env.DPF_CLI_MAX_CONCURRENCY = "0";
    expect(cliConcurrencyStats().max).toBe(4);
  });
});

describe("cliSaturationPercent (routing spread signal)", () => {
  const origEnv = process.env.DPF_CLI_MAX_CONCURRENCY;

  beforeEach(() => {
    __resetCliConcurrencyForTest();
    process.env.DPF_CLI_MAX_CONCURRENCY = "4";
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env.DPF_CLI_MAX_CONCURRENCY;
    else process.env.DPF_CLI_MAX_CONCURRENCY = origEnv;
    __resetCliConcurrencyForTest();
  });

  it("is 0 while the pool is idle (never penalizes CLI when the sandbox is free)", () => {
    expect(cliSaturationPercent()).toBe(0);
  });

  it("reflects in-flight holders against the cap", async () => {
    const a = deferred();
    const b = deferred();
    const ra = withCliSlot(() => a.promise);
    const rb = withCliSlot(() => b.promise);
    await Promise.resolve();
    await Promise.resolve();
    // 2 in flight, cap 4 → 50%.
    expect(cliSaturationPercent()).toBe(50);
    a.finish();
    b.finish();
    await Promise.all([ra, rb]);
    expect(cliSaturationPercent()).toBe(0);
  });

  it("exceeds 100% when a backlog queues (drives a hard scorer penalty)", async () => {
    process.env.DPF_CLI_MAX_CONCURRENCY = "2";
    __resetCliConcurrencyForTest();
    const tasks = [deferred(), deferred(), deferred(), deferred()];
    const runs = tasks.map((t) => withCliSlot(() => t.promise));
    await Promise.resolve();
    await Promise.resolve();
    // 2 in flight + 2 queued at cap 2 → (4/2)*100 = 200%.
    expect(cliSaturationPercent()).toBe(200);
    tasks.forEach((t) => t.finish());
    await Promise.all(runs);
    expect(cliSaturationPercent()).toBe(0);
  });
});
