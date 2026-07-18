import { describe, expect, it, vi } from "vitest";
import { admitRuntimeGuardedWork } from "./work-admission";

describe("runtime guarded work admission", () => {
  it("takes the transition advisory lock before checking disabled and draining capabilities", async () => {
    const calls: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async () => { calls.push("lock"); return []; }),
      platformCapability: { findMany: vi.fn(async () => { calls.push("capabilities"); return []; }) },
      runtimeCapabilityTransition: { findFirst: vi.fn(async () => { calls.push("transition"); return null; }) },
    };
    await admitRuntimeGuardedWork(tx, "task-run:proactive");
    expect(calls).toEqual(["lock", "capabilities", "transition"]);
  });

  it("does not let an unrelated already-disabled capability suppress a shared source", async () => {
    const tx = fakeTx({ capabilities: [{ capabilityId: "runtime:adp-integration", state: "disabled", manifest: { runtime: { workGuards: ["task-run:coworker"] } } }] });
    await expect(admitRuntimeGuardedWork(tx, "task-run:coworker")).resolves.toBeUndefined();
  });

  it("rejects work while a matching capability is being removed by an active transition", async () => {
    const tx = fakeTx({ capabilities: [{ capabilityId: "runtime:durable-automation", state: "active", manifest: { runtime: { workGuards: ["task-run:proactive"] } } }], transition: { previousKeys: ["runtime:core", "runtime:durable-automation"], desiredKeys: ["runtime:core"] } });
    await expect(admitRuntimeGuardedWork(tx, "task-run:proactive")).rejects.toThrow("runtime_capability_work_draining:runtime:durable-automation");
  });

  it("admits unrelated guarded work", async () => {
    const tx = fakeTx({ capabilities: [{ capabilityId: "runtime:build", state: "active", manifest: { runtime: { workGuards: ["build-studio-active"] } } }], transition: { previousKeys: ["runtime:build"], desiredKeys: [] } });
    await expect(admitRuntimeGuardedWork(tx, "task-run:coworker")).resolves.toBeUndefined();
  });
});

function fakeTx(input: { capabilities?: unknown[]; transition?: unknown }) {
  return {
    $queryRaw: vi.fn(async () => []),
    platformCapability: { findMany: vi.fn(async () => input.capabilities ?? []) },
    runtimeCapabilityTransition: { findFirst: vi.fn(async () => input.transition ?? null) },
  };
}
