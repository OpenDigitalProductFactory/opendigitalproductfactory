import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntimeCompensationEnvelope, signTransitionPayload, type RuntimeTransitionEnvelope } from "./transition-protocol";
const mocks = vi.hoisted(() => ({ readFile: vi.fn(), runPromoter: vi.fn(), rows: vi.fn(), updateMany: vi.fn(), event: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@/lib/self-upgrade/promoter", () => ({ runPromoter: mocks.runPromoter }));
vi.mock("@dpf/db", () => ({ prisma: {
  platformCapability: { findMany: mocks.rows },
  $transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation({ runtimeCapabilityTransition: { updateMany: mocks.updateMany }, runtimeCapabilityTransitionEvent: { create: mocks.event } }),
} }));
import { createProductionRuntimeTransitionHost } from "./transition-recovery";

describe("persisted reconciliation compensation on restart", () => {
  const secret = "s".repeat(32);
  const previousStates = { "runtime:core": "active", "runtime:build": "active" };
  function fixture(issuedAt = Date.now(), hostExtras = {}) {
    const envelope: RuntimeTransitionEnvelope = {
      version: 2, kind: "runtime-capability-transition", mode: "reconciliation", transitionId: "RCT-recovery", issuedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(issuedAt + 60_000).toISOString(), catalogHash: "a".repeat(64), previousStateHash: "b".repeat(64), desiredStateHash: "c".repeat(64), previousKeys: ["runtime:core"], desiredKeys: ["runtime:build", "runtime:core"], previousProfiles: [], desiredProfiles: ["build"], previousServices: ["portal"], desiredServices: ["build", "portal"],
      protocolIdentity: { sourceSha: "a".repeat(40), promoterDigest: `sha256:${"d".repeat(64)}`, actuatorSha256: "e".repeat(64), signerSha256: "f".repeat(64) },
      reconciliation: { observedHost: { schemaVersion: 2, installerVersion: "fixture", platform: "linux", arch: "amd64", capabilityCatalogHash: "a".repeat(64), capabilityStateVersion: "b".repeat(64), enabledRuntimeCapabilities: ["runtime:core"], ...hostExtras }, observedDatabaseStates: previousStates, desiredDatabaseStates: { ...previousStates, "runtime:build": "disabled" }, desiredHostEnabledKeys: ["runtime:build", "runtime:core"], touchedKeys: ["runtime:build"] },
    };
    const reverse = createRuntimeCompensationEnvelope(envelope, issuedAt);
    const compensation = { envelope: reverse, envelopeSignature: signTransitionPayload(reverse, secret) };
    const row = { ...envelope, status: "compensating", previousStates, desiredStates: envelope.reconciliation.desiredDatabaseStates, envelope, envelopeSignature: signTransitionPayload(envelope, secret), failure: { code: "commit-failed", compensation }, createdAt: new Date() };
    const unsigned = { ...reverse, status: "applied" as const, completedAt: reverse.issuedAt, beforeHash: reverse.previousStateHash, afterHash: reverse.desiredStateHash, observedServices: reverse.desiredServices };
    const receipt = { ...unsigned, signature: signTransitionPayload(unsigned, secret) };
    return { row, compensation, receipt };
  }
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DPF_HOST_INSTALL_PATH", "/fixture/install"); vi.stubEnv("DPF_STATE_DIR_HOST", "/fixture/state"); vi.stubEnv("DPF_RUNTIME_TRANSITION_SECRET_FILE_HOST", "/fixture/secret");
    mocks.rows.mockResolvedValue(Object.entries(previousStates).map(([capabilityId, state]) => ({ capabilityId, state })));
    mocks.updateMany.mockResolvedValue({ count: 1 }); mocks.event.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());
  it("reuses the exact recorded reverse identity and packet after restart", async () => {
    const f = fixture(); let launched = false;
    mocks.readFile.mockImplementation(async (file: string) => { if (file.endsWith("runtime-transition.secret")) return secret; if (launched) return JSON.stringify(f.receipt); throw Object.assign(new Error("absent"), { code: "ENOENT" }); });
    mocks.runPromoter.mockImplementation(async () => { launched = true; return { exitCode: 0 }; });
    await (await createProductionRuntimeTransitionHost()).compensate(f.row, "commit-failed");
    expect(mocks.runPromoter).toHaveBeenCalledWith(expect.objectContaining({ promoterImage: f.row.envelope.protocolIdentity!.promoterDigest, targetSha: f.row.envelope.protocolIdentity!.sourceSha, runtimeCapabilityTransitionId: f.compensation.envelope.transitionId, runtimeCapabilityEnvelope: Buffer.from(JSON.stringify(f.compensation.envelope)).toString("base64url"), runtimeCapabilitySignature: f.compensation.envelopeSignature }));
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { transitionId: "RCT-recovery", status: { in: ["pending", "applying", "host_applied", "compensating"] } } }));
  });
  it("refuses a later database writer before any host compensation or terminal write", async () => {
    const f = fixture(); mocks.readFile.mockResolvedValue(secret);
    mocks.rows.mockResolvedValue([{ capabilityId: "runtime:core", state: "active" }, { capabilityId: "runtime:build", state: "disabled" }]);
    await expect((await createProductionRuntimeTransitionHost()).compensate(f.row, "commit-failed")).rejects.toThrow("runtime_transition_database_stale");
    expect(mocks.runPromoter).not.toHaveBeenCalled(); expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it("preserves the signed consumer release carrier during compensation", async () => {
    vi.stubEnv("GHCR_OWNER", "fixture-owner");
    const f = fixture(Date.now(), { installMode: "consumer", imageTag: "v2026.10.15-dev-recovery.92", installPath: "/fixture/install", composeFiles: ["docker-compose.yml", "docker-compose.release.yml"] });
    let launched = false;
    mocks.readFile.mockImplementation(async (file: string) => { if (file.endsWith("runtime-transition.secret")) return secret; if (launched) return JSON.stringify(f.receipt); throw Object.assign(new Error("absent"), { code: "ENOENT" }); });
    mocks.runPromoter.mockImplementation(async () => { launched = true; return { exitCode: 0 }; });
    await (await createProductionRuntimeTransitionHost()).compensate(f.row, "commit-failed");
    expect(mocks.runPromoter).toHaveBeenCalledWith(expect.objectContaining({ composeFiles: ["docker-compose.yml", "docker-compose.release.yml"], composeEnvFileHostPath: "/fixture/install/.env" }));
  });
  it("settles an expired packet from its original receipt without minting a fresh launch", async () => {
    const f = fixture(Date.now() - 1_200_000);
    mocks.readFile.mockImplementation(async (file: string) => file.endsWith("runtime-transition.secret") ? secret : JSON.stringify(f.receipt));
    await (await createProductionRuntimeTransitionHost()).compensate(f.row, "commit-failed");
    expect(mocks.runPromoter).not.toHaveBeenCalled(); expect(mocks.updateMany).toHaveBeenCalledOnce();
  });
});
