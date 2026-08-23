import { describe, expect, it } from "@jest/globals";
import {
  geometryRetentionCutoff,
  mayCapture,
  revocationEffect,
  type CaptureContext,
  type DriverConsent,
} from "./consent";

const POLICY = "2026-08-01";

function consent(over: Partial<DriverConsent> = {}): DriverConsent {
  return {
    consentStatus: "granted",
    policyVersion: POLICY,
    grantedAt: new Date("2026-08-01T00:00:00.000Z"),
    revokedAt: null,
    retentionDays: 365,
    ...over,
  };
}

function context(over: Partial<CaptureContext> = {}): CaptureContext {
  return {
    consent: consent(),
    currentPolicyVersion: POLICY,
    osBackgroundPermission: "granted",
    ...over,
  };
}

describe("mayCapture", () => {
  it("allows capture when consent and OS permission both hold", () => {
    expect(mayCapture(context())).toEqual({ allowed: true });
  });

  it("refuses capture with no consent record at all", () => {
    expect(mayCapture(context({ consent: null }))).toEqual({
      allowed: false,
      reason: "no-consent",
    });
  });

  it("refuses capture while consent is merely pending", () => {
    expect(mayCapture(context({ consent: consent({ consentStatus: "pending" }) }))).toEqual({
      allowed: false,
      reason: "no-consent",
    });
  });

  it("stops capture the moment consent is revoked", () => {
    expect(
      mayCapture(context({ consent: consent({ consentStatus: "revoked", revokedAt: new Date() }) })),
    ).toEqual({ allowed: false, reason: "revoked" });
  });

  it("refuses capture when the disclosure has changed under the driver", () => {
    // Consent is pinned to what was actually disclosed; a new policy needs a
    // fresh grant rather than silently inheriting the old one.
    expect(mayCapture(context({ currentPolicyVersion: "2026-09-01" }))).toEqual({
      allowed: false,
      reason: "policy-superseded",
    });
  });

  it("does not treat a consent record as capture authority when the OS says no", () => {
    expect(mayCapture(context({ osBackgroundPermission: "denied" }))).toEqual({
      allowed: false,
      reason: "os-permission-denied",
    });
  });

  it("refuses on an unknown OS permission rather than assuming granted", () => {
    expect(mayCapture(context({ osBackgroundPermission: "unknown" }))).toEqual({
      allowed: false,
      reason: "os-permission-denied",
    });
  });
});

describe("geometryRetentionCutoff", () => {
  it("derives the cutoff from the driver's own retention window", () => {
    const now = new Date("2026-08-22T00:00:00.000Z");
    const cutoff = geometryRetentionCutoff(consent({ retentionDays: 30 }), now);
    expect(cutoff?.toISOString()).toBe("2026-07-23T00:00:00.000Z");
  });

  it("has no cutoff without a granted consent to measure from", () => {
    expect(geometryRetentionCutoff(null, new Date())).toBeNull();
    expect(geometryRetentionCutoff(consent({ grantedAt: null }), new Date())).toBeNull();
  });
});

describe("revocationEffect", () => {
  it("stops future capture without deleting captured trips or the consent record", () => {
    const effect = revocationEffect(consent({ consentStatus: "revoked" }));
    expect(effect.stopsFutureCapture).toBe(true);
    // Trips already claimed are accounting evidence; the consent record is the
    // lawful basis for having captured them.
    expect(effect.deletesExistingTrips).toBe(false);
    expect(effect.retainsConsentRecord).toBe(true);
  });
});
