import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { canonicalTransitionPayload, signTransitionPayload, validateRuntimeCapabilityProtocolInfo, verifyHistoricalTransitionReceipt, verifyTransitionReceipt, type RuntimeTransitionEnvelope } from "./transition-protocol";

const secret = "s".repeat(32);
const envelope: RuntimeTransitionEnvelope = {
  version: 1, transitionId: "RCT-test", issuedAt: new Date(1_000).toISOString(), expiresAt: new Date(601_000).toISOString(),
  catalogHash: "a".repeat(64), previousStateHash: "b".repeat(64), desiredStateHash: "c".repeat(64),
  previousKeys: ["runtime:core"], desiredKeys: ["runtime:core"], previousProfiles: [], desiredProfiles: [], previousServices: ["portal"], desiredServices: ["portal"],
};

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
