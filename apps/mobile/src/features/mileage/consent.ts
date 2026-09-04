/**
 * Consent gate for background location capture (BI-6D98AD8A).
 *
 * Continuously tracking where an employee drives is the most consequential thing
 * this feature does, so the gate is a hard precondition rather than a setting:
 * capture may not start, and a fix may not be retained, unless this module says
 * yes. It is pure so the rule is testable and so the same decision can be made
 * on the server before a Trip row is written.
 *
 * Two properties are deliberate:
 *   • consent is pinned to a POLICY VERSION. Changing what we disclose
 *     invalidates the old grant instead of silently inheriting it.
 *   • revocation stops capture immediately but does NOT erase history. The
 *     consent record is the lawful-basis evidence for trips already captured.
 */

export type ConsentStatus = "pending" | "granted" | "revoked" | "expired";

export interface DriverConsent {
  consentStatus: ConsentStatus;
  /** The disclosure version the driver actually agreed to. */
  policyVersion: string;
  grantedAt: Date | null;
  revokedAt: Date | null;
  /** How long captured geometry may be kept. */
  retentionDays: number;
}

export type CaptureDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "no-consent" | "revoked" | "expired" | "policy-superseded" | "os-permission-denied";
    };

export interface CaptureContext {
  consent: DriverConsent | null;
  /** The disclosure version the app is currently running. */
  currentPolicyVersion: string;
  /** Whether the OS has actually granted background location. */
  osBackgroundPermission: "granted" | "denied" | "unknown";
}

/**
 * May the app capture a location fix right now?
 *
 * Both gates must pass: the driver's recorded consent AND the operating
 * system's own permission. A granted consent record with a denied OS permission
 * is not capture authority — it is a prompt to fix the setting.
 */
export function mayCapture(context: CaptureContext): CaptureDecision {
  const { consent, currentPolicyVersion, osBackgroundPermission } = context;

  if (!consent || consent.consentStatus === "pending") {
    return { allowed: false, reason: "no-consent" };
  }
  if (consent.consentStatus === "revoked") {
    return { allowed: false, reason: "revoked" };
  }
  if (consent.consentStatus === "expired") {
    return { allowed: false, reason: "expired" };
  }
  if (consent.policyVersion !== currentPolicyVersion) {
    // The driver agreed to a different disclosure than the one now in force.
    return { allowed: false, reason: "policy-superseded" };
  }
  if (osBackgroundPermission !== "granted") {
    return { allowed: false, reason: "os-permission-denied" };
  }
  return { allowed: true };
}

/**
 * The date before which captured geometry must have been minimised, given the
 * driver's retention window. Returns null when there is no granted consent to
 * measure from.
 */
export function geometryRetentionCutoff(consent: DriverConsent | null, now: Date): Date | null {
  if (!consent || consent.grantedAt === null) return null;
  return new Date(now.getTime() - consent.retentionDays * 24 * 60 * 60_000);
}

/**
 * What a revoked driver keeps. Revocation stops future capture; already-captured
 * trips stay as the evidence behind reimbursements already claimed, and the
 * consent record itself is retained so the lawful basis remains auditable.
 */
export function revocationEffect(consent: DriverConsent): {
  stopsFutureCapture: boolean;
  deletesExistingTrips: boolean;
  retainsConsentRecord: boolean;
} {
  return {
    stopsFutureCapture: consent.consentStatus === "revoked",
    deletesExistingTrips: false,
    retainsConsentRecord: true,
  };
}
