import { describe, expect, it, vi } from "vitest";
import { RUNTIME_CAPABILITY_IDS, syncCapabilities } from "./sync-capabilities";

function prismaMock(existingState = "disabled") {
  const upsert = vi.fn();
  return {
    platformCapability: {
      findUnique: vi.fn(async ({ where }: { where: { capabilityId: string } }) =>
        where.capabilityId.startsWith("runtime:")
          ? { state: existingState, manifest: { retained: true } }
          : null),
      upsert,
      findMany: vi.fn(async () => []),
      update: vi.fn(),
    },
    upsert,
  };
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
    expect(runtimeCalls.every(([call]) => call.create.state === "active")).toBe(true);
  });
});
