import { describe, expect, it, vi } from "vitest";
import type { BudgetedProcessResult } from "@/lib/shared/run-process-with-budget";
import {
  CONVERTER_AVAILABILITY_TTL_MS,
  createConverterAvailabilityProbe,
  type AvailabilityDeps,
} from "./availability";

const IMAGE = `dpf-doctools@sha256:${"c".repeat(64)}`;

const exit = (exitCode: number): BudgetedProcessResult => ({
  exitCode,
  stdout: "",
  stderr: "",
  stdoutBytes: Buffer.alloc(0),
  outputLimitExceeded: false,
});

function probeWith(overrides: Partial<AvailabilityDeps> & { inspect?: number; version?: number } = {}) {
  let clock = 1_000_000;
  const run = vi.fn(async (_cmd: string, args: string[]) => {
    if (args[0] === "image") return exit(overrides.inspect ?? 0);
    return exit(overrides.version ?? 0);
  });
  const deps: AvailabilityDeps = {
    resolveImage: async () => ({ status: "pinned", image: IMAGE }),
    dockerSocketPresent: () => true,
    run,
    now: () => clock,
    ...overrides,
  };
  const probe = createConverterAvailabilityProbe(deps);
  return { probe, run, advance: (ms: number) => (clock += ms) };
}

describe("getConverterAvailability (BI-52E565DA)", () => {
  it("is ready when docker answers and the pinned image is present", async () => {
    const { probe, run } = probeWith();
    const a = await probe.get();
    expect(a).toMatchObject({ available: true, status: "ready", byDesign: false, image: IMAGE });
    expect(run).toHaveBeenCalledWith("docker", ["image", "inspect", "--format", "{{.Id}}", IMAGE], expect.objectContaining({ timeoutMs: expect.any(Number) }));
  });

  it("reports unavailable BY DESIGN when the install has no docker socket, without spawning docker", async () => {
    const { probe, run } = probeWith({ dockerSocketPresent: () => false });
    expect(await probe.get()).toMatchObject({ available: false, status: "no-docker-socket", byDesign: true });
    expect(run).not.toHaveBeenCalled();
  });

  it("reports unavailable BY DESIGN when no image is configured", async () => {
    const { probe } = probeWith({ resolveImage: async () => ({ status: "not-configured" }) });
    expect(await probe.get()).toMatchObject({ available: false, status: "not-configured", byDesign: true });
  });

  it("refuses an unpinned image as a real fault, not a design choice", async () => {
    const { probe } = probeWith({ resolveImage: async () => ({ status: "unpinned", image: "dpf-doctools:latest" }) });
    expect(await probe.get()).toMatchObject({ available: false, status: "image-unpinned", byDesign: false });
  });

  it("tells an unreachable daemon apart from a missing image", async () => {
    expect(await probeWith({ inspect: 1, version: 0 }).probe.get()).toMatchObject({ available: false, status: "image-missing", byDesign: false });
    expect(await probeWith({ inspect: 1, version: 1 }).probe.get()).toMatchObject({ available: false, status: "docker-unreachable", byDesign: false });
  });

  it("treats a docker CLI that cannot spawn as unreachable, never a throw", async () => {
    const { probe } = probeWith({
      run: vi.fn(async () => {
        throw new Error("spawn docker ENOENT");
      }),
    });
    expect(await probe.get()).toMatchObject({ available: false, status: "docker-unreachable" });
  });

  it("caches the answer for 60 s and coalesces concurrent calls", async () => {
    const { probe, run, advance } = probeWith();
    await Promise.all([probe.get(), probe.get(), probe.get()]);
    expect(run).toHaveBeenCalledTimes(1);
    advance(CONVERTER_AVAILABILITY_TTL_MS - 1);
    await probe.get();
    expect(run).toHaveBeenCalledTimes(1);
    advance(2);
    await probe.get();
    expect(run).toHaveBeenCalledTimes(2);
    expect(CONVERTER_AVAILABILITY_TTL_MS).toBe(60_000);
  });

  it("feeds the dependency gauge: null when unavailable by design, else up/down", async () => {
    expect(await probeWith({ dockerSocketPresent: () => false }).probe.dependencyUp()).toBeNull();
    expect(await probeWith({ resolveImage: async () => ({ status: "not-configured" }) }).probe.dependencyUp()).toBeNull();
    expect(await probeWith().probe.dependencyUp()).toBe(true);
    expect(await probeWith({ inspect: 1, version: 1 }).probe.dependencyUp()).toBe(false);
  });
});
