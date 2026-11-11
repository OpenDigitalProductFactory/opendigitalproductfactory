// Guidance snapshot signing and verification (BI-1B165D02, companion design §4.1).
//
// The authority signs with its installation's long-lived Ed25519 key, the key
// whose fingerprint is its DID. A companion verifies against the DID recorded on
// its trusted link to that authority, so the public key the snapshot carries is
// only accepted when it hashes to that DID: no new key distribution is needed.
//
// The signature is a compact JWS (RFC 7515, alg EdDSA per RFC 8037) whose payload
// is the meta plus the manifest of content hashes (OPA bundle model).

import {
  GUIDANCE_SNAPSHOT_LIFETIME_MS,
  computeGuidanceSnapshotManifest,
  guidanceSnapshotSigningPayload,
  judgeGuidanceSnapshotFreshness,
  validateGuidanceSnapshotV1,
  type GuidanceSnapshotV1,
  type GuidanceWwwdV1,
} from "@dpf/db/guidance-snapshot-contract";

import {
  deriveDeviceId,
  signIdentityStatement,
  verifyIdentityStatement,
  type InstanceSigningKeypair,
} from "./instance-identity";

const JWS_TYPE = "dpf-guidance-snapshot+jws";

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

export function issueGuidanceSnapshot(input: {
  authority: InstanceSigningKeypair;
  companionInstallationDid: string;
  wwwd: GuidanceWwwdV1;
  version: number;
  now: Date;
  lifetimeMs?: number;
}): GuidanceSnapshotV1 {
  const authorityInstallationDid = deriveDeviceId(input.authority.signingPublicKey);
  const meta = {
    authorityInstallationDid,
    authoritySigningPublicKey: input.authority.signingPublicKey,
    companionInstallationDid: input.companionInstallationDid,
    version: input.version,
    issuedAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + (input.lifetimeMs ?? GUIDANCE_SNAPSHOT_LIFETIME_MS)).toISOString(),
  };
  const manifest = computeGuidanceSnapshotManifest(input.wwwd);
  const signingInput = `${b64url(JSON.stringify({ alg: "EdDSA", typ: JWS_TYPE, kid: authorityInstallationDid }))}.${
    b64url(guidanceSnapshotSigningPayload({ meta, manifest }))}`;
  const signature = Buffer.from(signIdentityStatement(input.authority.signingPrivateKey, signingInput), "base64")
    .toString("base64url");
  return {
    specVersion: "dpf.guidance-snapshot/1",
    meta,
    wwwd: input.wwwd,
    manifest,
    signature: `${signingInput}.${signature}`,
  };
}

export type GuidanceSnapshotRefusal =
  | "malformed"
  | "authority-mismatch"
  | "bad-signature"
  | "not-for-this-installation"
  | "expired"
  | "version-not-advancing";

export type GuidanceSnapshotVerification =
  | { ok: true; snapshot: GuidanceSnapshotV1 }
  | { ok: false; reason: GuidanceSnapshotRefusal; violations?: string[] };

function signatureVerifies(snapshot: GuidanceSnapshotV1): boolean {
  const [header, payload, signature] = snapshot.signature.split(".");
  if (!header || !payload || !signature) return false;
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as Record<string, unknown>;
    if (parsed.alg !== "EdDSA" || parsed.typ !== JWS_TYPE || parsed.kid !== snapshot.meta.authorityInstallationDid) {
      return false;
    }
  } catch {
    return false;
  }
  // The signed payload must be exactly this record's meta and manifest, so
  // neither can be swapped under a valid signature.
  if (Buffer.from(payload, "base64url").toString("utf8") !== guidanceSnapshotSigningPayload(snapshot)) return false;
  return verifyIdentityStatement(
    snapshot.meta.authoritySigningPublicKey,
    `${header}.${payload}`,
    Buffer.from(signature, "base64url").toString("base64"),
  );
}

/**
 * Verify a received snapshot for this installation. Any refusal leaves the
 * caller's held snapshot in force (AC-PAC-02).
 */
export function verifyGuidanceSnapshot(
  value: unknown,
  expected: {
    /** The authority DID on this installation's trusted link to it. */
    expectedAuthorityDid: string;
    selfInstallationDid: string;
    heldVersion: number | null;
    now: Date;
    /** False when the caller reports expiry itself, as a held snapshot's reader does. */
    checkExpiry?: boolean;
  },
): GuidanceSnapshotVerification {
  const violations = validateGuidanceSnapshotV1(value);
  if (violations.length > 0) return { ok: false, reason: "malformed", violations };
  const snapshot = value as GuidanceSnapshotV1;

  let keyDid: string | null = null;
  try {
    keyDid = deriveDeviceId(snapshot.meta.authoritySigningPublicKey);
  } catch {
    keyDid = null;
  }
  if (keyDid !== snapshot.meta.authorityInstallationDid || keyDid !== expected.expectedAuthorityDid) {
    return { ok: false, reason: "authority-mismatch" };
  }
  if (!signatureVerifies(snapshot)) return { ok: false, reason: "bad-signature" };
  if (snapshot.meta.companionInstallationDid !== expected.selfInstallationDid) {
    return { ok: false, reason: "not-for-this-installation" };
  }
  const freshness = judgeGuidanceSnapshotFreshness({ snapshot, heldVersion: expected.heldVersion, now: expected.now });
  if (!freshness.ok && (freshness.reason !== "expired" || expected.checkExpiry !== false)) {
    return { ok: false, reason: freshness.reason };
  }
  return { ok: true, snapshot };
}
