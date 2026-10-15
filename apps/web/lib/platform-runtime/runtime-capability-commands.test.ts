import { beforeEach, describe, expect, it, vi } from "vitest";

const { preview, execute, admission } = vi.hoisted(() => ({
  preview: vi.fn(), execute: vi.fn(), admission: vi.fn(),
}));
vi.mock("./runtime-capability-executor", () => ({
  readProductionRuntimeCapabilityReconciliationPreview: preview,
  executeProductionRuntimeCapabilityTransition: execute,
}));
vi.mock("./transition-recovery", () => ({ assertRuntimeCapabilityTransitionAdmission: admission }));

import { previewRuntimeCapabilityReconciliationForActor, requestRuntimeCapabilityTransitionForActor } from "./runtime-capability-commands";

describe("runtime capability commands behind authenticated edges", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it.each(["", " "])("refuses an absent actor before preview or mutation IO (%j)", async userId => {
    await expect(previewRuntimeCapabilityReconciliationForActor(userId)).rejects.toThrow("Unauthorized");
    await expect(requestRuntimeCapabilityTransitionForActor({ transitionId: "RCT-absent", desiredKeys: [] }, userId)).rejects.toThrow("Unauthorized");
    expect(preview).not.toHaveBeenCalled();
    expect(admission).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("captures caller input before admission and replaces a body-supplied actor", async () => {
    const input = { transitionId: "RCT-original", desiredKeys: ["runtime:core"], requestedById: "forged-user" };
    admission.mockImplementation(async () => { input.transitionId = "RCT-mutated"; input.desiredKeys.push("runtime:build"); });
    execute.mockResolvedValue({ status: "succeeded" });
    await requestRuntimeCapabilityTransitionForActor(input, "verified-user");
    expect(execute).toHaveBeenCalledWith({ transitionId: "RCT-original", desiredKeys: ["runtime:core"], requestedById: "verified-user" });
  });
});
