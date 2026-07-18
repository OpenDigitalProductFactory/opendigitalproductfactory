import { describe, expect, it, vi } from "vitest";
import { coordinateRuntimeCapabilityTransition, computeCapabilityStateVersion, createPrismaRuntimeTransitionReceipts } from "./transition-coordinator";

const request = {
  transitionId: "RCT-1", catalogHash: "0".repeat(64), previousKeys: ["runtime:build", "runtime:core"], desiredKeys: ["runtime:core"],
  previousStates: { "runtime:core": "active", "runtime:build": "active" }, desiredStates: { "runtime:core": "active", "runtime:build": "disabled" },
};

function deps(overrides = {}) {
  return {
    receipts: {
      createPending: vi.fn(async () => ({ created: true as const })),
      markFailed: vi.fn(async () => undefined),
      markHostApplied: vi.fn(async () => undefined),
    },
    isPromoterAvailable: vi.fn(async () => true),
    runPromoter: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    promoterParams: { hostInstallPath: "/dpf", targetSha: "unused", backupPath: "/unused", healthUrl: "http://localhost:3000/api/health" },
    ...overrides,
  };
}

describe("runtime capability transition coordinator", () => {
  it("derives stable state versions from catalog and sorted state lines", () => {
    expect(computeCapabilityStateVersion("catalog", { b: "disabled", a: "active" }))
      .toBe(computeCapabilityStateVersion("catalog", { a: "active", b: "disabled" }));
  });

  it.each([
    [{ ...request, transitionId: "../bad" }, "invalid_transition_id"],
    [{ ...request, desiredKeys: ["runtime:core", "runtime:core"] }, "invalid_desired_keys"],
    [{ ...request, desiredStates: { "runtime:core": "enabled" } }, "invalid_desired_state"],
    [{ ...request, desiredStates: {} }, "invalid_desired_state_map"],
  ])("rejects malformed transition requests", async (bad, error) => {
    await expect(coordinateRuntimeCapabilityTransition(bad as never, deps())).rejects.toThrow(error as string);
  });

  it("serializes transitions and never launches a second promoter", async () => {
    const d = deps({ receipts: { createPending: vi.fn(async () => ({ created: false as const, kind: "active_conflict" as const, status: "pending", transitionId: "RCT-OTHER" })), markFailed: vi.fn(), markHostApplied: vi.fn() } });
    await expect(coordinateRuntimeCapabilityTransition(request, d)).resolves.toEqual({ status: "transition_in_progress" });
    expect(d.runPromoter).not.toHaveBeenCalled();
  });

  it("creates sorted durable receipts under an advisory lock and serializable transaction", async () => {
    const model = { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) };
    const tx = { $queryRaw: vi.fn(async () => []), runtimeCapabilityTransition: model };
    const prisma = { runtimeCapabilityTransition: model, $transaction: vi.fn(async (fn) => fn(tx)) };
    const receipts = createPrismaRuntimeTransitionReceipts(prisma as never);
    await expect(receipts.createPending({ ...request, previousKeys: ["z", "a"], desiredKeys: ["z", "b"], previousStateHash: "before", desiredStateHash: "after" })).resolves.toEqual({ created: true });
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(model.create).toHaveBeenCalledWith({ data: expect.objectContaining({ previousKeys: ["a", "z"], desiredKeys: ["b", "z"], status: "pending" }) });
  });

  it("reconciles an idempotent transition-id retry without creating another row", async () => {
    const envelope = { catalogHash: request.catalogHash, previousStateHash: "before", desiredStateHash: "after", previousKeys: [...request.previousKeys], desiredKeys: [...request.desiredKeys] };
    const model = { findFirst: vi.fn(), findUnique: vi.fn(async () => ({ status: "host_applied", ...envelope })), create: vi.fn(), updateMany: vi.fn() };
    const tx = { $queryRaw: vi.fn(async () => []), runtimeCapabilityTransition: model };
    const prisma = { runtimeCapabilityTransition: model, $transaction: vi.fn(async (fn) => fn(tx)) };
    const receipts = createPrismaRuntimeTransitionReceipts(prisma as never);
    await expect(receipts.createPending({ ...request, previousStateHash: "before", desiredStateHash: "after" })).resolves.toEqual({ created: false, kind: "replay", status: "host_applied" });
    expect(model.create).not.toHaveBeenCalled();
  });

  it("fails closed when a replayed transition id carries a different immutable envelope", async () => {
    const model = { findFirst: vi.fn(), findUnique: vi.fn(async () => ({ status: "pending", catalogHash: request.catalogHash, previousStateHash: "different", desiredStateHash: "after", previousKeys: [...request.previousKeys], desiredKeys: [...request.desiredKeys] })), create: vi.fn(), updateMany: vi.fn() };
    const tx = { $queryRaw: vi.fn(async () => []), runtimeCapabilityTransition: model };
    const receipts = createPrismaRuntimeTransitionReceipts({ runtimeCapabilityTransition: model, $transaction: vi.fn(async (fn) => fn(tx)) } as never);
    await expect(receipts.createPending({ ...request, previousStateHash: "before", desiredStateHash: "after" })).rejects.toThrow("transition_id_conflict");
  });

  it("surfaces a different active receipt as transition_in_progress through the Prisma repository", async () => {
    const model = { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => ({ transitionId: "RCT-OTHER", status: "applying" })), create: vi.fn(), updateMany: vi.fn() };
    const tx = { $queryRaw: vi.fn(async () => []), runtimeCapabilityTransition: model };
    const receipts = createPrismaRuntimeTransitionReceipts({ runtimeCapabilityTransition: model, $transaction: vi.fn(async (fn) => fn(tx)) } as never);
    const d = deps({ receipts });
    await expect(coordinateRuntimeCapabilityTransition(request, d)).resolves.toEqual({ status: "transition_in_progress" });
    expect(d.runPromoter).not.toHaveBeenCalled();
  });

  it("uses compare-and-set updates and rejects terminal regression", async () => {
    const model = { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 0 })) };
    const prisma = { runtimeCapabilityTransition: model, $transaction: vi.fn() };
    const receipts = createPrismaRuntimeTransitionReceipts(prisma as never);
    await expect(receipts.markFailed("RCT-1", "late_failure")).rejects.toThrow("runtime_transition_cas_failed");
    expect(model.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { transitionId: "RCT-1", status: { in: ["pending", "applying"] } } }));
  });

  it("records promoter unavailability before attempting host apply", async () => {
    const d = deps({ isPromoterAvailable: vi.fn(async () => false) });
    await expect(coordinateRuntimeCapabilityTransition(request, d)).resolves.toEqual({ status: "failed", failure: "promoter_unavailable" });
    expect(d.receipts.markFailed).toHaveBeenCalledWith("RCT-1", "promoter_unavailable");
    expect(d.runPromoter).not.toHaveBeenCalled();
  });

  it("terminally fails when promoter availability or spawn throws", async () => {
    const unavailable = deps({ isPromoterAvailable: vi.fn(async () => { throw new Error("docker down"); }) });
    await expect(coordinateRuntimeCapabilityTransition(request, unavailable)).resolves.toEqual({ status: "failed", failure: "promoter_unavailable" });
    const spawn = deps({ runPromoter: vi.fn(async () => { throw new Error("spawn"); }) });
    await expect(coordinateRuntimeCapabilityTransition(request, spawn)).resolves.toEqual({ status: "failed", failure: "promoter_spawn_failed" });
    expect(spawn.receipts.markFailed).toHaveBeenCalledWith("RCT-1", "promoter_spawn_failed");
  });

  it("uses the sibling promoter runtime mode and records host apply failure", async () => {
    const d = deps({ runPromoter: vi.fn(async () => ({ exitCode: 9, stdout: "", stderr: "apply failed" })) });
    await expect(coordinateRuntimeCapabilityTransition(request, d)).resolves.toEqual({ status: "failed", failure: "host_apply_failed" });
    expect(d.runPromoter).toHaveBeenCalledWith(expect.objectContaining({ runtimeCapabilityTransitionId: "RCT-1", containerName: "dpf-promoter-RCT-1", timeoutMs: 600_000 }));
    expect(d.receipts.markFailed).toHaveBeenCalledWith("RCT-1", "host_apply_failed");
  });

  it("stops at host_applied until the signed receipt protocol can verify and commit", async () => {
    const d = deps();
    await expect(coordinateRuntimeCapabilityTransition(request, d)).resolves.toEqual({ status: "host_applied_pending_verification" });
    expect(d.receipts.markHostApplied).toHaveBeenCalledWith("RCT-1");
  });
});
