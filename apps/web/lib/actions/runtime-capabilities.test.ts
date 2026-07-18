import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireCapability, execute } = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability }));
vi.mock("@/lib/platform-runtime/runtime-capability-executor", () => ({ executeProductionRuntimeCapabilityTransition: execute }));

import { requestRuntimeCapabilityTransition } from "./runtime-capabilities";

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
    execute.mockResolvedValue({ status: "succeeded" });
    await expect(requestRuntimeCapabilityTransition({ transitionId: "RCT-1", desiredKeys: ["runtime:core"] })).resolves.toEqual({ status: "succeeded" });
    expect(execute).toHaveBeenCalledWith({ transitionId: "RCT-1", desiredKeys: ["runtime:core"], requestedById: "operator-1" });
  });
});
