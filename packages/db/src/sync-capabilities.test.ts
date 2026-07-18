import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { RUNTIME_CAPABILITY_IDS, syncCapabilities, validateRuntimeCapabilitySeeds } from "./sync-capabilities";

const canonicalSeed = JSON.parse(readFileSync(join(__dirname, "../data/platform-runtime-capabilities.json"), "utf8"));

function prismaMock(existingState = "disabled") {
  const upsert = vi.fn();
  const client = {
    platformCapability: {
      findUnique: vi.fn(async ({ where }: { where: { capabilityId: string } }) =>
        where.capabilityId.startsWith("runtime:")
          ? { state: existingState, manifest: { retained: true } }
          : null),
      upsert,
      findMany: vi.fn(async () => []),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(client)),
    upsert,
  };
  return client;
}

describe("runtime capability synchronization", () => {
  it("uses the stable runtime capability identifiers", () => {
    expect(RUNTIME_CAPABILITY_IDS).toEqual([
      "runtime:core", "runtime:build", "runtime:browser-automation",
      "runtime:durable-automation", "runtime:local-speech",
      "runtime:deep-observability", "runtime:adp-integration",
      "runtime:development", "runtime:external-ai",
    ]);
  });

  it("writes dependency and activation policy under manifest.runtime", async () => {
    const mock = prismaMock();
    await syncCapabilities(mock as never);
    const runtimeCalls = mock.upsert.mock.calls.filter(([call]) =>
      call.where.capabilityId.startsWith("runtime:"));
    expect(runtimeCalls).toHaveLength(RUNTIME_CAPABILITY_IDS.length);
    for (const [call] of runtimeCalls) {
      expect(call.create.manifest.runtime).toEqual(expect.objectContaining({
        dependencies: expect.any(Array),
        activation: expect.objectContaining({ policy: expect.any(String) }),
      }));
    }
  });

  it("does not reset operator-controlled state on an existing runtime row", async () => {
    const mock = prismaMock("disabled");
    await syncCapabilities(mock as never);
    const runtimeCalls = mock.upsert.mock.calls.filter(([call]) =>
      call.where.capabilityId.startsWith("runtime:"));
    expect(runtimeCalls.every(([call]) => !("state" in call.update))).toBe(true);
    expect(Object.fromEntries(runtimeCalls.map(([call]) => [call.where.capabilityId, call.create.state])))
      .toEqual(Object.fromEntries(canonicalSeed.capabilities.map((capability: { capabilityId: string; state: string }) => [capability.capabilityId, capability.state])));
    expect(runtimeCalls.every(([call]) => call.update.manifest.retained === true)).toBe(true);
    expect(mock.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mock.$queryRaw).toHaveBeenCalledTimes(RUNTIME_CAPABILITY_IDS.length);
  });

  it("syncs runtime rows when the platform tool snapshot is unavailable", async () => {
    const mock = prismaMock();
    await syncCapabilities(mock as never, { tools: () => { throw new Error("missing tools"); } });
    expect(mock.upsert).toHaveBeenCalledTimes(RUNTIME_CAPABILITY_IDS.length);
  });

  it("rejects invalid states, manifests, dependencies, and cycles", () => {
    const mutate = (change: (seed: typeof canonicalSeed) => void) => {
      const seed = structuredClone(canonicalSeed);
      change(seed);
      return () => validateRuntimeCapabilitySeeds(seed);
    };
    expect(mutate((seed) => { seed.capabilities[0].state = "enabled"; })).toThrow("invalid_runtime_state:runtime:core");
    expect(mutate((seed) => { delete seed.capabilities[0].manifest.runtime.activation; })).toThrow("invalid_runtime_activation:runtime:core");
    expect(mutate((seed) => { seed.capabilities[0].manifest.runtime.dependencies = ["runtime:missing"]; })).toThrow("unknown_runtime_dependency:runtime:missing");
    expect(mutate((seed) => { seed.capabilities[0].manifest.runtime.dependencies = ["runtime:build"]; })).toThrow(/runtime_dependency_cycle:runtime:core -> runtime:build -> runtime:core/);
  });
});
