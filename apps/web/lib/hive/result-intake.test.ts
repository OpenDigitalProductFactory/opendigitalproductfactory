import { describe, expect, it } from "vitest";

import { normalizeHiveResultIntake, resolveHiveDeliveryAttempt } from "./result-intake";

const validBundle = {
  schemaVersion: "dpf.hive-result/1",
  result: { commit: "abc123", patchDigest: "sha256:result" },
  evidence: { tests: "passed", dco: true },
  provenance: { contributor: "partner-pseudonym" },
  attribution: { mode: "pseudonymous" },
  review: { requested: true },
  disposition: { recommendation: "review" },
  sourceReceipt: "receipt_opaque_123",
};

describe("Hive result intake", () => {
  it("accepts only the result/evidence/provenance allow-list", () => {
    const result = normalizeHiveResultIntake(validBundle);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payloadHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.projected).toEqual(validBundle);
    }
  });

  it.each([
    ["top-level backlog", { ...validBundle, backlogItem: { itemId: "BI-SECRET" } }],
    ["nested work capsule", { ...validBundle, result: { patch: "ok", workCapsule: "WC-SECRET" } }],
    ["private planning", { ...validBundle, evidence: { tests: "passed", discussion: "private" } }],
    ["dereferenceable receipt", { ...validBundle, sourceReceipt: "BI-1234" }],
  ])("rejects %s before persistence", (_label, payload) => {
    const result = normalizeHiveResultIntake(payload);
    expect(result.ok).toBe(false);
  });

  it("keeps GitHub failure separate from durable intake and supports retry", () => {
    expect(resolveHiveDeliveryAttempt({ ok: false, error: "GitHub unavailable", attempts: 0 })).toMatchObject({
      status: "retry",
      attempts: 1,
      lastError: "GitHub unavailable",
    });
    expect(resolveHiveDeliveryAttempt({ ok: true, remoteRef: "github:pr:42", attempts: 1 })).toEqual({
      status: "delivered",
      attempts: 2,
      remoteRef: "github:pr:42",
      lastError: null,
      nextAttemptAt: null,
    });
  });

  it("rejects oversized result bundles before persistence or forge delivery", () => {
    const result = normalizeHiveResultIntake({ ...validBundle, result: { patch: "x".repeat(50 * 1024) } });
    expect(result).toEqual({ ok: false, violations: ["payload:too-large"] });
  });
});
