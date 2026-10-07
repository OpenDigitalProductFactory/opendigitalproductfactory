import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_SECRET_GRACE_CUTOFF } from "@/lib/auth/dedicated-signing-key";

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
    expect(verifyCoworkerDelegationReceipt(receipt, { secret: "test-secret" })).toEqual({ ok: true, verifiedWith: "explicit" });
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
    expect(verifyCoworkerDelegationReceipt(receipt, { secret: "test-secret" })).toEqual({ ok: true, verifiedWith: "explicit" });
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

describe("dedicated key with a bounded AUTH_SECRET grace window (BI-F6929F50)", () => {
  const DEDICATED = "fixture-dedicated-receipt-key";
  const SESSION = "fixture-session-secret";
  const BEFORE_CUTOFF = new Date(SESSION_SECRET_GRACE_CUTOFF.getTime() - 24 * 60 * 60 * 1000);
  const AFTER_CUTOFF = new Date(SESSION_SECRET_GRACE_CUTOFF.getTime() + 1);
  const input = {
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
  const saved = {
    receipt: process.env.DPF_DELEGATION_RECEIPT_SECRET,
    auth: process.env.AUTH_SECRET,
    nextAuth: process.env.NEXTAUTH_SECRET,
  };

  beforeEach(() => {
    process.env.DPF_DELEGATION_RECEIPT_SECRET = DEDICATED;
    process.env.AUTH_SECRET = SESSION;
    delete process.env.NEXTAUTH_SECRET;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (saved.receipt === undefined) delete process.env.DPF_DELEGATION_RECEIPT_SECRET;
    else process.env.DPF_DELEGATION_RECEIPT_SECRET = saved.receipt;
    if (saved.auth === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved.auth;
    if (saved.nextAuth === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = saved.nextAuth;
  });

  it("signs new receipts with the dedicated key, not the session secret", () => {
    const receipt = createCoworkerDelegationReceipt(input, { issuedAt: AFTER_CUTOFF });
    const dedicated = createCoworkerDelegationReceipt(input, { issuedAt: AFTER_CUTOFF, secret: DEDICATED });
    const session = createCoworkerDelegationReceipt(input, { issuedAt: AFTER_CUTOFF, secret: SESSION });
    expect(receipt.signature.value).toBe(dedicated.signature.value);
    expect(receipt.signature.value).not.toBe(session.signature.value);
    expect(verifyCoworkerDelegationReceipt(receipt, { now: AFTER_CUTOFF })).toEqual({ ok: true, verifiedWith: "dedicated" });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("accepts a pre-upgrade AUTH_SECRET-signed receipt inside the window and records that the fallback was used", () => {
    const legacy = createCoworkerDelegationReceipt(input, { issuedAt: BEFORE_CUTOFF, secret: SESSION });
    expect(verifyCoworkerDelegationReceipt(legacy, { now: BEFORE_CUTOFF })).toEqual({
      ok: true,
      verifiedWith: "session-secret-grace",
    });
    expect(console.warn).toHaveBeenCalledTimes(1);
    const logged = String(vi.mocked(console.warn).mock.calls[0]?.[0]);
    expect(logged).toMatch(/grace fallback/);
    expect(logged).not.toContain(SESSION);
    expect(logged).not.toContain(legacy.signature.value);
  });

  it("refuses the same AUTH_SECRET-signed receipt after the cutoff", () => {
    const legacy = createCoworkerDelegationReceipt(input, { issuedAt: BEFORE_CUTOFF, secret: SESSION });
    expect(verifyCoworkerDelegationReceipt(legacy, { now: AFTER_CUTOFF })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("refuses an AUTH_SECRET-signed receipt dated after the moment it is verified", () => {
    const future = createCoworkerDelegationReceipt(input, {
      issuedAt: new Date(BEFORE_CUTOFF.getTime() + 60_000),
      secret: SESSION,
    });
    expect(verifyCoworkerDelegationReceipt(future, { now: BEFORE_CUTOFF })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("keeps today's behaviour when the dedicated key is unset or blank", () => {
    for (const unset of [undefined, "", "   "]) {
      if (unset === undefined) delete process.env.DPF_DELEGATION_RECEIPT_SECRET;
      else process.env.DPF_DELEGATION_RECEIPT_SECRET = unset;
      expect(canSignDelegationReceipts()).toBe(true);
      const receipt = createCoworkerDelegationReceipt(input, { issuedAt: AFTER_CUTOFF });
      const session = createCoworkerDelegationReceipt(input, { issuedAt: AFTER_CUTOFF, secret: SESSION });
      expect(receipt.signature.value).toBe(session.signature.value);
      // No window applies: the session secret is the install's only key.
      expect(verifyCoworkerDelegationReceipt(receipt, { now: AFTER_CUTOFF })).toEqual({
        ok: true,
        verifiedWith: "session-secret",
      });
    }
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["dedicated key set, inside the window", "set", BEFORE_CUTOFF],
    ["dedicated key set, after the window", "set", AFTER_CUTOFF],
    ["dedicated key unset", "unset", BEFORE_CUTOFF],
  ])("refuses a forged receipt (%s)", (_label, mode, now) => {
    if (mode === "unset") delete process.env.DPF_DELEGATION_RECEIPT_SECRET;
    const forged = createCoworkerDelegationReceipt(input, { issuedAt: now, secret: "fixture-attacker-key" });
    expect(verifyCoworkerDelegationReceipt(forged, { now })).toEqual({ ok: false, reason: "signature_mismatch" });
    const valid = createCoworkerDelegationReceipt(input, { issuedAt: now });
    const tampered = { ...valid, delegatedAgentId: "other-coworker" };
    expect(verifyCoworkerDelegationReceipt(tampered, { now })).toEqual({ ok: false, reason: "signature_mismatch" });
  });
});
