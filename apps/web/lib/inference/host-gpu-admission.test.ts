import { describe, expect, it, vi } from "vitest";

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
