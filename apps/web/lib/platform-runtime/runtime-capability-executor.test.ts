import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(), probe: vi.fn(), resolveArtifact: vi.fn(), promoter: vi.fn(),
  coordinate: vi.fn(), rows: vi.fn(), active: vi.fn(), imageVersion: vi.fn(),
}));
vi.mock("@/lib/platform/image-version", () => ({ readImageVersion: mocks.imageVersion }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@dpf/db", () => ({ prisma: {
  platformCapability: { findMany: mocks.rows }, runtimeCapabilityTransition: { findMany: mocks.active },
} }));
vi.mock("@/lib/self-upgrade/promoter", () => ({
  isPromoterAvailable: vi.fn(async () => true), runPromoter: mocks.promoter,
  resolvePromoterArtifact: mocks.resolveArtifact, runRuntimeCapabilityProtocolProbe: mocks.probe,
}));
vi.mock("./transition-coordinator", () => ({
  computeCapabilityStateVersion: vi.fn(() => "0".repeat(64)),
  coordinateRuntimeCapabilityTransition: mocks.coordinate,
  createPrismaRuntimeTransitionReceipts: vi.fn(() => ({})),
}));

import { executeProductionRuntimeCapabilityTransition } from "./runtime-capability-executor";

describe("production reconciliation protocol admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEPLOYED_SHA", "a".repeat(40));
    vi.stubEnv("DPF_HOST_INSTALL_PATH", "C:/fixture/install");
    vi.stubEnv("DPF_STATE_DIR_HOST", "C:/fixture/state");
    vi.stubEnv("DPF_RUNTIME_TRANSITION_SECRET_FILE_HOST", "C:/fixture/secret");
    mocks.readFile.mockResolvedValue("x".repeat(32));
    mocks.imageVersion.mockResolvedValue({ raw: "a".repeat(40), source: "git-sha" });
    mocks.rows.mockResolvedValue([{ capabilityId: "runtime:core", state: "active", manifest: {} }]);
    mocks.active.mockResolvedValue([]);
    mocks.resolveArtifact.mockResolvedValue({ digest: `sha256:${"b".repeat(64)}`, sourceSha: "a".repeat(40),
      contractSchema: 1, contractDigest: `sha256:${"c".repeat(64)}`, callerProtocol: { min: 1, max: 1 } });
    mocks.promoter.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ ownershipToken: "fixture-owner" }), stderr: "" });
    mocks.coordinate.mockResolvedValue({ status: "succeeded" });
  });
  afterEach(() => vi.unstubAllEnvs());

  const request = { transitionId: "RCT-protocol-test", desiredKeys: ["runtime:core"], requestedById: "user-1", mode: "reconciliation" as const };

  it.each([
    { signingVersions: [1], applyVersions: [1], reconciliationVersions: [] },
    { signingVersions: [1, 2], applyVersions: [1, 2], reconciliationVersions: [] },
  ])("refuses unavailable reconciliation support before reserving host authority: %j", async (support) => {
    mocks.probe.mockResolvedValue({ schemaVersion: 1, sourceSha: "a".repeat(40),
      actuatorSha256: "d".repeat(64), signerSha256: "e".repeat(64), ...support });
    await expect(executeProductionRuntimeCapabilityTransition(request)).resolves.toEqual({
      status: "failed", failure: "runtime_reconciliation_protocol_unavailable",
    });
    expect(mocks.promoter).not.toHaveBeenCalled();
    expect(mocks.coordinate).not.toHaveBeenCalled();
    expect(mocks.probe).toHaveBeenCalledWith(expect.objectContaining({
      artifact: expect.objectContaining({ sourceSha: "a".repeat(40) }),
      expected: { sourceSha: "a".repeat(40),
        actuatorSha256: createHash("sha256").update("x".repeat(32)).digest("hex"),
        signerSha256: createHash("sha256").update("x".repeat(32)).digest("hex") },
      containerName: expect.stringMatching(/^dpf-runtime-protocol-[a-f0-9-]{36}$/),
    }));
    expect(mocks.readFile).not.toHaveBeenCalledWith("/dpf-state/runtime-transition.secret", "utf8");
  });

  it("refuses a failed immutable packaged probe before reserving authority", async () => {
    mocks.probe.mockRejectedValue(new Error("runtime_protocol_probe_identity_mismatch"));
    await expect(executeProductionRuntimeCapabilityTransition(request)).resolves.toEqual({
      status: "failed", failure: "runtime_reconciliation_protocol_unavailable",
    });
    expect(mocks.promoter).not.toHaveBeenCalled();
    expect(mocks.coordinate).not.toHaveBeenCalled();
  });

  it("never falls back to the ordinary coordinator when only the host advertises reconciliation", async () => {
    mocks.probe.mockResolvedValue({ schemaVersion: 1, sourceSha: "a".repeat(40),
      actuatorSha256: "d".repeat(64), signerSha256: "e".repeat(64),
      signingVersions: [1, 2], applyVersions: [1, 2], reconciliationVersions: [2] });
    await expect(executeProductionRuntimeCapabilityTransition(request)).resolves.toEqual({
      status: "failed", failure: "runtime_reconciliation_protocol_unavailable",
    });
    expect(mocks.promoter).not.toHaveBeenCalled();
    expect(mocks.coordinate).not.toHaveBeenCalled();
  });

  it("captures production caller identity before database observation", async () => {
    const mutable = { transitionId: "RCT-original", desiredKeys: ["runtime:core"], requestedById: "original-user" };
    mocks.rows.mockImplementationOnce(async () => {
      mutable.transitionId = "RCT-mutated";
      mutable.requestedById = "another-user";
      mutable.desiredKeys.push("runtime:build");
      return [{ capabilityId: "runtime:core", state: "active", manifest: {} }];
    });
    await executeProductionRuntimeCapabilityTransition(mutable);
    expect(mocks.coordinate).toHaveBeenCalledWith(expect.objectContaining({
      transitionId: "RCT-original", requestedById: "original-user", desiredKeys: ["runtime:core"],
    }), expect.any(Object));
  });

  it("refuses a missing server revision before any packaged probe or authority", async () => {
    vi.stubEnv("DEPLOYED_SHA", "unknown");
    mocks.imageVersion.mockResolvedValue(null);
    await expect(executeProductionRuntimeCapabilityTransition(request)).resolves.toEqual({
      status: "failed", failure: "runtime_reconciliation_protocol_unavailable",
    });
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.resolveArtifact).not.toHaveBeenCalled();
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(mocks.promoter).not.toHaveBeenCalled();
  });

  it("refuses an ambient revision that conflicts with the baked portal identity", async () => {
    vi.stubEnv("DEPLOYED_SHA", "f".repeat(40));
    await expect(executeProductionRuntimeCapabilityTransition(request)).resolves.toEqual({
      status: "failed", failure: "runtime_reconciliation_protocol_unavailable",
    });
    expect(mocks.imageVersion).toHaveBeenCalledOnce();
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.resolveArtifact).not.toHaveBeenCalled();
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(mocks.promoter).not.toHaveBeenCalled();
  });
});
