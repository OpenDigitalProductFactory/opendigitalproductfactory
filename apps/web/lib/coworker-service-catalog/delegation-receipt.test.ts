import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  canSignDelegationReceipts,
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

describe("canonicalisation is host-independent (BI-2F318FB3)", () => {
  const base = {
    protocol: "a2a" as const,
    accessProfile: "internal-a2a" as const,
    offerId: "offer-1",
    serviceId: "service-1",
    actingAgentGaid: "gaid-acting",
    delegatingAgentGaid: "gaid-delegating",
    delegatedAgentId: "coworker-1",
    delegatedAgentGaid: "gaid-delegated",
    requestedOutcome: "do the thing",
    authorityBoundary: "bounded",
    riskTier: "low",
  };

  it("signs identically regardless of the host locale", () => {
    // The old canonicaliser sorted keys with `localeCompare`, which resolves
    // against the host's default locale and ICU data. A receipt signed on one
    // machine could then fail verification on another — and the failure looks
    // exactly like tampering, which is the worst possible way for a trust
    // primitive to break.
    const original = String.prototype.localeCompare;
    const issuedAt = new Date("2026-08-04T00:00:00.000Z");

    const underDefaultLocale = createCoworkerDelegationReceipt(base, {
      issuedAt,
      secret: "test-secret",
      keyId: "k",
    });

    // Simulate a host whose collation orders differently. If canonicalisation
    // still consulted the locale, this would change the signature.
    // eslint-disable-next-line no-extend-native
    String.prototype.localeCompare = function reversed(this: string, other: string) {
      return other < this ? -1 : other > this ? 1 : 0;
    } as typeof String.prototype.localeCompare;
    try {
      const underOtherLocale = createCoworkerDelegationReceipt(base, {
        issuedAt,
        secret: "test-secret",
        keyId: "k",
      });
      expect(underOtherLocale.signature.value).toBe(underDefaultLocale.signature.value);
    } finally {
      // eslint-disable-next-line no-extend-native
      String.prototype.localeCompare = original;
    }
  });

  it("still verifies a receipt it just issued", () => {
    const receipt = createCoworkerDelegationReceipt(base, { secret: "test-secret", keyId: "k" });
    expect(verifyCoworkerDelegationReceipt(receipt, { secret: "test-secret" })).toEqual({ ok: true });
  });
});

describe("signing secret must be configured (BI-2F318FB3)", () => {
  const saved = {
    receipt: process.env.DPF_DELEGATION_RECEIPT_SECRET,
    auth: process.env.AUTH_SECRET,
    nextAuth: process.env.NEXTAUTH_SECRET,
  };

  beforeEach(() => {
    delete process.env.DPF_DELEGATION_RECEIPT_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
  });

  afterEach(() => {
    if (saved.receipt === undefined) delete process.env.DPF_DELEGATION_RECEIPT_SECRET;
    else process.env.DPF_DELEGATION_RECEIPT_SECRET = saved.receipt;
    if (saved.auth === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved.auth;
    if (saved.nextAuth === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = saved.nextAuth;
  });

  it("throws rather than signing with a constant anyone can read in this repository", () => {
    expect(() =>
      createCoworkerDelegationReceipt(
        {
          protocol: "a2a",
          accessProfile: "internal-a2a",
          offerId: "o",
          serviceId: "s",
          actingAgentGaid: "a",
          delegatingAgentGaid: "d",
          delegatedAgentId: "c",
          delegatedAgentGaid: "g",
          requestedOutcome: "x",
          authorityBoundary: "b",
          riskTier: "low",
        },
        {},
      ),
    ).toThrow(/signing secret/i);
  });
});

describe("canSignDelegationReceipts (BI-2F318FB3)", () => {
  const saved = {
    receipt: process.env.DPF_DELEGATION_RECEIPT_SECRET,
    auth: process.env.AUTH_SECRET,
    nextAuth: process.env.NEXTAUTH_SECRET,
  };

  afterEach(() => {
    if (saved.receipt === undefined) delete process.env.DPF_DELEGATION_RECEIPT_SECRET;
    else process.env.DPF_DELEGATION_RECEIPT_SECRET = saved.receipt;
    if (saved.auth === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved.auth;
    if (saved.nextAuth === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = saved.nextAuth;
  });

  it("reports false when nothing is configured, so callers can decide explicitly", () => {
    // Exposed as a predicate rather than left as an exception: A2A task creation
    // omits the receipt instead of either emitting an untrustworthy one or
    // failing the whole task.
    delete process.env.DPF_DELEGATION_RECEIPT_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    expect(canSignDelegationReceipts()).toBe(false);
  });

  it("reports true once any accepted source is set", () => {
    delete process.env.DPF_DELEGATION_RECEIPT_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    process.env.AUTH_SECRET = "configured";
    expect(canSignDelegationReceipts()).toBe(true);
  });
});
