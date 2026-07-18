import { describe, expect, it, vi } from "vitest";
import { admitRuntimeGuardedWork } from "./work-admission";

describe("runtime guarded work admission", () => {
  it("takes the transition advisory lock (via $executeRaw) before checking disabled and draining capabilities", async () => {
    // BI-8BA6AC56 regression: the lock is pg_advisory_xact_lock, which returns
    // `void`. Prisma 7.8's driver adapter throws P2010 (UnsupportedNativeDataType)
    // deserializing a void column from $queryRaw — which crashed EVERY Build Studio
    // promote/start. The lock must be acquired with $executeRaw (no result-set
    // deserialization). The $queryRaw spy below throws to pin that regression.
    const calls: string[] = [];
    const tx = {
      $executeRaw: vi.fn(async (..._args: unknown[]) => { calls.push("lock"); return 1; }),
      $queryRaw: vi.fn(() => {
        throw new Error("advisory lock must use $executeRaw (void column crashes $queryRaw under Prisma 7.8)");
      }),
      platformCapability: { findMany: vi.fn(async () => { calls.push("capabilities"); return []; }) },
      runtimeCapabilityTransition: { findFirst: vi.fn(async () => { calls.push("transition"); return null; }) },
    };
    await admitRuntimeGuardedWork(tx, "task-run:proactive");
    expect(calls).toEqual(["lock", "capabilities", "transition"]);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    const strings = tx.$executeRaw.mock.calls[0][0] as unknown as string[];
    expect(strings.join("")).toContain("pg_advisory_xact_lock");
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

type CapabilityRow = { capabilityId: string; state: string; manifest: unknown };
type ActiveTransition = { previousKeys: string[]; desiredKeys: string[] };

function fakeTx(input: { capabilities?: CapabilityRow[]; transition?: ActiveTransition }) {
  return {
    $executeRaw: vi.fn(async () => 1),
    platformCapability: { findMany: vi.fn(async () => input.capabilities ?? []) },
    runtimeCapabilityTransition: { findFirst: vi.fn(async () => input.transition ?? null) },
  };
}
