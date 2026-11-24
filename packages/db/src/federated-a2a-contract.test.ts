import { describe, expect, it } from "vitest";

import {
  A2A_REQUEST_ACTIVITIES,
  a2aRequestDigest,
  a2aRequestSigningPayload,
  validateA2aRequestV1,
  type A2aRequestV1,
} from "./federated-a2a-contract";

function request(overrides: Partial<A2aRequestV1> = {}): A2aRequestV1 {
  return {
    specVersion: "dpf.a2a-request/1",
    requestId: "a2r_01JZ0000000000000000000000",
    operation: "task.submitted",
    createdAt: "2026-11-14T00:00:00.000Z",
    notAfter: "2026-11-17T00:00:00.000Z", // clock-bomb-guard: allow shape-only fixture; nothing compares it to the wall clock
    sourceInstallationDid: `did_${"a".repeat(64)}`,
    sourceSigningPublicKey: "MCowBQYDK2VwAyEA",
    targetInstallationDid: `did_${"b".repeat(64)}`,
    organizationRef: "org-1",
    requesterEnvironmentClass: "production",
    senderTaskId: "TR-local-1",
    contextId: "ctx-1",
    provenance: { actingAgentGaid: "gaid:priv:dpf.internal:agt-a", delegatingAgentGaid: null },
    payload: { offerId: "offer-1", requestedOutcome: "Check the build." },
    signature: "h.p.s",
    ...overrides,
  };
}

describe("federated A2A request contract (BI-B45BBD8A)", () => {
  it("declares the request activities the ingress accepts", () => {
    expect(A2A_REQUEST_ACTIVITIES).toContain("dpf.a2a.task.submitted.v1");
  });

  it("accepts a complete request", () => {
    expect(validateA2aRequestV1(request())).toEqual([]);
  });

  it("names each malformed field", () => {
    const violations = validateA2aRequestV1({
      ...request(),
      requestId: "",
      operation: "drop-tables",
      notAfter: "not-a-date",
      sourceInstallationDid: "did_short",
      payload: [],
      signature: "only-one-part",
    });
    expect(violations).toEqual(expect.arrayContaining([
      "requestId:invalid",
      "operation:unsupported",
      "notAfter:invalid",
      "sourceInstallationDid:invalid",
      "payload:invalid",
      "signature:invalid",
    ]));
  });

  it("refuses notAfter before createdAt", () => {
    expect(validateA2aRequestV1(request({ notAfter: "2026-11-13T00:00:00.000Z" }))).toContain("notAfter:before-createdAt"); // clock-bomb-guard: allow compared only to createdAt, never to the wall clock
  });

  it("refuses an oversized payload", () => {
    expect(validateA2aRequestV1(request({ payload: { blob: "x".repeat(70 * 1024) } }))).toContain("payload:too-large");
  });

  it("signs everything except the signature, canonically", () => {
    const a = request();
    const b = { ...request(), payload: { requestedOutcome: "Check the build.", offerId: "offer-1" }, signature: "other" };
    expect(a2aRequestSigningPayload(a)).toBe(a2aRequestSigningPayload(b));
    expect(a2aRequestSigningPayload(a)).not.toContain("h.p.s");
    expect(a2aRequestSigningPayload(request({ payload: { offerId: "offer-2" } }))).not.toBe(a2aRequestSigningPayload(a));
  });

  it("digests the signed content so a reused requestId with changed content is detectable", () => {
    expect(a2aRequestDigest(request())).toBe(a2aRequestDigest(request({ signature: "x.y.z" })));
    expect(a2aRequestDigest(request({ payload: { offerId: "offer-2" } }))).not.toBe(a2aRequestDigest(request()));
  });
});
