import { describe, expect, it, vi } from "vitest";
import { classifyRuntimeInstallState, coordinateRuntimeCapabilityTransition, computeCapabilityStateVersion, createPrismaRuntimeTransitionReceipts, reconcileRuntimeCapabilityTransitions } from "./transition-coordinator";
import type { RuntimeCapabilityCoordinatorDeps, RuntimeCapabilityTransitionReceipts } from "./transition-coordinator";
import { signTransitionPayload } from "./transition-protocol";
import { requiredRuntimeServicesAreHealthy } from "./runtime-capability-executor";
import { computeCapabilityStateVersion as computeHostStateVersion } from "../../../../scripts/lib/capability-state-hash.mjs";

const request = {
  transitionId: "RCT-1", catalogHash: "0".repeat(64), previousKeys: ["runtime:build", "runtime:core"], desiredKeys: ["runtime:core"],
  previousStates: { "runtime:core": "active", "runtime:build": "active" }, desiredStates: { "runtime:core": "active", "runtime:build": "disabled" },
  requestedById: "user-1",
};
const persistedEnvelope = {
  version: 1 as const, transitionId: "RCT-1", issuedAt: new Date(1_000).toISOString(), expiresAt: new Date(601_000).toISOString(),
  catalogHash: request.catalogHash, previousStateHash: "before", desiredStateHash: "after", previousKeys: [...request.previousKeys], desiredKeys: [...request.desiredKeys],
  previousProfiles: ["build"], desiredProfiles: [], previousServices: [], desiredServices: [],
};

type CreatePendingInput = Parameters<RuntimeCapabilityTransitionReceipts["createPending"]>[0];

function deps(overrides: Partial<RuntimeCapabilityCoordinatorDeps> = {}): RuntimeCapabilityCoordinatorDeps {
  const secret = "x".repeat(32);
  return {
    receipts: {
      createPending: vi.fn(async (input: CreatePendingInput) => ({ created: true as const, envelope: input.envelope, envelopeSignature: input.envelopeSignature })),
      markFailed: vi.fn(async () => undefined),
      markHostApplied: vi.fn(async () => undefined),
    },
    isPromoterAvailable: vi.fn(async () => true),
    runPromoter: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    promoterParams: { hostInstallPath: "/dpf", targetSha: "unused", backupPath: "/unused", healthUrl: "http://localhost:3000/api/health", stateDirHostPath: "/state", composeFiles: ["docker-compose.yml"], composeProject: "dpf" },
    protocolSecret: secret,
    protocolSecretFileHostPath: "/state/transition-secret",
    resolveProjection: vi.fn(async (keys: readonly string[]) => ({ catalogHash: request.catalogHash, stateHash: computeCapabilityStateVersion(request.catalogHash, keys.includes("runtime:build") ? request.previousStates : request.desiredStates), enabledKeys: [...keys], composeProfiles: keys.includes("runtime:build") ? ["build"] : [], requiredServices: ["portal", "postgres"] })),
    verifyRequiredHealth: vi.fn(async () => true),
    now: () => 1_000_000,
    readHostReceipt: vi.fn(async (_transitionId: string) => {
      const envelope = { version: 1 as const, transitionId: request.transitionId, issuedAt: new Date(1_000_000).toISOString(), expiresAt: new Date(1_600_000).toISOString(), catalogHash: request.catalogHash, previousStateHash: computeCapabilityStateVersion(request.catalogHash, request.previousStates), desiredStateHash: computeCapabilityStateVersion(request.catalogHash, request.desiredStates), previousKeys: [...request.previousKeys], desiredKeys: [...request.desiredKeys], previousProfiles: ["build"], desiredProfiles: [], previousServices: ["portal", "postgres"], desiredServices: ["portal", "postgres"] };
      const unsigned = { ...envelope, status: "applied" as const, observedServices: ["portal", "postgres"], completedAt: new Date(1_000_001).toISOString(), beforeHash: envelope.previousStateHash, afterHash: envelope.desiredStateHash };
      return { ...unsigned, signature: signTransitionPayload(unsigned, secret) };
    }),
    ...overrides,
  };
}

const reconciliationIds = ["runtime:core", "runtime:build", "runtime:local-ai"];
function reconciliationRequest() {
  const previousStates = { "runtime:core": "active", "runtime:build": "active", "runtime:local-ai": "operator-paused" };
  const desiredStates = { ...previousStates, "runtime:build": "disabled" };
  return { ...request, previousKeys: ["runtime:core"], desiredKeys: ["runtime:core"], previousStates, desiredStates,
    reconciliation: { observedHost: { schemaVersion: 2, installerVersion: "fixture", platform: "win32", arch: "amd64",
      capabilityCatalogHash: request.catalogHash, capabilityStateVersion: computeHostStateVersion(request.catalogHash, ["runtime:core"], reconciliationIds), enabledRuntimeCapabilities: ["runtime:core"] },
    observedDatabaseStates: { ...previousStates }, desiredHostEnabledKeys: ["runtime:core"], desiredDatabaseStates: { ...desiredStates }, touchedKeys: ["runtime:build"] } };
}
function reconciliationDeps() {
  const d = deps({ catalogCapabilityIds: reconciliationIds,
    reconciliationProtocol: { schemaVersion: 1, sourceSha: "a".repeat(40), actuatorSha256: "b".repeat(64), signerSha256: "c".repeat(64), signingVersions: [1, 2], applyVersions: [1, 2], reconciliationVersions: [2] },
    reconciliationPromoterDigest: `sha256:${"d".repeat(64)}`,
    resolveProjection: async keys => ({ catalogHash: request.catalogHash, stateHash: computeHostStateVersion(request.catalogHash, keys, reconciliationIds), enabledKeys: [...keys], composeProfiles: [], requiredServices: ["portal"] }),
  });
  d.receipts.commitSuccess = vi.fn(async () => undefined);
  d.readHostReceipt = vi.fn(async () => {
    const envelope = vi.mocked(d.receipts.createPending).mock.calls[0]![0].envelope;
    const unsigned = { ...envelope, status: "applied" as const, observedServices: ["portal"], completedAt: new Date(1_000_001).toISOString(), beforeHash: envelope.previousStateHash, afterHash: envelope.desiredStateHash };
    return { ...unsigned, signature: signTransitionPayload(unsigned, d.protocolSecret!) };
  });
  return d;
}

describe("dual-baseline reconciliation coordinator", () => {
  it.each(["failed", "threw"])("does not compensate over a later database writer when health %s", async outcome => {
    const d = reconciliationDeps();
    d.verifyRequiredHealth = vi.fn(async () => { if (outcome === "threw") throw new Error("health_unavailable"); return false; });
    d.receipts.markCompensating = vi.fn(async () => undefined);
    d.receipts.markRolledBack = vi.fn(async () => undefined);
    d.receipts.markRollbackFailed = vi.fn(async () => undefined);
    d.receipts.assertCompensationOwnership = vi.fn(async () => { throw new Error("runtime_transition_database_stale"); });
    expect(await coordinateRuntimeCapabilityTransition(reconciliationRequest(), d)).toEqual({ status: "rollback_failed", failure: "runtime_transition_database_stale" });
    expect(d.runPromoter).toHaveBeenCalledTimes(1);
    expect(d.receipts.markCompensating).toHaveBeenCalledTimes(1);
    expect(d.receipts.assertCompensationOwnership).toHaveBeenCalledWith("RCT-1");
    expect(vi.mocked(d.receipts.markCompensating!).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(d.receipts.assertCompensationOwnership!).mock.invocationCallOrder[0]!);
    expect(d.receipts.markRollbackFailed).toHaveBeenCalledWith("RCT-1", "runtime_transition_database_stale");
  });
  it("fails closed when compensation ownership cannot be checked", async () => {
    const d = reconciliationDeps(); d.verifyRequiredHealth = vi.fn(async () => false);
    d.receipts.markCompensating = vi.fn(async () => undefined);
    d.receipts.markRolledBack = vi.fn(async () => undefined);
    d.receipts.markRollbackFailed = vi.fn(async () => undefined);
    expect(await coordinateRuntimeCapabilityTransition(reconciliationRequest(), d)).toEqual({ status: "rollback_failed", failure: "runtime_transition_compensation_ownership_unavailable" });
    expect(d.runPromoter).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("checks the complete persisted database baseline before compensation (stale=%s)", async stale => {
    const baseline = reconciliationRequest().previousStates;
    const current = { ...baseline, ...(stale ? { "runtime:local-ai": "active" } : {}) };
    const tx = { runtimeCapabilityTransition: { findUnique: vi.fn(async () => ({ status: "compensating", previousStates: baseline })) },
      platformCapability: { findMany: vi.fn(async () => Object.entries(current).map(([capabilityId, state]) => ({ capabilityId, state }))) } };
    const receipts = createPrismaRuntimeTransitionReceipts({ $transaction: async (fn: (value: typeof tx) => Promise<void>) => fn(tx) } as never);
    if (stale) await expect(receipts.assertCompensationOwnership!("RCT-1")).rejects.toThrow("runtime_transition_database_stale");
    else await expect(receipts.assertCompensationOwnership!("RCT-1")).resolves.toBeUndefined();
  });
  it("refuses replay through a different immutable promoter", async () => {
    const d = reconciliationDeps(); await coordinateRuntimeCapabilityTransition(reconciliationRequest(), d);
    const input = vi.mocked(d.receipts.createPending).mock.calls[0][0];
    const replay = { ...input, envelope: structuredClone(input.envelope), status: "pending" };
    const changed = { ...input, envelope: structuredClone(input.envelope) };
    changed.envelope.protocolIdentity!.promoterDigest = `sha256:${"f".repeat(64)}`;
    const tx = { $executeRaw: vi.fn(), runtimeCapabilityTransition: { findUnique: vi.fn(async () => replay) } };
    const receipts = createPrismaRuntimeTransitionReceipts({ $transaction: vi.fn(async (fn) => fn(tx)) } as never);
    await expect(receipts.createPending(changed)).rejects.toThrow("transition_id_conflict");
  });

  it("retains the original compensation packet when recovery becomes uncertain", async () => {
    const compensation = { envelope: persistedEnvelope, envelopeSignature: "a".repeat(64) };
    const tx = { runtimeCapabilityTransition: { findUnique: vi.fn(async () => ({ status: "compensating", failure: { code: "original", compensation } })), updateMany: vi.fn(async () => ({ count: 1 })) }, runtimeCapabilityTransitionEvent: { create: vi.fn() } };
    const receipts = createPrismaRuntimeTransitionReceipts({ $transaction: vi.fn(async (fn) => fn(tx)) } as never);
    await receipts.markRollbackFailed!("RCT-1", "receipt-unavailable");
    expect(tx.runtimeCapabilityTransition.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ failure: { code: "receipt-unavailable", compensation, recoveryRequired: true } }) }));
  });
  it("signs independent host and database baselines while retaining unknown untouched state", async () => {
    const input = reconciliationRequest(), d = reconciliationDeps();
    expect(await coordinateRuntimeCapabilityTransition(input, d)).toEqual({ status: "succeeded" });
    const envelope = vi.mocked(d.receipts.createPending).mock.calls[0]![0].envelope;
    expect(envelope).toMatchObject({ version: 2, mode: "reconciliation", previousKeys: ["runtime:core"],
      reconciliation: { observedDatabaseStates: { "runtime:build": "active" }, desiredDatabaseStates: { "runtime:build": "disabled", "runtime:local-ai": "operator-paused" } } });
    expect(envelope.previousStateHash).toBe(input.reconciliation.observedHost.capabilityStateVersion);
  });
  it("refuses unsupported reconciliation before durable admission", async () => {
    const d = reconciliationDeps(); delete d.reconciliationProtocol;
    expect(await coordinateRuntimeCapabilityTransition(reconciliationRequest(), d)).toEqual({ status: "failed", failure: "runtime_reconciliation_protocol_unavailable" });
    expect(d.receipts.createPending).not.toHaveBeenCalled();
    expect(d.runPromoter).not.toHaveBeenCalled();
  });
  async function databaseFixture(stale = false) {
    const input = reconciliationRequest(), d = reconciliationDeps();
    await coordinateRuntimeCapabilityTransition(input, d);
    const envelope = vi.mocked(d.receipts.createPending).mock.calls[0]![0].envelope;
    const states = { ...input.previousStates, ...(stale ? { "runtime:build": "disabled" } : {}) };
    const tx = { $executeRaw: vi.fn(async () => 1),
      runtimeCapabilityTransition: { findUnique: vi.fn(async () => ({ status: "host_applied", envelope, previousStates: input.previousStates, desiredStates: input.desiredStates })), updateMany: vi.fn(async () => ({ count: 1 })) },
      platformCapability: { findMany: vi.fn(async () => Object.entries(states).map(([capabilityId, state]) => ({ capabilityId, state }))), updateMany: vi.fn(async () => ({ count: 1 })) },
      runtimeCapabilityTransitionEvent: { create: vi.fn(async () => undefined) } };
    const receipts = createPrismaRuntimeTransitionReceipts({ $transaction: async (operation: (tx: unknown) => unknown) => operation(tx) } as never);
    return { input, tx, receipts, receipt: await d.readHostReceipt!(input.transitionId) };
  }
  it("writes only touched database keys through the observed-state CAS", async () => {
    const f = await databaseFixture();
    await f.receipts.commitSuccess!(f.input.transitionId, f.receipt, f.input.desiredStates);
    expect(f.tx.platformCapability.updateMany).toHaveBeenCalledExactlyOnceWith({ where: { capabilityId: "runtime:build", state: "active" }, data: { state: "disabled" } });
  });
  it("rejects a subsequent database writer before capability writes", async () => {
    const f = await databaseFixture(true);
    await expect(f.receipts.commitSuccess!(f.input.transitionId, f.receipt, f.input.desiredStates)).rejects.toThrow("runtime_transition_database_stale");
    expect(f.tx.platformCapability.updateMany).not.toHaveBeenCalled();
  });
});

describe("runtime capability transition coordinator", () => {
  it("captures request identity before asynchronous projection work", async () => {
    const mutable = structuredClone(request);
    const d = deps();
    const resolve = d.resolveProjection!;
    d.resolveProjection = vi.fn(async (keys) => {
      mutable.transitionId = "RCT-MUTATED";
      mutable.requestedById = "another-user";
      mutable.desiredStates["runtime:build"] = "active";
      return resolve(keys);
    });
    await coordinateRuntimeCapabilityTransition(mutable, d);
    expect(d.receipts.createPending).toHaveBeenCalledWith(expect.objectContaining({
      transitionId: request.transitionId, requestedById: request.requestedById,
      desiredStates: request.desiredStates,
      envelope: expect.objectContaining({ transitionId: request.transitionId }),
    }));
    expect(d.readHostReceipt).toHaveBeenCalledWith(request.transitionId);
  });

  it.each([
    { ...request.previousStates, "runtime:build": "disabled" },
    { ...request.previousStates, "runtime:local-speech": "disabled" },
    { "runtime:core": "active" },
  ])("rejects a changed complete database baseline before creating a receipt", async (states) => {
    const model = { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null), create: vi.fn(), updateMany: vi.fn() };
    const tx = { $executeRaw: vi.fn(), runtimeCapabilityTransition: model,
      platformCapability: { findMany: vi.fn(async () => Object.entries(states).map(([capabilityId, state]) => ({ capabilityId, state }))) } };
    const receipts = createPrismaRuntimeTransitionReceipts({ $transaction: vi.fn(async (fn) => fn(tx)) } as never);
    await expect(receipts.createPending({ ...request, previousProfiles: ["build"], desiredProfiles: [], previousStateHash: "before", desiredStateHash: "after", envelope: persistedEnvelope, envelopeSignature: "a".repeat(64) })).rejects.toThrow("runtime_transition_database_baseline_changed");
    expect(model.create).not.toHaveBeenCalled();
  });

  it.each([
    { requestedById: "another-user" },
    { previousStates: { ...request.previousStates, "runtime:local-speech": "disabled" } },
    { desiredStates: { ...request.desiredStates, "runtime:local-speech": "disabled" } },
  ])("rejects replay with a different owner or complete state map", async (change) => {
    const row = { ...request, ...persistedEnvelope, status: "pending", envelope: persistedEnvelope, envelopeSignature: "a".repeat(64), ...change };
    const model = { findUnique: vi.fn(async () => row), findFirst: vi.fn(), create: vi.fn() };
    const tx = { $executeRaw: vi.fn(), runtimeCapabilityTransition: model };
    const receipts = createPrismaRuntimeTransitionReceipts({ $transaction: vi.fn(async (fn) => fn(tx)) } as never);
    await expect(receipts.createPending({ ...request, previousProfiles: ["build"], desiredProfiles: [], previousStateHash: "before", desiredStateHash: "after", envelope: persistedEnvelope, envelopeSignature: "a".repeat(64) })).rejects.toThrow("transition_id_conflict");
    expect(model.create).not.toHaveBeenCalled();
  });

  it("classifies the persisted state by schema identity and hashes, never journal phase", () => {
    const row = { ...request, ...persistedEnvelope, previousStateHash: "before", desiredStateHash: "after", previousStates: request.previousStates, desiredStates: request.desiredStates, createdAt: new Date(), status: "pending", envelope: persistedEnvelope, envelopeSignature: "x" };
    const base = { schemaVersion: 1, installerVersion: "test", platform: "linux", arch: "amd64", capabilityCatalogHash: row.catalogHash };
    expect(classifyRuntimeInstallState({ ...base, enabledRuntimeCapabilities: row.previousKeys, capabilityStateVersion: "before" }, row)).toBe("previous");
    expect(classifyRuntimeInstallState({ ...base, enabledRuntimeCapabilities: row.desiredKeys, capabilityStateVersion: "after" }, row)).toBe("desired");
    expect(classifyRuntimeInstallState({ ...base, enabledRuntimeCapabilities: row.desiredKeys, capabilityStateVersion: "neither" }, row)).toBe("unknown");
  });
  it("requires Compose healthchecks to report healthy, not merely running", () => {
    expect(requiredRuntimeServicesAreHealthy(["portal", "postgres"], ["portal", "postgres"], { portal: "healthy", postgres: "healthy" })).toBe(true);
    expect(requiredRuntimeServicesAreHealthy(["portal", "postgres"], ["portal", "postgres"], { portal: "starting", postgres: "healthy" })).toBe(false);
    expect(requiredRuntimeServicesAreHealthy(["portal"], ["portal"])).toBe(false);
  });
  it("never relaunches an expired missing-receipt transition and compensates instead", async () => {
    const secret = "x".repeat(32);
    const envelope = { ...persistedEnvelope, issuedAt: new Date(1_000).toISOString(), expiresAt: new Date(2_000).toISOString() };
    const row = { ...request, ...envelope, previousStates: request.previousStates, desiredStates: request.desiredStates, createdAt: new Date(1_000), status: "pending", envelope, envelopeSignature: signTransitionPayload(envelope, secret) };
    const relaunch = vi.fn(); const compensate = vi.fn();
    await reconcileRuntimeCapabilityTransitions({ listActive: async () => [row], readHostReceipt: async () => null, completeFromReceipt: vi.fn(), classifyTerminalReceipt: vi.fn(), relaunch, compensate, markRecoveryRequired: vi.fn(), protocolSecret: secret, now: () => 3_000 });
    expect(relaunch).not.toHaveBeenCalled();
    expect(compensate).toHaveBeenCalledWith(row, "host_receipt_absent_or_expired");
  });

  it("closes an expired request that never mutated the host without compensation or recovery", async () => {
    const secret = "x".repeat(32);
    const envelope = { ...persistedEnvelope, issuedAt: new Date(1_000).toISOString(), expiresAt: new Date(2_000).toISOString() };
    const row = { ...request, ...envelope, previousStates: request.previousStates, desiredStates: request.desiredStates, createdAt: new Date(1_000), status: "pending", envelope, envelopeSignature: signTransitionPayload(envelope, secret) };
    const clean = vi.fn(); const compensate = vi.fn(); const recovery = vi.fn();
    await reconcileRuntimeCapabilityTransitions({ listActive: async () => [row], readHostReceipt: async () => null, completeFromReceipt: vi.fn(), classifyTerminalReceipt: vi.fn(), relaunch: vi.fn(), compensate, markRecoveryRequired: recovery, protocolSecret: secret, now: () => 3_000, inspectHostInstallState: async () => "previous", markCleanPrevious: clean });
    expect(clean).toHaveBeenCalledWith(row, "host_receipt_absent_or_expired_before_mutation");
    expect(compensate).not.toHaveBeenCalled();
    expect(recovery).not.toHaveBeenCalled();
  });

  it("compensates when install-state reached desired while the journal still says prepared", async () => {
    const secret = "x".repeat(32);
    const envelope = { ...persistedEnvelope, issuedAt: new Date(1_000).toISOString(), expiresAt: new Date(2_000).toISOString() };
    const row = { ...request, ...envelope, previousStates: request.previousStates, desiredStates: request.desiredStates, createdAt: new Date(1_000), status: "pending", envelope, envelopeSignature: signTransitionPayload(envelope, secret) };
    const clean = vi.fn(); const compensate = vi.fn(); const recovery = vi.fn();
    await reconcileRuntimeCapabilityTransitions({ listActive: async () => [row], readHostReceipt: async () => null, completeFromReceipt: vi.fn(), classifyTerminalReceipt: vi.fn(), relaunch: vi.fn(), compensate, markRecoveryRequired: recovery, protocolSecret: secret, now: () => 3_000, inspectHostInstallState: async () => "desired", markCleanPrevious: clean });
    expect(compensate).toHaveBeenCalledWith(row, "host_receipt_absent_or_expired");
    expect(clean).not.toHaveBeenCalled();
    expect(recovery).not.toHaveBeenCalled();
  });

  it("requires recovery when persisted install-state matches neither snapshot", async () => {
    const secret = "x".repeat(32);
    const envelope = { ...persistedEnvelope, issuedAt: new Date(1_000).toISOString(), expiresAt: new Date(2_000).toISOString() };
    const row = { ...request, ...envelope, previousStates: request.previousStates, desiredStates: request.desiredStates, createdAt: new Date(1_000), status: "pending", envelope, envelopeSignature: signTransitionPayload(envelope, secret) };
    const recovery = vi.fn(); const compensate = vi.fn();
    await reconcileRuntimeCapabilityTransitions({ listActive: async () => [row], readHostReceipt: async () => null, completeFromReceipt: vi.fn(), classifyTerminalReceipt: vi.fn(), relaunch: vi.fn(), compensate, markRecoveryRequired: recovery, protocolSecret: secret, now: () => 3_000, inspectHostInstallState: async () => "unknown", markCleanPrevious: vi.fn() });
    expect(recovery).toHaveBeenCalledWith(row, "runtime_transition_install_state_unknown");
    expect(compensate).not.toHaveBeenCalled();
  });

  it("marks legacy nullable-envelope rows recovery_required without relaunch", async () => {
    const row = { ...request, ...persistedEnvelope, previousStates: request.previousStates, desiredStates: request.desiredStates, createdAt: new Date(1_000), status: "pending", envelope: null, envelopeSignature: null };
    const relaunch = vi.fn(); const recovery = vi.fn();
    await reconcileRuntimeCapabilityTransitions({ listActive: async () => [row], readHostReceipt: vi.fn(), completeFromReceipt: vi.fn(), classifyTerminalReceipt: vi.fn(), relaunch, compensate: vi.fn(), markRecoveryRequired: recovery, protocolSecret: "x".repeat(32), now: () => 1_500 });
    expect(relaunch).not.toHaveBeenCalled();
    expect(recovery).toHaveBeenCalledWith(row, "transition_envelope_identity_missing");
  });

  it("derives stable state versions from catalog and sorted state lines", () => {
    expect(computeCapabilityStateVersion("catalog", { b: "disabled", a: "active" }))
      .toBe(computeCapabilityStateVersion("catalog", { a: "active", b: "disabled" }));
  });

  it("uses the shared capability state hash implementation", async () => {
    const shared = await import("../../../../scripts/lib/capability-state-hash.mjs");
    expect(computeCapabilityStateVersion("catalog", { b: "disabled", a: "active" }))
      .toBe(shared.computeCapabilityStateVersion("catalog", { a: "active", b: "disabled" }));
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

  it("rechecks attributed work under the receipt lock and returns drain_required", async () => {
    const model = { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null), create: vi.fn(), updateMany: vi.fn() };
    const tx = { $executeRaw: vi.fn(async () => []), runtimeCapabilityTransition: model };
    const receipts = createPrismaRuntimeTransitionReceipts({ runtimeCapabilityTransition: model, $transaction: vi.fn(async (fn) => fn(tx)) } as never);
    const d = deps({ receipts, recheckAttributedWork: vi.fn(async () => ({ "build-studio-active": 1 })) });
    await expect(coordinateRuntimeCapabilityTransition(request, d)).resolves.toEqual({ status: "drain_required", blockingCounts: { "build-studio-active": 1 } });
    expect(model.create).not.toHaveBeenCalled();
    expect(d.runPromoter).not.toHaveBeenCalled();
  });

  it("creates sorted durable receipts under an advisory lock and serializable transaction", async () => {
    const model = { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) };
    const tx = { $executeRaw: vi.fn(async () => []), runtimeCapabilityTransition: model, platformCapability: { findMany: vi.fn(async () => Object.entries(request.previousStates).map(([capabilityId, state]) => ({ capabilityId, state }))) } };
    const prisma = { runtimeCapabilityTransition: model, $transaction: vi.fn(async (fn) => fn(tx)) };
    const receipts = createPrismaRuntimeTransitionReceipts(prisma as never);
    const envelope = { ...persistedEnvelope, previousKeys: ["z", "a"], desiredKeys: ["z", "b"], previousProfiles: [], desiredProfiles: [] };
    await expect(receipts.createPending({ ...request, previousKeys: ["z", "a"], desiredKeys: ["z", "b"], previousProfiles: [], desiredProfiles: [], previousStateHash: "before", desiredStateHash: "after", envelope, envelopeSignature: "a".repeat(64) })).resolves.toEqual({ created: true, envelope, envelopeSignature: "a".repeat(64) });
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(model.create).toHaveBeenCalledWith({ data: expect.objectContaining({ previousKeys: ["a", "z"], desiredKeys: ["b", "z"], status: "pending" }) });
  });

  it("reconciles an idempotent transition-id retry without creating another row", async () => {
    const identity = persistedEnvelope;
    const model = { findFirst: vi.fn(), findUnique: vi.fn(async () => ({ ...request, status: "host_applied", ...identity, envelope: identity, envelopeSignature: "a".repeat(64) })), create: vi.fn(), updateMany: vi.fn() };
    const tx = { $executeRaw: vi.fn(async () => []), runtimeCapabilityTransition: model };
    const prisma = { runtimeCapabilityTransition: model, $transaction: vi.fn(async (fn) => fn(tx)) };
    const receipts = createPrismaRuntimeTransitionReceipts(prisma as never);
    await expect(receipts.createPending({ ...request, previousProfiles: ["build"], desiredProfiles: [], previousStateHash: "before", desiredStateHash: "after", envelope: identity, envelopeSignature: "a".repeat(64) })).resolves.toEqual({ created: false, kind: "replay", status: "host_applied", envelope: identity, envelopeSignature: "a".repeat(64) });
    expect(model.create).not.toHaveBeenCalled();
  });

  it("fails closed when a replayed transition id carries a different immutable envelope", async () => {
    const model = { findFirst: vi.fn(), findUnique: vi.fn(async () => ({ status: "pending", catalogHash: request.catalogHash, previousStateHash: "different", desiredStateHash: "after", previousKeys: [...request.previousKeys], desiredKeys: [...request.desiredKeys] })), create: vi.fn(), updateMany: vi.fn() };
    const tx = { $executeRaw: vi.fn(async () => []), runtimeCapabilityTransition: model };
    const receipts = createPrismaRuntimeTransitionReceipts({ runtimeCapabilityTransition: model, $transaction: vi.fn(async (fn) => fn(tx)) } as never);
    await expect(receipts.createPending({ ...request, previousProfiles: ["build"], desiredProfiles: [], previousStateHash: "before", desiredStateHash: "after", envelope: {} as never, envelopeSignature: "a".repeat(64) })).rejects.toThrow("transition_id_conflict");
  });

  it("surfaces a different active receipt as transition_in_progress through the Prisma repository", async () => {
    const model = { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => ({ transitionId: "RCT-OTHER", status: "applying" })), create: vi.fn(), updateMany: vi.fn() };
    const tx = { $executeRaw: vi.fn(async () => []), runtimeCapabilityTransition: model };
    const receipts = createPrismaRuntimeTransitionReceipts({ runtimeCapabilityTransition: model, $transaction: vi.fn(async (fn) => fn(tx)) } as never);
    const d = deps({ receipts });
    await expect(coordinateRuntimeCapabilityTransition(request, d)).resolves.toEqual({ status: "transition_in_progress" });
    expect(d.runPromoter).not.toHaveBeenCalled();
  });

  it("uses compare-and-set updates and rejects terminal regression", async () => {
    const model = { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 0 })) };
    const tx = { runtimeCapabilityTransition: model, runtimeCapabilityTransitionEvent: { create: vi.fn() } };
    const prisma = { runtimeCapabilityTransition: model, $transaction: vi.fn(async (fn) => fn(tx)) };
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
    const secret = "x".repeat(32);
    const envelope = { version: 1 as const, transitionId: request.transitionId, issuedAt: new Date(1_000_000).toISOString(), expiresAt: new Date(1_600_000).toISOString(), catalogHash: request.catalogHash, previousStateHash: computeCapabilityStateVersion(request.catalogHash, request.previousStates), desiredStateHash: computeCapabilityStateVersion(request.catalogHash, request.desiredStates), previousKeys: [...request.previousKeys], desiredKeys: [...request.desiredKeys], previousProfiles: ["build"], desiredProfiles: [], previousServices: ["portal", "postgres"], desiredServices: ["portal", "postgres"] };
    const unsigned = { ...envelope, status: "rolled_back" as const, observedServices: ["portal", "postgres"], completedAt: new Date(1_000_001).toISOString(), beforeHash: envelope.previousStateHash, afterHash: envelope.previousStateHash, failure: "compose_reconcile_failed_rolled_back" };
    const markHostOutcome = vi.fn();
    const d = deps({ runPromoter: vi.fn(async () => ({ exitCode: 9, stdout: "", stderr: "apply failed" })), readHostReceipt: vi.fn(async (_transitionId: string) => ({ ...unsigned, signature: signTransitionPayload(unsigned, secret) })), receipts: { createPending: vi.fn(async (input: CreatePendingInput) => ({ created: true as const, envelope: input.envelope, envelopeSignature: input.envelopeSignature })), markFailed: vi.fn(), markHostApplied: vi.fn(), markHostOutcome } });
    await expect(coordinateRuntimeCapabilityTransition(request, d)).resolves.toEqual({ status: "rolled_back", failure: "compose_reconcile_failed_rolled_back" });
    expect(d.runPromoter).toHaveBeenCalledWith(expect.objectContaining({ runtimeCapabilityTransitionId: "RCT-1", containerName: "dpf-promoter-RCT-1", timeoutMs: 600_000 }));
    expect(markHostOutcome).toHaveBeenCalledWith("RCT-1", expect.objectContaining({ status: "rolled_back" }));
  });

  it("maps host claim contention to in progress without recording an outcome", async () => {
    const d = deps({ runPromoter: vi.fn(async () => ({ exitCode: 75, stdout: "", stderr: "contended" })) });
    await expect(coordinateRuntimeCapabilityTransition(request, d)).resolves.toEqual({ status: "transition_in_progress" });
    expect(d.receipts.markFailed).not.toHaveBeenCalled();
    expect(d.receipts.markHostApplied).not.toHaveBeenCalled();
    expect(d.readHostReceipt).not.toHaveBeenCalled();
  });

  it("stops at host_applied when persistence has not supplied the transactional commit boundary", async () => {
    const d = deps();
    await expect(coordinateRuntimeCapabilityTransition(request, d)).resolves.toEqual({ status: "host_applied_pending_verification" });
    expect(d.receipts.markHostApplied).toHaveBeenCalledWith("RCT-1");
  });

  it("commits desired capability state and audit receipt after host apply and health verification", async () => {
    const d = deps({ receipts: {
      createPending: vi.fn(async (input: CreatePendingInput) => ({ created: true as const, envelope: input.envelope, envelopeSignature: input.envelopeSignature })),
      markFailed: vi.fn(), markHostApplied: vi.fn(), commitSuccess: vi.fn(),
    } });
    await expect(coordinateRuntimeCapabilityTransition(request, d)).resolves.toEqual({ status: "succeeded" });
    expect(d.receipts.markHostApplied).toHaveBeenCalledWith("RCT-1");
    expect(d.receipts.commitSuccess).toHaveBeenCalledWith("RCT-1", expect.objectContaining({ status: "applied" }), request.desiredStates);
  });

  it("compensates a host apply when the transactional DB commit fails", async () => {
    const secret = "x".repeat(32);
    const d = deps({ receipts: {
      createPending: vi.fn(async (input: CreatePendingInput) => ({ created: true as const, envelope: input.envelope, envelopeSignature: input.envelopeSignature })),
      markFailed: vi.fn(), markHostApplied: vi.fn(),
      commitSuccess: vi.fn(async () => { throw new Error("db_commit_failed"); }),
      markCompensating: vi.fn(), markRolledBack: vi.fn(), markRollbackFailed: vi.fn(),
    } });
    d.readHostReceipt = vi.fn(async (transitionId: string) => {
      const rollback = transitionId.endsWith("-rb");
      const states = rollback ? [request.desiredStates, request.previousStates] : [request.previousStates, request.desiredStates];
      const keys = rollback ? [request.desiredKeys, request.previousKeys] : [request.previousKeys, request.desiredKeys];
      const envelope = { version: 1 as const, transitionId, issuedAt: new Date(1_000_000).toISOString(), expiresAt: new Date(1_600_000).toISOString(), catalogHash: request.catalogHash,
        previousStateHash: computeCapabilityStateVersion(request.catalogHash, states[0]), desiredStateHash: computeCapabilityStateVersion(request.catalogHash, states[1]),
        previousKeys: [...keys[0]], desiredKeys: [...keys[1]], previousProfiles: rollback ? [] : ["build"], desiredProfiles: rollback ? ["build"] : [], previousServices: ["portal", "postgres"], desiredServices: ["portal", "postgres"] };
      const unsigned = { ...envelope, status: "applied" as const, observedServices: ["portal", "postgres"], completedAt: new Date(1_000_001).toISOString(), beforeHash: envelope.previousStateHash, afterHash: envelope.desiredStateHash };
      return { ...unsigned, signature: signTransitionPayload(unsigned, secret) };
    });
    await expect(coordinateRuntimeCapabilityTransition(request, d)).resolves.toEqual({ status: "rolled_back", failure: "db_commit_failed" });
    expect(d.receipts.markCompensating).toHaveBeenCalledWith("RCT-1", "db_commit_failed", expect.objectContaining({ envelope: expect.objectContaining({ transitionId: expect.stringMatching(/^RCT-[a-f0-9]{24}-rb$/) }), envelopeSignature: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    const persisted = vi.mocked(d.receipts.markCompensating!).mock.calls[0][2]!;
    const launched = vi.mocked(d.runPromoter).mock.calls[1][0];
    expect(JSON.parse(Buffer.from(launched.runtimeCapabilityEnvelope!, "base64url").toString())).toEqual(persisted.envelope);
    expect(launched.runtimeCapabilitySignature).toBe(persisted.envelopeSignature);
    expect(vi.mocked(d.receipts.markCompensating!).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(d.runPromoter).mock.invocationCallOrder[1]);
    expect(d.receipts.markRolledBack).toHaveBeenCalledWith("RCT-1", expect.objectContaining({ status: "applied" }));
  });

  it("records rollback_failed when compensation cannot restore the previous projection", async () => {
    const d = deps({ receipts: {
      createPending: vi.fn(async (input: CreatePendingInput) => ({ created: true as const, envelope: input.envelope, envelopeSignature: input.envelopeSignature })),
      markFailed: vi.fn(), markHostApplied: vi.fn(),
      commitSuccess: vi.fn(async () => { throw new Error("db_commit_failed"); }),
      markCompensating: vi.fn(), markRolledBack: vi.fn(), markRollbackFailed: vi.fn(),
    } });
    d.runPromoter = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 9, stdout: "", stderr: "rollback failed" });
    await expect(coordinateRuntimeCapabilityTransition(request, d)).resolves.toEqual({ status: "rollback_failed", failure: "db_commit_failed" });
    expect(d.receipts.markRollbackFailed).toHaveBeenCalledWith("RCT-1", "rollback_host_apply_failed");
  });
});
