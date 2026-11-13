import { describe, expect, it } from "vitest";

import { normalizeHiveResultIntake, resolveHiveDeliveryAttempt } from "@dpf/validators/commons/node";

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

  it("holds cyclic, accessor and non-JSON input before traversal without invoking getters", () => {
    const cycle: Record<string, unknown> = { ...validBundle }; cycle.result = cycle;
    let reads = 0;
    const accessor = { ...validBundle, get result() { reads++; return { patch: "secret" }; } };
    for (const payload of [cycle, accessor, { ...validBundle, result: new Date() }, { ...validBundle, result: { n: NaN } }]) {
      expect(normalizeHiveResultIntake(payload)).toEqual({ ok: false, violations: ["payload:not-bounded-json"] });
    }
    expect(reads).toBe(0);
  });
  it("preserves issued numeric-key and UTF-8 payload hash bytes", () => {
    expect(normalizeHiveResultIntake({ schemaVersion: "dpf.hive-result/1", result: { "2": "two", "10": "ten", label: "café" }, sourceReceipt: "opaque_fixture_42" })).toMatchObject({ ok: true, payloadHash: "sha256:eea7a002125395f2830b099bb2295f10ffbce9f008648cb42f1bb3cd0b6474d7" });
  });
  it("preserves issued projection hash bytes for nested prototype-named JSON keys", () => {
    const payload = JSON.parse('{"schemaVersion":"dpf.hive-result/1","result":{"patch":"synthetic","__proto__":{"old":"ignored"}},"sourceReceipt":"proto_receipt_42"}');
    const result = normalizeHiveResultIntake(payload);
    expect(result).toMatchObject({ ok: true, projected: { result: { patch: "synthetic" } }, payloadHash: "sha256:6b3450e8945d5429fdc693ed1345af80e5556b65035f92e5df37cfead279f421" });
    if (result.ok) {
      expect(Object.hasOwn(result.projected.result as object, "__proto__")).toBe(false);
      expect(Object.getPrototypeOf(result.projected.result)).toBe(Object.prototype);
    }
  });
});
