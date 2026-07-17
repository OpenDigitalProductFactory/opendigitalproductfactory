import { describe, expect, it } from "vitest";

import {
  createCoworkerDelegationReceipt,
  verifyCoworkerDelegationReceipt,
} from "./delegation-receipt";

describe("coworker delegation receipts", () => {
  it("signs the acting, delegating, and delegated agent chain", () => {
    const receipt = createCoworkerDelegationReceipt(
      {
        protocol: "a2a",
        accessProfile: "external-a2a",
        offerId: "offer-sales",
        serviceId: "svc-sales",
        actingAgentGaid: "gaid:public:buyer",
        delegatingAgentGaid: "gaid:public:buyer",
        delegatedAgentId: "sales-coworker",
        delegatedAgentGaid: "gaid:public:sales",
        requestedOutcome: "Qualify this buyer.",
        authorityBoundary: "proposal-only",
        riskTier: "medium",
        requiredGrants: ["registry_read"],
        contractContext: {
          termsRef: "terms://sales",
          dataBoundaryRef: "boundary://sales",
        },
      },
      {
        issuedAt: new Date("2026-07-16T12:00:00.000Z"),
        secret: "test-secret",
        keyId: "test-key",
      },
    );

    expect(receipt).toMatchObject({
      receiptKind: "coworker-delegation",
      protocol: "a2a",
      accessProfile: "external-a2a",
      actingAgentGaid: "gaid:public:buyer",
      delegatingAgentGaid: "gaid:public:buyer",
      delegatedAgentId: "sales-coworker",
      delegatedAgentGaid: "gaid:public:sales",
      signature: {
        alg: "HMAC-SHA256",
        keyId: "test-key",
      },
    });
    expect(receipt.receiptId).toMatch(/^CDR-[A-F0-9]{16}$/);
    expect(receipt.signature.value).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyCoworkerDelegationReceipt(receipt, { secret: "test-secret" })).toEqual({ ok: true });
  });

  it("detects a changed delegated agent after signing", () => {
    const receipt = createCoworkerDelegationReceipt(
      {
        protocol: "a2a",
        accessProfile: "external-a2a",
        offerId: "offer-sales",
        serviceId: "svc-sales",
        actingAgentGaid: "gaid:public:buyer",
        delegatingAgentGaid: "gaid:public:buyer",
        delegatedAgentId: "sales-coworker",
        delegatedAgentGaid: "gaid:public:sales",
        requestedOutcome: "Qualify this buyer.",
        authorityBoundary: "proposal-only",
        riskTier: "medium",
        requiredGrants: ["registry_read"],
        contractContext: {
          termsRef: "terms://sales",
          dataBoundaryRef: "boundary://sales",
        },
      },
      {
        issuedAt: new Date("2026-07-16T12:00:00.000Z"),
        secret: "test-secret",
        keyId: "test-key",
      },
    );

    const tampered = { ...receipt, delegatedAgentId: "other-coworker" };

    expect(verifyCoworkerDelegationReceipt(tampered, { secret: "test-secret" })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });
});
