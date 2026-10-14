import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { RUNTIME_CAPABILITY_IDS, syncCapabilities, validateRuntimeCapabilitySeeds } from "./sync-capabilities";

const canonicalSeed = JSON.parse(readFileSync(join(__dirname, "../data/platform-runtime-capabilities.json"), "utf8"));
const runtimeCatalog = JSON.parse(readFileSync(join(__dirname, "../../../scripts/capability-service-catalog.generated.json"), "utf8"));
async function coreOnlyHost() {
  // @ts-expect-error - the canonical hash helper is runtime-native ESM without DB declarations.
  const hashing = await import("../../../scripts/lib/capability-state-hash.mjs");
  return { schemaVersion: 2, installerVersion: "fixture", platform: "linux", arch: "amd64", enabledRuntimeCapabilities: ["runtime:core"],
    capabilityCatalogHash: runtimeCatalog.catalogHash,
    capabilityStateVersion: hashing.computeCapabilityStateVersion(runtimeCatalog.catalogHash, ["runtime:core"], runtimeCatalog.capabilities.map((capability: { capabilityId: string }) => capability.capabilityId)) };
}

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
      .toEqual(Object.fromEntries(canonicalSeed.capabilities.map((capability: { capabilityId: string }) => [capability.capabilityId, "disabled"])));
    expect(runtimeCalls.every(([call]) => call.update.manifest.retained === true)).toBe(true);
    expect(mock.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mock.$queryRaw).toHaveBeenCalledTimes(RUNTIME_CAPABILITY_IDS.length);
  });

  it("creates fresh runtime state from the validated host without activating seed defaults", async () => {
    const mock = prismaMock(); mock.platformCapability.findUnique.mockResolvedValue(null);
    await syncCapabilities(mock as never, { installState: coreOnlyHost });
    const rows = mock.upsert.mock.calls.filter(([call]) => call.where.capabilityId.startsWith("runtime:"));
    expect(Object.fromEntries(rows.map(([call]) => [call.create.capabilityId, call.create.state])))
      .toEqual(Object.fromEntries(canonicalSeed.capabilities.map((capability: { capabilityId: string }) => [capability.capabilityId, capability.capabilityId === "runtime:core" ? "active" : "disabled"])));
  });

  it("preserves existing unknown operator intent without requiring bootstrap evidence", async () => {
    const mock = prismaMock("operator-paused"), installState = vi.fn(async () => { throw new Error("fixture-absent"); });
    await syncCapabilities(mock as never, { installState });
    expect(installState).not.toHaveBeenCalled();
    expect(mock.upsert.mock.calls.filter(([call]) => call.where.capabilityId.startsWith("runtime:")).every(([call]) => !("state" in call.update))).toBe(true);
  });

  it("refuses a fresh bootstrap when host hash is stale before creating runtime rows", async () => {
    const mock = prismaMock(); mock.platformCapability.findUnique.mockResolvedValue(null);
    await expect(syncCapabilities(mock as never, { installState: async () => ({ ...await coreOnlyHost(), capabilityStateVersion: "f".repeat(64) }) })).rejects.toThrow("runtime_bootstrap_host_stale");
    expect(mock.upsert).not.toHaveBeenCalled();
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
    expect(mutate((seed) => { seed.capabilities[1].manifest.runtime.workGuards = ["prisma:{ anything: true }"]; })).toThrow("invalid_runtime_work_guard:runtime:build");
    expect(mutate((seed) => { delete seed.capabilities[1].manifest.runtime.workGuards; })).toThrow("missing_runtime_work_guards:runtime:build");
  });

  it("declares closed work guards for every non-core executable runtime", () => {
    for (const capability of canonicalSeed.capabilities) {
      if (capability.capabilityId === "runtime:core") continue;
      expect(capability.manifest.runtime.workGuards).toEqual(expect.any(Array));
      for (const guard of capability.manifest.runtime.workGuards) {
        expect(guard).toMatch(/^(build-studio-active|task-run:[a-z0-9-]+|work-capsule:[a-z0-9-]+)$/);
      }
    }
  });
});
