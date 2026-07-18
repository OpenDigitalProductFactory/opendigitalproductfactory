import { describe, expect, it } from "vitest";
import { signTransitionPayload, verifyTransitionReceipt, type RuntimeTransitionEnvelope } from "./transition-protocol";

const secret = "s".repeat(32);
const envelope: RuntimeTransitionEnvelope = {
  version: 1, transitionId: "RCT-test", issuedAt: new Date(1_000).toISOString(), expiresAt: new Date(601_000).toISOString(),
  catalogHash: "a".repeat(64), previousStateHash: "b".repeat(64), desiredStateHash: "c".repeat(64),
  previousKeys: ["runtime:core"], desiredKeys: ["runtime:core"], previousProfiles: [], desiredProfiles: [], previousServices: ["portal"], desiredServices: ["portal"],
};

describe("runtime transition receipt verification", () => {
  it.each(["failed", "rolled_back", "rollback_failed"] as const)("authenticates the exact %s host outcome", (status) => {
    const unsigned = { ...envelope, status, observedServices: ["portal"], completedAt: new Date(2_000).toISOString(), beforeHash: envelope.previousStateHash, afterHash: envelope.previousStateHash, failure: "host_failure" };
    expect(verifyTransitionReceipt({ ...unsigned, signature: signTransitionPayload(unsigned, secret) }, secret, envelope, 2_000)).toBe(status);
  });

  it("rejects a failure receipt that claims the desired state was applied", () => {
    const unsigned = { ...envelope, status: "failed" as const, observedServices: [], completedAt: new Date(2_000).toISOString(), beforeHash: envelope.previousStateHash, afterHash: envelope.desiredStateHash };
    expect(() => verifyTransitionReceipt({ ...unsigned, signature: signTransitionPayload(unsigned, secret) }, secret, envelope, 2_000)).toThrow("runtime_transition_failure_receipt_mismatch");
  });
});
