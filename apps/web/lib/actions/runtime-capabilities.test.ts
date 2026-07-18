import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireCapability, assertAdmission, execute, rotate } = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  assertAdmission: vi.fn(),
  execute: vi.fn(),
  rotate: vi.fn(),
}));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability }));
vi.mock("@/lib/platform-runtime/transition-recovery", () => ({ assertRuntimeCapabilityTransitionAdmission: assertAdmission }));
vi.mock("@/lib/platform-runtime/runtime-capability-executor", () => ({ executeProductionRuntimeCapabilityTransition: execute, rotateProductionRuntimeTransitionSecret: rotate }));

import { requestRuntimeCapabilityTransition, rotateRuntimeTransitionSecret } from "./runtime-capabilities";

describe("runtime capability mutation action", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("requires manage_platform before invoking the durable coordinator", async () => {
    requireCapability.mockRejectedValue(new Error("Unauthorized"));
    await expect(requestRuntimeCapabilityTransition({ transitionId: "RCT-1", desiredKeys: ["runtime:core"] })).rejects.toThrow("Unauthorized");
    expect(requireCapability).toHaveBeenCalledWith("manage_platform");
    expect(execute).not.toHaveBeenCalled();
  });

  it("binds the authenticated actor to the durable transition request", async () => {
    requireCapability.mockResolvedValue({ userId: "operator-1" });
    assertAdmission.mockResolvedValue(undefined);
    execute.mockResolvedValue({ status: "succeeded" });
    await expect(requestRuntimeCapabilityTransition({ transitionId: "RCT-1", desiredKeys: ["runtime:core"] })).resolves.toEqual({ status: "succeeded" });
    expect(execute).toHaveBeenCalledWith({ transitionId: "RCT-1", desiredKeys: ["runtime:core"], requestedById: "operator-1" });
  });

  it.each([
    "runtime_capability_reconciliation_in_progress",
    "runtime_capability_recovery_required",
  ])("fails closed on %s before invoking the executor", async (reason) => {
    requireCapability.mockResolvedValue({ userId: "operator-1" });
    assertAdmission.mockRejectedValue(new Error(reason));

    await expect(requestRuntimeCapabilityTransition({ transitionId: "RCT-1", desiredKeys: ["runtime:core"] })).rejects.toThrow(reason);

    expect(assertAdmission).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  it("rotates the signing key only through authenticated durable admission", async () => {
    requireCapability.mockResolvedValue({ userId: "operator-1" }); assertAdmission.mockResolvedValue(undefined); rotate.mockResolvedValue({ status: "rotated" });
    await expect(rotateRuntimeTransitionSecret()).resolves.toEqual({ status: "rotated" });
    expect(requireCapability).toHaveBeenCalledWith("manage_platform"); expect(assertAdmission).toHaveBeenCalledOnce(); expect(rotate).toHaveBeenCalledOnce();
  });
});
