// EP-MSP-FEDERATION — read this installation's organization trust anchor.
//
// `evaluateOrganizationEnrollment` and `decideAutomaticPairing` both need to know
// which organization root this installation pins, and which organization it
// belongs to. That fact is already established when an operator imports a join
// package: `organization.join.import` records the encrypted package and an
// evidence blob carrying a TRUNCATED root fingerprint prefix.
//
// The truncation matters. Comparing prefixes would be a real weakness — a
// 12-character prefix is not an identity — so this module decrypts the stored
// package and parses the FULL fingerprint. An installation whose package cannot
// be decrypted or parsed has no anchor, which routes every pairing back to a
// human rather than trusting a partial match.

import type { OrganizationTrustAnchor } from "@dpf/db/organization-federation-enrollment";
import { parseOrganizationJoinPackage } from "@dpf/db/organization-join-action";

/** The join-import record this resolver reads, narrowed to what it needs. */
export interface JoinImportRecord {
  parameters: unknown;
  completedAt: Date | null;
  createdAt: Date;
}

export interface OrganizationTrustAnchorStore {
  /**
   * The most recent COMPLETED `organization.join.import` action, newest first.
   * A queued or failed import has not established trust and must not be read as
   * though it had.
   */
  findLatestCompletedJoinImport(): Promise<JoinImportRecord | null>;
  /** The organization this installation operates for, or null when unset. */
  findLocalOrganizationRef(): Promise<string | null>;
}

/** Why no usable anchor could be resolved. Closed so callers can branch. */
export const TRUST_ANCHOR_ABSENCE_REASONS = [
  "no-join-import",
  "package-not-decryptable",
  "package-unparseable",
  "package-expired",
  "no-local-organization",
] as const;
export type TrustAnchorAbsenceReason = (typeof TRUST_ANCHOR_ABSENCE_REASONS)[number];

export type TrustAnchorResolution =
  | { anchor: OrganizationTrustAnchor; established: true }
  | { anchor: OrganizationTrustAnchor; established: false; reason: TrustAnchorAbsenceReason };

/** The anchor an installation has when nothing establishes one. */
const NO_ANCHOR: OrganizationTrustAnchor = { rootFingerprint: null, organizationRef: null };

function absent(reason: TrustAnchorAbsenceReason): TrustAnchorResolution {
  return { anchor: NO_ANCHOR, established: false, reason };
}

function storedPackage(parameters: unknown): string | null {
  if (typeof parameters !== "object" || parameters === null) return null;
  const value = (parameters as Record<string, unknown>)["joinPackageEnc"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Resolve the organization trust anchor for this installation.
 *
 * Fails closed to "no anchor" on every unreadable path. That default is what
 * keeps `evaluateOrganizationEnrollment` honest: without an anchor it returns
 * `organization-trust-not-configured`, so a decrypt failure costs a human
 * confirmation rather than silently widening trust.
 *
 * `decrypt` is injected so this module never imports the credential store, and
 * so a decrypt failure is a value rather than a thrown error.
 */
export async function resolveOrganizationTrustAnchor(
  store: OrganizationTrustAnchorStore,
  options: {
    decrypt: (stored: string) => string | null;
    now?: Date;
  },
): Promise<TrustAnchorResolution> {
  const now = options.now ?? new Date();

  let record: JoinImportRecord | null = null;
  try {
    record = await store.findLatestCompletedJoinImport();
  } catch {
    return absent("no-join-import");
  }
  if (!record) return absent("no-join-import");

  const stored = storedPackage(record.parameters);
  if (!stored) return absent("package-not-decryptable");

  let plaintext: string | null = null;
  try {
    plaintext = options.decrypt(stored);
  } catch {
    plaintext = null;
  }
  if (!plaintext) return absent("package-not-decryptable");

  // Parsed with the SAME parser the import path used, so a package that would be
  // rejected on import cannot be accepted here. The parser owns expiry, so its
  // verdict is surfaced rather than re-checked — a second check here could only
  // ever disagree with the authority.
  const parsed = parseOrganizationJoinPackage(plaintext, now);
  if (!parsed.ok) {
    return absent(parsed.reason === "join-package-expired" ? "package-expired" : "package-unparseable");
  }

  let organizationRef: string | null = null;
  try {
    organizationRef = await store.findLocalOrganizationRef();
  } catch {
    organizationRef = null;
  }
  if (!organizationRef) return absent("no-local-organization");

  return {
    established: true,
    anchor: {
      // The FULL fingerprint from the package, never the truncated evidence prefix.
      rootFingerprint: parsed.value.rootFingerprint,
      organizationRef,
    },
  };
}
