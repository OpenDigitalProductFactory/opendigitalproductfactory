import { describe, expect, it, vi } from "vitest";
import { coordinateRuntimeCapabilityTransition, computeCapabilityStateVersion, createPrismaRuntimeTransitionReceipts } from "./transition-coordinator";

const request = {
  transitionId: "RCT-1", catalogHash: "catalog", previousKeys: ["runtime:core", "runtime:build"], desiredKeys: ["runtime:core"],
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

  it("serializes transitions and never launches a second promoter", async () => {
    const d = deps({ receipts: { createPending: vi.fn(async () => ({ created: false as const })), markFailed: vi.fn(), markHostApplied: vi.fn() } });
    await expect(coordinateRuntimeCapabilityTransition(request, d)).resolves.toEqual({ status: "transition_in_progress" });
    expect(d.runPromoter).not.toHaveBeenCalled();
  });

  it("creates sorted durable receipts under an advisory lock and serializable transaction", async () => {
    const model = { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) };
    const tx = { $queryRaw: vi.fn(async () => []), runtimeCapabilityTransition: model };
    const prisma = { runtimeCapabilityTransition: model, $transaction: vi.fn(async (fn) => fn(tx)) };
    const receipts = createPrismaRuntimeTransitionReceipts(prisma as never);
    await expect(receipts.createPending({ ...request, previousKeys: ["z", "a"], desiredKeys: ["z", "b"], previousStateHash: "before", desiredStateHash: "after" })).resolves.toEqual({ created: true });
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(model.create).toHaveBeenCalledWith({ data: expect.objectContaining({ previousKeys: ["a", "z"], desiredKeys: ["b", "z"], status: "pending" }) });
  });

  it("records promoter unavailability before attempting host apply", async () => {
    const d = deps({ isPromoterAvailable: vi.fn(async () => false) });
    await expect(coordinateRuntimeCapabilityTransition(request, d)).resolves.toEqual({ status: "failed", failure: "promoter_unavailable" });
    expect(d.receipts.markFailed).toHaveBeenCalledWith("RCT-1", "promoter_unavailable");
    expect(d.runPromoter).not.toHaveBeenCalled();
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
