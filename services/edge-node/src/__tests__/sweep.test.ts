import { describe, expect, it, vi } from "vitest";

import {
  AuthorityHttpError,
  type AuthorityApiClient,
} from "../api-client";
import type { EdgeNodeConfig } from "../config";
import type { EdgeNodeState } from "../state";
import { runSweepLoop } from "../sweep";

function makeConfig(overrides: Partial<EdgeNodeConfig> = {}): EdgeNodeConfig {
  return {
    authorityUrl: "http://test-authority",
    edgeNodeName: "test-edge",
    platform: "linux",
    installMode: "container-host",
    version: "0.1.0-test",
    stateDir: "/tmp/test-edge",
    bootstrapToken: undefined,
    ...overrides,
  };
}

function makeState(overrides: Partial<EdgeNodeState> = {}): EdgeNodeState {
  return {
    nodeId: "edge_test",
    nodeToken: "dpfedge_TESTTOKEN",
    enrolledAt: "2026-05-12T00:00:00.000Z",
    heartbeatIntervalSec: 60,
    sweepIntervalSec: 300,
    acceptedCapabilities: ["discovery.network"],
    trustState: "trusted",
    ...overrides,
  };
}

function fakeAdapter() {
  return {
    hostname: () => "test-host",
    platform: () => "linux" as NodeJS.Platform,
    release: () => "6.5.0",
    arch: () => "x64",
    uptime: () => 100,
    totalmem: () => 1024,
    cpus: () => [{ model: "fake", speed: 1000 }],
    networkInterfaces: () => ({}),
  };
}

function makeApi(submit: AuthorityApiClient["submitDiscoveryRun"]): AuthorityApiClient {
  return {
    submitDiscoveryRun: submit,
    enroll: vi.fn(),
    heartbeat: vi.fn(),
  } as unknown as AuthorityApiClient;
}

describe("runSweepLoop", () => {
  it("submits one envelope per iteration on the happy path", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    let runKeyCounter = 0;
    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 3,
      hostInfoAdapter: fakeAdapter(),
      newRunKey: () => `run_${++runKeyCounter}`,
      now: () => new Date("2026-05-12T12:00:00.000Z"),
    });

    expect(submit).toHaveBeenCalledTimes(3);
    const firstCall = submit.mock.calls[0]!;
    const envelope = firstCall[1] as Record<string, unknown>;
    expect(envelope.runKey).toBe("run_1");
    expect(envelope.agentMode).toBe("container-host");
    expect(envelope.agentVersion).toBe("0.1.0-test");
    expect(envelope.observedAt).toBe("2026-05-12T12:00:00.000Z");
    expect(envelope.capabilities).toEqual(["discovery.network"]);
    expect((envelope.items as unknown[]).length).toBe(1);
    expect(envelope.relationships).toEqual([]);
  });

  it("stamps a unique runKey per sweep tick", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    let counter = 0;
    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 5,
      hostInfoAdapter: fakeAdapter(),
      newRunKey: () => `run_${++counter}`,
    });

    const runKeys = submit.mock.calls.map((c) => (c[1] as Record<string, unknown>).runKey);
    expect(runKeys).toEqual(["run_1", "run_2", "run_3", "run_4", "run_5"]);
  });

  it("uses state.nodeToken as the bearer token on every submission", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState({ nodeToken: "dpfedge_specifictoken" }),
      sleep: async () => {},
      maxIterations: 2,
      hostInfoAdapter: fakeAdapter(),
    });

    expect(submit.mock.calls[0]![0]).toBe("dpfedge_specifictoken");
    expect(submit.mock.calls[1]![0]).toBe("dpfedge_specifictoken");
  });

  it("drops the envelope on 4xx client error (no retry)", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(
        new AuthorityHttpError(413, "payload_too_large", "too big"),
      )
      .mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 2,
      hostInfoAdapter: fakeAdapter(),
    });

    // 2 iterations × 1 submit each (no retry of dropped 413) = 2 total.
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("queues + retries on 5xx server error", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(
        new AuthorityHttpError(503, "service_unavailable", "down"),
      )
      .mockResolvedValueOnce({ ok: true }) // drain old envelope
      .mockResolvedValueOnce({ ok: true }); // submit new envelope
    const api = makeApi(submit);

    let counter = 0;
    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 2,
      hostInfoAdapter: fakeAdapter(),
      newRunKey: () => `run_${++counter}`,
    });

    // 1st tick: submit run_1 → 503 → queue.
    // 2nd tick: drain queue (submit run_1 again, succeeds) + submit run_2.
    expect(submit).toHaveBeenCalledTimes(3);
    const runKeys = submit.mock.calls.map((c) => (c[1] as Record<string, unknown>).runKey);
    expect(runKeys).toEqual(["run_1", "run_1", "run_2"]);
  });

  it("queues + retries on network error", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    const api = makeApi(submit);

    let counter = 0;
    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 2,
      hostInfoAdapter: fakeAdapter(),
      newRunKey: () => `run_${++counter}`,
    });

    expect(submit).toHaveBeenCalledTimes(3);
  });

  it("respects 429 the same as 5xx (queues for retry, not drop)", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new AuthorityHttpError(429, "rate_limited", "slow down"))
      .mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    let counter = 0;
    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 2,
      hostInfoAdapter: fakeAdapter(),
      newRunKey: () => `run_${++counter}`,
    });

    expect(submit).toHaveBeenCalledTimes(3);
    const runKeys = submit.mock.calls.map((c) => (c[1] as Record<string, unknown>).runKey);
    expect(runKeys).toEqual(["run_1", "run_1", "run_2"]);
  });

  it("treats 401 node_revoked as drop (heartbeat loop owns lifecycle)", async () => {
    const submit = vi
      .fn()
      .mockRejectedValue(
        new AuthorityHttpError(401, "node_revoked", "revoked"),
      );
    const api = makeApi(submit);

    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 3,
      hostInfoAdapter: fakeAdapter(),
    });

    // 3 iterations, each tries once, drops, no retry. So 3 calls total.
    expect(submit).toHaveBeenCalledTimes(3);
  });

  it("drops oldest queued entry when buffer overflows", async () => {
    // Force 3 transient failures, buffer capped at 2 → oldest gets dropped.
    let resolveSubmit: () => void = () => {};
    const submit = vi.fn(async () => {
      // Always fail transiently so the buffer fills up.
      throw new AuthorityHttpError(503, "service_unavailable", "down");
    });
    void resolveSubmit;
    const api = makeApi(submit);

    const logs: Array<{ level: string; msg: string }> = [];
    const log = (level: "info" | "warn" | "error", msg: string) => {
      logs.push({ level, msg });
    };

    let counter = 0;
    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 5,
      hostInfoAdapter: fakeAdapter(),
      newRunKey: () => `run_${++counter}`,
      maxBufferedSubmissions: 2,
      log,
    });

    // Should have logged buffer-overflow drops.
    const drops = logs.filter((l) => l.msg.includes("buffer full"));
    expect(drops.length).toBeGreaterThanOrEqual(1);
    expect(drops[0]!.msg).toContain("dropped oldest");
  });

  it("uses sweepIntervalSec from state to schedule each tick", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    const sleepCalls: number[] = [];
    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState({ sweepIntervalSec: 30 }),
      sleep,
      maxIterations: 3,
      hostInfoAdapter: fakeAdapter(),
    });

    // 3 iterations means 3 sleeps at the end of each tick.
    expect(sleepCalls).toEqual([30_000, 30_000, 30_000]);
  });

  it("continues sweeping even if a single submission collection throws", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const api = makeApi(submit);

    // Throw on the 2nd collect call to simulate a transient collect bug.
    let collectCallCount = 0;
    const throwingAdapter = () => {
      const base = fakeAdapter();
      return {
        ...base,
        hostname: () => {
          collectCallCount += 1;
          if (collectCallCount === 2) {
            throw new Error("collect glitch");
          }
          return "test-host";
        },
      };
    };

    await runSweepLoop({
      config: makeConfig(),
      api,
      state: makeState(),
      sleep: async () => {},
      maxIterations: 3,
      hostInfoAdapter: throwingAdapter(),
    });

    // Iter 1 + 3 submit; iter 2 throws during collect. → 2 submits.
    expect(submit).toHaveBeenCalledTimes(2);
  });
});
