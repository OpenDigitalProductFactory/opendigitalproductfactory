import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const restricted = vi.hoisted(() => ({ active: false, request: vi.fn(), fetch: vi.fn() }));
const platform = vi.hoisted(() => ({ readFile: vi.fn(), spawnSync: vi.fn() }));
vi.mock("node:fs", () => ({ default: { promises: { readFile: platform.readFile } } }));
vi.mock("node:child_process", () => ({ spawnSync: platform.spawnSync }));
vi.mock("../routing/reassessment-execution-scope", async load => ({
  ...await load<typeof import("../routing/reassessment-execution-scope")>(),
  currentReassessmentExecution: () => restricted.active ? { qualification: { finiteTokenProof: { apiRoot: "http://dmr.invalid" } } } : null,
}));
vi.mock("./reassessment-http-capture", () => ({ currentReassessmentHttpTransport: () => ({ fetchImpl: restricted.fetch, assertCurrent: async () => {} }),
  captureReassessmentHttpRequest: restricted.request }));
import { ReassessmentExecutionError } from "../routing/reassessment-execution-scope";

import {
  assertLocalGpuFree,
  decideLocalGpuAdmission,
  inspectLocalGpuAdmission,
  parseEngineRunners,
  parseHostGpuSnapshotJson,
  parseNvidiaSmiCsv,
  requiredLocalModelMiB,
  type HostGpuSnapshot,
  type LocalRunner,
} from "./host-gpu-admission";

const NOW = 1_700_000_000_000;
beforeEach(() => {
  restricted.active = false; restricted.request.mockReset(); restricted.fetch.mockReset(); platform.spawnSync.mockReset();
  platform.readFile.mockReset().mockRejectedValue(Object.assign(new Error("Snapshot absent"), { code: "ENOENT" }));
});
afterEach(() => vi.unstubAllEnvs());

function snap(overrides: Partial<HostGpuSnapshot> = {}): HostGpuSnapshot {
  return {
    observedAtMs: NOW,
    memoryUsedMiB: 800,
    memoryTotalMiB: 24564,
    utilizationPercent: 4,
    ...overrides,
  };
}

const parked: LocalRunner = {
  modelName: "qwen",
  mode: "completion",
  inUse: false,
  loading: false,
};

describe("decideLocalGpuAdmission", () => {
  it("treats the measured game-only card as busy", () => {
    // Fallout 76 on this 4090, model unloaded: 5886/24564 MiB at 51%.
    const decision = decideLocalGpuAdmission({
      runners: [],
      snapshot: snap({ memoryUsedMiB: 5886, utilizationPercent: 51 }),
      nowMs: NOW,
      requiredMiB: 23552,
    });
    expect(decision).toEqual({ defer: "host-gpu-busy", unloadIdle: false });
  });

  it("releases a parked model when the card is busy and nothing is serving", () => {
    const decision = decideLocalGpuAdmission({
      runners: [parked],
      snapshot: snap({ memoryUsedMiB: 23714, utilizationPercent: 59 }),
      nowMs: NOW,
      requiredMiB: 23552,
    });
    expect(decision).toEqual({ defer: "host-gpu-busy", unloadIdle: true });
  });

  it("defers a cold start that will not fit beside the other resident", () => {
    const decision = decideLocalGpuAdmission({
      runners: [],
      snapshot: snap({ memoryUsedMiB: 8000, utilizationPercent: 10 }),
      nowMs: NOW,
      requiredMiB: 23552,
    });
    expect(decision).toEqual({ defer: "host-gpu-busy", unloadIdle: false });
  });

  it("reuses an idle runner we already loaded when compute is idle", () => {
    const decision = decideLocalGpuAdmission({
      runners: [parked],
      snapshot: snap({ memoryUsedMiB: 23000, utilizationPercent: 4 }),
      nowMs: NOW,
      requiredMiB: 23552,
    });
    expect(decision).toEqual({ defer: null, unloadIdle: false });
  });

  it("does not unload a runner that is loading or serving", () => {
    const serving = decideLocalGpuAdmission({
      runners: [{ ...parked, inUse: true }],
      snapshot: snap({ utilizationPercent: 4 }),
      nowMs: NOW,
      requiredMiB: null,
    });
    const loading = decideLocalGpuAdmission({
      runners: [{ ...parked, loading: true }],
      snapshot: null,
      nowMs: NOW,
      requiredMiB: null,
    });
    expect(serving).toEqual({ defer: "local-runner-busy", unloadIdle: false });
    expect(loading).toEqual({ defer: "local-runner-busy", unloadIdle: false });
  });

  it("does not invent a busy card from a missing or stale snapshot", () => {
    expect(decideLocalGpuAdmission({
      runners: [],
      snapshot: null,
      nowMs: NOW,
      requiredMiB: 23552,
    })).toEqual({ defer: null, unloadIdle: false });
    expect(decideLocalGpuAdmission({
      runners: [],
      snapshot: snap({ observedAtMs: NOW - 21_000, utilizationPercent: 99 }),
      nowMs: NOW,
      requiredMiB: 23552,
    })).toEqual({ defer: null, unloadIdle: false });
    expect(decideLocalGpuAdmission({
      runners: [],
      snapshot: snap({ observedAtMs: NOW + 61_000, utilizationPercent: 99 }),
      nowMs: NOW,
      requiredMiB: 23552,
    })).toEqual({ defer: null, unloadIdle: false });
  });
});

describe("host GPU snapshot parsing", () => {
  it("sizes the governed 27B model as weights plus headroom", () => {
    expect(requiredLocalModelMiB("hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M")).toBe(23552);
    expect(requiredLocalModelMiB("unknown-model")).toBeNull();
  });

  it("parses the publisher JSON and an nvidia-smi csv line", () => {
    expect(parseHostGpuSnapshotJson(JSON.stringify({
      observedAt: "2026-09-27T15:45:00.000Z",
      memoryUsedMiB: 5886,
      memoryTotalMiB: 24564,
      utilizationPercent: 51,
    }))).toMatchObject({ memoryUsedMiB: 5886, utilizationPercent: 51 });
    expect(parseNvidiaSmiCsv("5886, 24564, 51", NOW)).toEqual({
      observedAtMs: NOW,
      memoryUsedMiB: 5886,
      memoryTotalMiB: 24564,
      utilizationPercent: 51,
    });
    expect(parseHostGpuSnapshotJson("not-json")).toBeNull();
    expect(parseNvidiaSmiCsv("nope", NOW)).toBeNull();
  });

  it("reads Docker Model Runner rows in either field spelling", () => {
    expect(parseEngineRunners([
      { model_name: "qwen", mode: "completion", in_use: true, loading: false },
      { modelName: "embed", mode: "embedding", inUse: false, loading: true },
      "skip",
    ])).toEqual([
      { modelName: "qwen", mode: "completion", inUse: true, loading: false },
      { modelName: "embed", mode: "embedding", inUse: false, loading: true },
    ]);
    expect(parseEngineRunners({ not: "a list" })).toEqual([]);
  });

  it("treats a failed probe as an empty card, not a busy one", async () => {
    const decision = await inspectLocalGpuAdmission({
      nowMs: NOW,
      modelId: "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M",
      listRunners: async () => { throw new Error("runner down"); },
      readSnapshot: async () => { throw new Error("no snapshot"); },
    });
    expect(decision).toEqual({ defer: null, unloadIdle: false });
  });
});

describe("assertLocalGpuFree", () => {
  it("captures the exact capacity GET with its published snapshot and decision", async () => {
    restricted.active = true;
    let captured: unknown;
    restricted.request.mockImplementation(async (input: { captureAdditional(response: Response): Promise<unknown> }) => {
      const response = new Response("[]", { status: 200 }); captured = await input.captureAdditional(response.clone()); return response;
    });
    await expect(inspectLocalGpuAdmission({ nowMs: NOW, readSnapshot: async () => snap() })).resolves.toEqual({ defer: null, unloadIdle: false });
    expect(restricted.request).toHaveBeenCalledWith(expect.objectContaining({ url: "http://dmr.invalid/engines/ps", method: "GET", operation: "configuration" }));
    expect(captured).toMatchObject({ snapshot: snap(), decision: { defer: null, unloadIdle: false }, runners: [] });
    expect(restricted.fetch).not.toHaveBeenCalled();
  });
  it("propagates a captured capacity refusal through the ordinary best-effort catch", async () => {
    const refusal = new ReassessmentExecutionError("reassessment-capture-unavailable");
    await expect(assertLocalGpuFree({ providerId: "local", inspectGpu: async () => { throw refusal; } })).rejects.toBe(refusal);
    await expect(inspectLocalGpuAdmission({ nowMs: NOW, readSnapshot: async () => snap(),
      listRunners: async () => { throw refusal; } })).rejects.toBe(refusal);
  });
  it("refuses automatic unload in a restricted composition while retaining capacity deferral", async () => {
    restricted.active = true;
    const unloadIdleRunners = vi.fn();
    await expect(assertLocalGpuFree({ providerId: "local",
      inspectGpu: async () => ({ defer: "host-gpu-busy", unloadIdle: true }), unloadIdleRunners,
    })).rejects.toMatchObject({ reason: "host-gpu-busy" });
    expect(unloadIdleRunners).not.toHaveBeenCalled();
  });
  it("does not read the live GPU from a unit test", async () => {
    await expect(assertLocalGpuFree({ providerId: "local", modelId: "qwen" })).resolves.toBeUndefined();
  });

  it("leaves a cloud provider alone", async () => {
    const inspectGpu = vi.fn();
    await expect(assertLocalGpuFree({ providerId: "openai", inspectGpu })).resolves.toBeUndefined();
    expect(inspectGpu).not.toHaveBeenCalled();
  });

  it("defers and releases a parked runner when another program owns the card", async () => {
    const unloadIdleRunners = vi.fn().mockResolvedValue(undefined);
    const inspectGpu = vi.fn().mockResolvedValue({ defer: "host-gpu-busy", unloadIdle: true });
    await expect(assertLocalGpuFree({
      providerId: "local",
      modelId: "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M",
      inspectGpu,
      unloadIdleRunners,
    })).rejects.toMatchObject({
      name: "LocalProviderCapacityDeferredError",
      reason: "host-gpu-busy",
    });
    expect(inspectGpu).toHaveBeenCalledWith({
      modelId: "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M",
    });
    expect(unloadIdleRunners).toHaveBeenCalledOnce();
  });

  it("does not unload a runner that is already serving a request", async () => {
    const unloadIdleRunners = vi.fn();
    await expect(assertLocalGpuFree({
      providerId: "ollama",
      inspectGpu: async () => ({ defer: "local-runner-busy", unloadIdle: false }),
      unloadIdleRunners,
    })).rejects.toMatchObject({ reason: "local-runner-busy" });
    expect(unloadIdleRunners).not.toHaveBeenCalled();
  });

  it("still defers when releasing the parked runner fails", async () => {
    await expect(assertLocalGpuFree({
      providerId: "local",
      inspectGpu: async () => ({ defer: "host-gpu-busy", unloadIdle: true }),
      unloadIdleRunners: async () => { throw new Error("unload failed"); },
    })).rejects.toMatchObject({ reason: "host-gpu-busy" });
  });
});

describe("captured capacity preserves ordinary unknown telemetry policy", () => {
  function captureRunners(rows: unknown = []) {
    const observations: Array<Record<string, unknown>> = [];
    restricted.request.mockImplementation(async (input: { captureAdditional(response: Response): Promise<unknown> }) => {
      const response = new Response(JSON.stringify(rows), { status: 200 });
      observations.push(await input.captureAdditional(response.clone()) as Record<string, unknown>);
      return response;
    });
    return observations;
  }
  it.each(["absent", "stale", "future"])("captures %s telemetry as unknown and uses the normal decision without inventing idle metrics", async state => {
    restricted.active = true; vi.stubEnv("DPF_HOST_GPU_SNAPSHOT_FILE", "/fixture-state/host-gpu.json");
    const raw = Buffer.from(JSON.stringify(snap({ observedAtMs: state === "stale" ? NOW - 21_000 : NOW + 61_000, utilizationPercent: 99 })));
    if (state !== "absent") platform.readFile.mockResolvedValue(raw);
    const observations = captureRunners();
    await expect(inspectLocalGpuAdmission({ nowMs: NOW, modelId: "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M" })).resolves.toEqual({ defer: null, unloadIdle: false });
    expect(observations).toEqual([expect.objectContaining({ snapshot: null, runners: [], decision: { defer: null, unloadIdle: false },
      provenance: expect.objectContaining({ source: "published-file", path: "/fixture-state/host-gpu.json", unknownReason: `published-snapshot-${state}` }) })]);
    if (state === "absent") expect(observations[0]!.provenance).toEqual(expect.objectContaining({ readOutcome: "absent", errorCode: "ENOENT" }));
    else expect(observations[0]!.provenance).toEqual(expect.objectContaining({ readOutcome: "complete", bodyEncoding: "base64", bodyBase64: raw.toString("base64") }));
    expect(platform.spawnSync).not.toHaveBeenCalled(); expect(restricted.fetch).not.toHaveBeenCalled();
    expect(restricted.request).toHaveBeenCalledWith(expect.objectContaining({ url: "http://dmr.invalid/engines/ps", method: "GET", operation: "configuration" }));
  });
  it.each(["in_use", "loading"])("still defers on a captured %s runner when host telemetry is absent", async busyField => {
    restricted.active = true;
    const observations = captureRunners([{ model_name: "qwen", mode: "completion", in_use: false, loading: false, [busyField]: true }]);
    await expect(assertLocalGpuFree({ providerId: "local" })).rejects.toMatchObject({ reason: "local-runner-busy" });
    expect(observations[0]).toMatchObject({ snapshot: null, decision: { defer: "local-runner-busy", unloadIdle: false } });
    expect(platform.spawnSync).not.toHaveBeenCalled();
  });
  it("still defers a fresh busy snapshot and never unloads the idle runner", async () => {
    restricted.active = true; platform.readFile.mockResolvedValue(Buffer.from(JSON.stringify(snap({ observedAtMs: Date.now(), utilizationPercent: 80 }))));
    const observations = captureRunners([{ model_name: "qwen", mode: "completion", in_use: false, loading: false }]), unloadIdleRunners = vi.fn();
    await expect(assertLocalGpuFree({ providerId: "local", unloadIdleRunners })).rejects.toMatchObject({ reason: "host-gpu-busy" });
    expect(observations[0]).toMatchObject({ decision: { defer: "host-gpu-busy", unloadIdle: true } });
    expect(unloadIdleRunners).not.toHaveBeenCalled(); expect(platform.spawnSync).not.toHaveBeenCalled();
  });
  it.each(["EACCES", "EIO"])("refuses %s rather than treating a failed read as absent telemetry", async code => {
    restricted.active = true; platform.readFile.mockRejectedValue(Object.assign(new Error("Read failed"), { code })); captureRunners();
    await expect(inspectLocalGpuAdmission({ nowMs: NOW })).rejects.toThrow(/capacity-evidence-unavailable/);
    expect(restricted.request).not.toHaveBeenCalled(); expect(platform.spawnSync).not.toHaveBeenCalled();
  });
  it.each(["invalid-json", "conflicting-time", "duplicate-key", "invalid-utf8", "coerced-metric", "out-of-range"])("refuses malformed published evidence: %s", async problem => {
    restricted.active = true;
    let raw = JSON.stringify(snap());
    if (problem === "invalid-json") raw = "not json";
    if (problem === "conflicting-time") raw = JSON.stringify({ ...snap(), observedAt: new Date(NOW - 1_000).toISOString() });
    if (problem === "duplicate-key") raw = raw.replace('"memoryUsedMiB":800', '"memoryUsedMiB":900,"memoryUsedMiB":800');
    if (problem === "coerced-metric") raw = JSON.stringify({ ...snap(), memoryUsedMiB: null });
    if (problem === "out-of-range") raw = JSON.stringify(snap({ utilizationPercent: 101 }));
    platform.readFile.mockResolvedValue(problem === "invalid-utf8" ? Buffer.from([0xff]) : Buffer.from(raw)); captureRunners();
    await expect(inspectLocalGpuAdmission({ nowMs: NOW })).rejects.toThrow(/capacity-evidence-(?:invalid|unavailable)/);
    expect(restricted.request).not.toHaveBeenCalled(); expect(platform.spawnSync).not.toHaveBeenCalled();
  });
  it("refuses an invalid capacity response even when absence was genuinely observed", async () => {
    restricted.active = true; const observations = captureRunners({ unavailable: true });
    await expect(inspectLocalGpuAdmission({ nowMs: NOW })).rejects.toThrow(/capacity-response-invalid/);
    expect(observations[0]).toMatchObject({ snapshot: null, parseStatus: "invalid", provenance: { errorCode: "ENOENT" } });
  });
});
