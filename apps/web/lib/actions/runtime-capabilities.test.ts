import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireCapability, assertAdmission, execute, rotate, preview } = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  assertAdmission: vi.fn(),
  execute: vi.fn(),
  rotate: vi.fn(),
  preview: vi.fn(),
}));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability }));
vi.mock("@/lib/platform-runtime/transition-recovery", () => ({ assertRuntimeCapabilityTransitionAdmission: assertAdmission }));
vi.mock("@/lib/platform-runtime/runtime-capability-executor", () => ({ executeProductionRuntimeCapabilityTransition: execute, rotateProductionRuntimeTransitionSecret: rotate, readProductionRuntimeCapabilityReconciliationPreview: preview }));

import catalogSeed from "../../../../scripts/capability-service-catalog.generated.json";
import { computeCapabilityStateVersion } from "../../../../scripts/lib/capability-state-hash.mjs";
import { requestMonitoringChange, requestRuntimeCapabilityTransition, rotateRuntimeTransitionSecret, previewRuntimeCapabilityReconciliation } from "./runtime-capabilities";

const catalog = catalogSeed as { catalogHash: string; capabilities: Array<{ capabilityId: string; dependencies: string[] }> };
const ids = catalog.capabilities.map((entry) => entry.capabilityId);
/** Live drift: install-state enables only core; DB has monitoring and build active. */
function driftedPreview() {
  return {
    observedHost: { schemaVersion: 2, installerVersion: "fixture", platform: "linux", arch: "amd64", capabilityCatalogHash: catalog.catalogHash,
      capabilityStateVersion: computeCapabilityStateVersion(catalog.catalogHash, ["runtime:core"], ids), enabledRuntimeCapabilities: ["runtime:core"] },
    observedDatabaseStates: Object.fromEntries(ids.map((id) => [id, ["runtime:core", "runtime:deep-observability", "runtime:build"].includes(id) ? "active" : "disabled"])),
    residualDriftKeys: ["runtime:build", "runtime:deep-observability"],
    capabilities: catalog.capabilities.map((entry) => ({ capabilityId: entry.capabilityId, dependencies: entry.dependencies })),
    protocolIdentity: {},
  };
}

describe("runtime capability mutation action", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("requires platform management for preview without opening mutation admission", async () => {
    requireCapability.mockResolvedValue({ userId: "operator-1" }); preview.mockResolvedValue({ observedDatabaseStates: {} });
    await expect(previewRuntimeCapabilityReconciliation()).resolves.toEqual({ observedDatabaseStates: {} });
    expect(requireCapability).toHaveBeenCalledWith("manage_platform"); expect(assertAdmission).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

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

  it("owns caller arrays before awaiting authentication", async () => {
    const request = { transitionId: "RCT-original", desiredKeys: ["runtime:core"] };
    requireCapability.mockImplementation(async () => { request.transitionId = "RCT-mutated"; request.desiredKeys.push("runtime:build"); return { userId: "operator-1" }; });
    assertAdmission.mockResolvedValue(undefined); execute.mockResolvedValue({ status: "succeeded" });
    await requestRuntimeCapabilityTransition(request);
    expect(execute).toHaveBeenCalledWith({ transitionId: "RCT-original", desiredKeys: ["runtime:core"], requestedById: "operator-1" });
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

describe("monitoring change action (BI-F0C2E8F5)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("asks for a reconciliation that touches only monitoring, from the observed host baseline", async () => {
    requireCapability.mockResolvedValue({ userId: "operator-1" }); assertAdmission.mockResolvedValue(undefined);
    preview.mockResolvedValue(driftedPreview()); execute.mockResolvedValue({ status: "succeeded" });
    await expect(requestMonitoringChange({ transitionId: "RCT-1", turnOn: false })).resolves.toEqual({ status: "succeeded" });
    expect(requireCapability).toHaveBeenCalledWith("manage_platform");
    const call = execute.mock.calls[0]![0];
    expect(call).toMatchObject({ transitionId: "RCT-1", desiredKeys: ["runtime:core"], mode: "reconciliation", requestedById: "operator-1" });
    expect(call.reconciliation.touchedKeys).toEqual(["runtime:deep-observability"]);
    expect(call.reconciliation.desiredDatabaseStates["runtime:deep-observability"]).toBe("disabled");
    expect(call.reconciliation.desiredDatabaseStates["runtime:build"]).toBe("active");
  });

  it.each([
    "runtime_capability_reconciliation_in_progress",
    "runtime_capability_recovery_required",
  ])("returns %s instead of throwing, so production shows real copy", async (reason) => {
    requireCapability.mockResolvedValue({ userId: "operator-1" }); preview.mockResolvedValue(driftedPreview());
    assertAdmission.mockRejectedValue(new Error(reason));
    await expect(requestMonitoringChange({ transitionId: "RCT-1", turnOn: true })).resolves.toEqual({ status: "failed", failure: reason });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns a protocol failure when the reconciliation preview cannot be read", async () => {
    requireCapability.mockResolvedValue({ userId: "operator-1" }); preview.mockRejectedValue(new Error("ENOENT: no such file, open '/promoter/x'"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(requestMonitoringChange({ transitionId: "RCT-1", turnOn: true })).resolves.toEqual({ status: "failed", failure: "runtime_reconciliation_protocol_unavailable" });
    errorSpy.mockRestore();
    expect(assertAdmission).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("still requires manage_platform before reading anything", async () => {
    requireCapability.mockRejectedValue(new Error("Unauthorized"));
    await expect(requestMonitoringChange({ transitionId: "RCT-1", turnOn: true })).rejects.toThrow("Unauthorized");
    expect(preview).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a malformed request before any IO", async () => {
    requireCapability.mockResolvedValue({ userId: "operator-1" });
    await expect(requestMonitoringChange({ transitionId: "RCT-1", turnOn: "yes" as unknown as boolean })).resolves.toEqual({ status: "failed", failure: "invalid_monitoring_request" });
    expect(preview).not.toHaveBeenCalled();
  });
});
