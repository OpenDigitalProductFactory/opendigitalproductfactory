// EP-SOVEREIGN-SOC P0 — OCSF constants + the pinned implementation version.
//
// Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md §3, §8.
// Kernel decision §8: version-pinned-ocsf. We pin ONE implementation version
// here and stamp it on every SecurityEvent (`ocsfVersion`) so schema evolution
// is explicit; bumping the pin is a deliberate, fixture-guarded change, never a
// silent drift. Codex's 2026-06-25 review found v1.8.0 to be current stable.
//
// Only the subset of the OCSF taxonomy the reference normalizers use is encoded
// here; the registry grows as sources are added. Unknown classes route to the
// normalization-gap queue (spec §10.4), they do not get invented here.

/** Pinned OCSF schema version stamped on every normalized event. */
export const OCSF_VERSION = "1.8.0";

/** OCSF class_uid values used by the reference normalizers. */
export const OCSF_CLASS = {
  /** System Activity → Process Activity. */
  PROCESS_ACTIVITY: 1007,
  /** Findings → Security Finding. */
  SECURITY_FINDING: 2001,
  /** Identity & Access Management → Authentication. */
  AUTHENTICATION: 3002,
  /** Application Activity → API Activity. */
  API_ACTIVITY: 6003,
} as const;
export type OcsfClassUid = (typeof OCSF_CLASS)[keyof typeof OCSF_CLASS];

/** OCSF category_uid values. */
export const OCSF_CATEGORY = {
  SYSTEM_ACTIVITY: 1,
  FINDINGS: 2,
  IAM: 3,
  APPLICATION_ACTIVITY: 6,
} as const;

/** OCSF activity_id values used by the reference normalizers. */
export const OCSF_ACTIVITY = {
  // Authentication
  LOGON: 1,
  LOGOFF: 2,
  // Process Activity
  PROCESS_LAUNCH: 1,
  // API Activity (CRUD)
  API_CREATE: 1,
  API_READ: 2,
  API_UPDATE: 3,
  API_DELETE: 4,
  UNKNOWN: 0,
} as const;

/** OCSF severity_id (0..6). */
export const OCSF_SEVERITY = {
  UNKNOWN: 0,
  INFORMATIONAL: 1,
  LOW: 2,
  MEDIUM: 3,
  HIGH: 4,
  CRITICAL: 5,
  FATAL: 6,
} as const;
export type OcsfSeverityId = (typeof OCSF_SEVERITY)[keyof typeof OCSF_SEVERITY];

/**
 * Map an RFC 5424 syslog severity (0 Emergency … 7 Debug) onto OCSF severity_id.
 * Syslog runs high→low (0 worst); OCSF runs low→high (6 worst), so the scales
 * are inverted, not just offset.
 */
export function syslogSeverityToOcsf(syslogSeverity: number): OcsfSeverityId {
  switch (syslogSeverity) {
    case 0: // Emergency
    case 1: // Alert
      return OCSF_SEVERITY.FATAL;
    case 2: // Critical
      return OCSF_SEVERITY.CRITICAL;
    case 3: // Error
      return OCSF_SEVERITY.HIGH;
    case 4: // Warning
      return OCSF_SEVERITY.MEDIUM;
    case 5: // Notice
      return OCSF_SEVERITY.LOW;
    case 6: // Informational
    case 7: // Debug
      return OCSF_SEVERITY.INFORMATIONAL;
    default:
      return OCSF_SEVERITY.UNKNOWN;
  }
}

/**
 * Map an ArcSight CEF severity (0..10) onto OCSF severity_id. CEF and OCSF both
 * run low→high, so this is a banding, not an inversion.
 */
export function cefSeverityToOcsf(cefSeverity: number): OcsfSeverityId {
  if (cefSeverity >= 9) return OCSF_SEVERITY.CRITICAL;
  if (cefSeverity >= 7) return OCSF_SEVERITY.HIGH;
  if (cefSeverity >= 4) return OCSF_SEVERITY.MEDIUM;
  if (cefSeverity >= 1) return OCSF_SEVERITY.LOW;
  return OCSF_SEVERITY.INFORMATIONAL;
}
