import { afterEach, expect, it, vi } from "vitest";

const checks = vi.hoisted(() => ({ lease: vi.fn(), gpu: vi.fn() }));
vi.mock("@/lib/routing/local-provider-capacity", () => ({ assertLocalProviderCapacityAvailable: checks.lease }));
vi.mock("@/lib/inference/host-gpu-admission", () => ({ assertLocalGpuFree: checks.gpu }));
import { withLocalInferenceLock } from "./resource-lane";

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

it("waits for the active local caller before rechecking host safety", async () => {
  vi.stubEnv("VITEST", "false");
  vi.stubEnv("DPF_LOCAL_INFERENCE_MAX_QUEUE_DEPTH", "");
  let busy = false;
  checks.gpu.mockImplementation(async () => { if (busy) throw new Error("local-runner-busy"); });
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const first = withLocalInferenceLock(async () => {
    busy = true; started();
    await held;
    busy = false;
  });
  await entered;
  const second = withLocalInferenceLock(async () => "answer");
  await Promise.resolve();
  await Promise.resolve();
  expect(checks.gpu).toHaveBeenCalledTimes(1);
  expect(checks.lease).toHaveBeenCalledTimes(1);
  release();
  await first;
  await expect(second).resolves.toBe("answer");
  expect(checks.lease).toHaveBeenCalledTimes(2);
  expect(checks.gpu).toHaveBeenCalledTimes(2);
});

it("releases the lane when a host lease refuses dispatch", async () => {
  vi.stubEnv("VITEST", "false");
  vi.stubEnv("DPF_LOCAL_INFERENCE_MAX_QUEUE_DEPTH", "");
  checks.lease.mockRejectedValueOnce(new Error("lease occupied"));
  const call = vi.fn(async () => "answer");
  await expect(withLocalInferenceLock(call)).rejects.toThrow("lease occupied");
  expect(call).not.toHaveBeenCalled();
  await expect(withLocalInferenceLock(call)).resolves.toBe("answer");
});
