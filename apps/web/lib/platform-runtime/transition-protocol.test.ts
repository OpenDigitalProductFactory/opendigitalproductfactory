import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { canonicalTransitionPayload, prepareRuntimeReconciliationIntent, signTransitionPayload, validateRuntimeCapabilityProtocolInfo, verifyHistoricalTransitionReceipt, verifyTransitionReceipt, type RuntimeTransitionEnvelope } from "./transition-protocol";
import { computeCapabilityStateVersion } from "../../../../scripts/lib/capability-state-hash.mjs";

const secret = "s".repeat(32);
const envelope: RuntimeTransitionEnvelope = {
  version: 1, transitionId: "RCT-test", issuedAt: new Date(1_000).toISOString(), expiresAt: new Date(601_000).toISOString(),
  catalogHash: "a".repeat(64), previousStateHash: "b".repeat(64), desiredStateHash: "c".repeat(64),
  previousKeys: ["runtime:core"], desiredKeys: ["runtime:core"], previousProfiles: [], desiredProfiles: [], previousServices: ["portal"], desiredServices: ["portal"],
};

describe("explicit dual-baseline reconciliation intent", () => {
  const capabilityIds = ["runtime:core", "runtime:build", "runtime:local-ai"];
  const catalogHash = "a".repeat(64);
  const context = { catalogHash, capabilityIds };
  const request = () => ({
    observedHost: { schemaVersion: 2, installerVersion: "test", platform: "win32", arch: "amd64",
      capabilityCatalogHash: catalogHash,
      capabilityStateVersion: computeCapabilityStateVersion(catalogHash, ["runtime:core"], capabilityIds),
      enabledRuntimeCapabilities: ["runtime:core"] },
    observedDatabaseStates: { "runtime:core": "active", "runtime:build": "active", "runtime:local-ai": "operator-paused" },
    desiredHostEnabledKeys: ["runtime:core"],
    desiredDatabaseStates: { "runtime:core": "active", "runtime:build": "disabled", "runtime:local-ai": "operator-paused" },
    touchedKeys: ["runtime:build"],
  });

  it("keeps independent baselines and unknown untouched intent with explicit residual drift", () => {
    const intent = prepareRuntimeReconciliationIntent(request(), context);
    expect(intent.observedHost.enabledRuntimeCapabilities).toEqual(["runtime:core"]);
    expect(intent.observedDatabaseStates["runtime:build"]).toBe("active");
    expect(intent.desiredDatabaseStates["runtime:build"]).toBe("disabled");
    expect(intent.desiredDatabaseStates["runtime:local-ai"]).toBe("operator-paused");
    expect(intent.residualDriftKeys).toEqual(["runtime:local-ai"]);
  });

  it("rejects changes outside the explicitly touched database keys", () => {
    const input = request();
    input.desiredDatabaseStates["runtime:local-ai"] = "disabled";
    expect(() => prepareRuntimeReconciliationIntent(input, context)).toThrow("reconciliation_untouched_state_changed");
  });

  it.each(["missing", "unknown", "invalid-managed"])("refuses %s database intent", kind => {
    const input = request();
    if (kind === "missing") delete (input.observedDatabaseStates as Record<string, string>)["runtime:local-ai"];
    if (kind === "unknown") (input.desiredDatabaseStates as Record<string, string>)["runtime:unknown"] = "active";
    if (kind === "invalid-managed") input.desiredDatabaseStates["runtime:build"] = "unproven";
    expect(() => prepareRuntimeReconciliationIntent(input, context)).toThrow(
      kind === "invalid-managed" ? "reconciliation_managed_state_invalid" : "reconciliation_database_map_invalid");
  });

  it.each(["catalog", "hash", "identity"])("refuses stale or unreadable host %s", kind => {
    const input = request();
    if (kind === "catalog") input.observedHost.capabilityCatalogHash = "f".repeat(64);
    if (kind === "hash") input.observedHost.capabilityStateVersion = "f".repeat(64);
    if (kind === "identity") input.observedHost.platform = "unknown";
    expect(() => prepareRuntimeReconciliationIntent(input, context)).toThrow("reconciliation_host_baseline_invalid");
  });

  it("owns every array and state map before later caller mutation", () => {
    const input = request();
    const intent = prepareRuntimeReconciliationIntent(input, context);
    input.observedHost.enabledRuntimeCapabilities.push("runtime:build");
    input.touchedKeys.push("runtime:local-ai");
    input.desiredDatabaseStates["runtime:build"] = "active";
    expect(intent.observedHost.enabledRuntimeCapabilities).toEqual(["runtime:core"]);
    expect(intent.touchedKeys).toEqual(["runtime:build"]);
    expect(intent.desiredDatabaseStates["runtime:build"]).toBe("disabled");
  });

  it.each(["duplicate", "unknown"])("refuses %s touched scope", kind => {
    const input = request();
    input.touchedKeys.push(kind === "duplicate" ? "runtime:build" : "runtime:unknown");
    expect(() => prepareRuntimeReconciliationIntent(input, context)).toThrow("reconciliation_touched_keys_invalid");
  });
});

describe("runtime capability protocol discovery", () => {
  const expected = { sourceSha: "a".repeat(40), actuatorSha256: "b".repeat(64), signerSha256: "c".repeat(64) };
  const info = { schemaVersion: 1, ...expected, signingVersions: [1, 2], applyVersions: [1], reconciliationVersions: [] };

  it("binds packaged protocol information to trusted source and both byte digests", () => {
    expect(validateRuntimeCapabilityProtocolInfo(info, expected)).toEqual(info);
    for (const field of ["sourceSha", "actuatorSha256", "signerSha256"] as const) {
      expect(() => validateRuntimeCapabilityProtocolInfo({ ...info, [field]: "d".repeat(field === "sourceSha" ? 40 : 64) }, expected)).toThrow("runtime_protocol_probe_identity_mismatch");
    }
  });

  it("refuses malformed or contradictory support instead of inferring compatibility", () => {
    for (const value of [null, [], {}, { ...info, schemaVersion: 2 }, { ...info, applyVersions: [2, 1] }, { ...info, signingVersions: [1, 1] }, { ...info, signingVersions: [0] }, { ...info, applyVersions: [3] }, { ...info, reconciliationVersions: [2] }, { ...info, signerSha256: "unknown" }]) {
      expect(() => validateRuntimeCapabilityProtocolInfo(value, expected)).toThrow("runtime_protocol_probe_invalid");
    }
  });
});

describe("runtime transition receipt verification", () => {
  it("binds every nested reconciliation baseline and touched key to the original receipt request", () => {
    const intent = { observedHost: { schemaVersion: 2, installerVersion: "fixture", platform: "win32", arch: "amd64",
      capabilityCatalogHash: envelope.catalogHash, capabilityStateVersion: envelope.previousStateHash, enabledRuntimeCapabilities: ["runtime:core"] },
    observedDatabaseStates: { "runtime:core": "active" }, desiredHostEnabledKeys: ["runtime:core"],
    desiredDatabaseStates: { "runtime:core": "active" }, touchedKeys: ["runtime:core"] };
    const v2: RuntimeTransitionEnvelope = { ...envelope, version: 2, kind: "runtime-capability-transition", mode: "reconciliation", reconciliation: intent };
    const unsigned = { ...v2, status: "applied" as const, observedServices: ["portal"], completedAt: new Date(2_000).toISOString(), beforeHash: v2.previousStateHash, afterHash: v2.desiredStateHash };
    const receipt = { ...unsigned, signature: signTransitionPayload(unsigned, secret) };
    expect(verifyTransitionReceipt(receipt, secret, v2, 2_000)).toBe("applied");
    const changed = { ...unsigned, reconciliation: { ...intent, touchedKeys: [] } };
    expect(() => verifyTransitionReceipt({ ...changed, signature: signTransitionPayload(changed, secret) }, secret, v2, 2_000)).toThrow("runtime_transition_receipt_mismatch");
  });
  it("authenticates nested health in a version 2 ordinary transition without changing legacy parsing", () => {
    const v2: RuntimeTransitionEnvelope = { ...envelope, version: 2, kind: "runtime-capability-transition", mode: "transition" };
    const unsigned = { ...v2, status: "applied" as const, observedServices: ["portal"], observedHealth: { portal: "healthy" as const }, completedAt: new Date(2_000).toISOString(), beforeHash: v2.previousStateHash, afterHash: v2.desiredStateHash };
    const receipt = { ...unsigned, signature: signTransitionPayload(unsigned, secret) };
    expect(verifyTransitionReceipt(receipt, secret, v2, 2_000)).toBe("applied");
    expect(() => verifyTransitionReceipt({ ...receipt, observedHealth: { portal: "unhealthy" } }, secret, v2, 2_000)).toThrow("tampered");
    expect(() => verifyHistoricalTransitionReceipt({ ...receipt, observedHealth: { portal: "unhealthy" } }, secret, v2)).toThrow("tampered");
  });
  it("refuses an unsupported signed version 2 reconciliation receipt", () => {
    const v2 = { ...envelope, version: 2, kind: "runtime-capability-transition", mode: "reconciliation" } as unknown as RuntimeTransitionEnvelope;
    const unsigned = { ...v2, status: "applied" as const, observedServices: ["portal"], completedAt: new Date(2_000).toISOString(), beforeHash: v2.previousStateHash, afterHash: v2.desiredStateHash };
    const receipt = { ...unsigned, signature: signTransitionPayload(unsigned, secret) };
    expect(() => verifyTransitionReceipt(receipt, secret, v2, 2_000)).toThrow("unsupported_runtime_transition_mode");
    expect(() => verifyHistoricalTransitionReceipt(receipt, secret, v2)).toThrow("unsupported_runtime_transition_mode");
  });
  it("refuses malformed version 2 receipts instead of accepting legacy unsigned nested health", () => {
    const malformed = { ...envelope, version: 2 } as unknown as RuntimeTransitionEnvelope;
    const unsigned = { ...malformed, status: "applied" as const, observedServices: ["portal"], observedHealth: { portal: "unhealthy" as const }, completedAt: new Date(2_000).toISOString(), beforeHash: malformed.previousStateHash, afterHash: malformed.desiredStateHash };
    // This reproduces the old fallback's actual signature. No v2 kind exists.
    const signature = createHmac("sha256", secret).update(JSON.stringify(unsigned, Object.keys(unsigned).sort())).digest("hex");
    const changed = { ...unsigned, observedHealth: { portal: "healthy" as const }, signature };
    expect(() => verifyTransitionReceipt(changed, secret, malformed, 2_000)).toThrow("unsupported_runtime_transition_kind");
    expect(() => verifyHistoricalTransitionReceipt(changed, secret, malformed)).toThrow("unsupported_runtime_transition_kind");
  });
  it("delegates to the shared runtime-neutral signing bytes", async () => {
    const shared = await import("../../../../scripts/lib/transition-signing.mjs");
    expect(canonicalTransitionPayload(envelope)).toBe(shared.canonicalTransitionPayload(envelope));
    expect(signTransitionPayload(envelope, secret)).toBe(shared.signTransitionPayload(envelope, secret));
  });
  it.each(["failed", "rolled_back", "rollback_failed"] as const)("authenticates the exact %s host outcome", (status) => {
    const unsigned = { ...envelope, status, observedServices: ["portal"], completedAt: new Date(2_000).toISOString(), beforeHash: envelope.previousStateHash, afterHash: envelope.previousStateHash, failure: "host_failure" };
    expect(verifyTransitionReceipt({ ...unsigned, signature: signTransitionPayload(unsigned, secret) }, secret, envelope, 2_000)).toBe(status);
  });

  it("rejects a failure receipt that claims the desired state was applied", () => {
    const unsigned = { ...envelope, status: "failed" as const, observedServices: [], completedAt: new Date(2_000).toISOString(), beforeHash: envelope.previousStateHash, afterHash: envelope.desiredStateHash };
    expect(() => verifyTransitionReceipt({ ...unsigned, signature: signTransitionPayload(unsigned, secret) }, secret, envelope, 2_000)).toThrow("runtime_transition_failure_receipt_mismatch");
  });

  it("accepts an expired but historically timely signed receipt during recovery", () => {
    const unsigned = { ...envelope, status: "applied" as const, observedServices: ["portal"], completedAt: new Date(600_000).toISOString(), beforeHash: envelope.previousStateHash, afterHash: envelope.desiredStateHash };
    const receipt = { ...unsigned, signature: signTransitionPayload(unsigned, secret) };
    expect(() => verifyTransitionReceipt(receipt, secret, envelope, 700_000)).toThrow("runtime_transition_receipt_expired");
    expect(verifyHistoricalTransitionReceipt(receipt, secret, envelope)).toBe("applied");
  });

  it("rejects a receipt completed outside its signed validity interval", () => {
    const unsigned = { ...envelope, status: "applied" as const, observedServices: ["portal"], completedAt: new Date(602_000).toISOString(), beforeHash: envelope.previousStateHash, afterHash: envelope.desiredStateHash };
    expect(() => verifyHistoricalTransitionReceipt({ ...unsigned, signature: signTransitionPayload(unsigned, secret) }, secret, envelope)).toThrow("runtime_transition_receipt_time_invalid");
  });
});
