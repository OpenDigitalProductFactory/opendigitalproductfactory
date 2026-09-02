// EP-ZERO-CONFIG-FEDERATION §5.6 — membership proof at the message layer.
//
// A member of an organization holds a certificate its join package earned it
// (issued by the organization's CA) and the organization root. To pair, it
// signs an enrolment statement with the key behind that certificate and sends
// the statement, the signature and its certificate chain. The receiver:
//   1. verifies the chain's SIGNATURES leaf → root against its own pinned root
//      (real cryptographic verification — the TLS stack is not involved, so
//      nothing else will do it), plus validity windows and the root fingerprint;
//   2. verifies the statement signature with the leaf's public key;
//   3. checks the statement is fresh, addressed to this root, and names the
//      peer's installation facts.
// Only then is a link created, born trusted on both sides. No operator, no
// code comparison, no TLS overlay.
//
// Pure: no I/O. Callers supply PEM text and the clock.

import { X509Certificate, createPrivateKey, createSign, createVerify, type KeyObject } from "node:crypto";

import { normalizeFingerprint } from "@dpf/db/peer-certificate-verification";

export const MEMBERSHIP_STATEMENT_VERSION = "dpf.membership-statement/1" as const;
/** A statement older or newer than this is refused (clock skew allowance). */
export const MEMBERSHIP_STATEMENT_MAX_AGE_MS = 5 * 60 * 1000;
export const MEMBERSHIP_MAX_CHAIN_LENGTH = 6;

export interface MembershipStatement {
  version: typeof MEMBERSHIP_STATEMENT_VERSION;
  /** Who is speaking. */
  installationId: string;
  deviceId: string | null;
  /** The peer's normalised organization ref (estate name), compared with ours. */
  organizationRef: string;
  /** Where the speaker can be reached (its authority URL). */
  authorityUrl: string;
  /** SHA-256 fingerprint of the organization root the speaker chains to. */
  rootFingerprint: string;
  /** Who this statement is for: the receiver's root fingerprint (same org). */
  audienceRootFingerprint: string;
  /** The speaker's inbound link token, so the receiver can call back. */
  callbackToken: string | null;
  /** Operator-facing name for the speaker. */
  displayName: string;
  nonce: string;
  issuedAt: string;
}

export interface ChainVerification {
  verified: boolean;
  presentedRootFingerprint: string | null;
  leafFingerprint: string | null;
  leafSubject: string | null;
  failure:
    | "empty-chain"
    | "chain-too-long"
    | "unparseable-certificate"
    | "certificate-expired"
    | "certificate-not-yet-valid"
    | "issuer-mismatch"
    | "signature-invalid"
    | "chain-has-no-root"
    | "root-fingerprint-mismatch"
    | "no-pinned-root"
    | null;
}

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

/** Split a PEM bundle (or an array of PEMs) into individual certificate PEMs. */
export function splitPemChain(input: string | readonly string[]): string[] {
  const text = Array.isArray(input) ? input.join("\n") : String(input);
  return text.match(PEM_BLOCK) ?? [];
}

function parse(pem: string): X509Certificate | null {
  try {
    return new X509Certificate(pem);
  } catch {
    return null;
  }
}

function bareFingerprint(cert: X509Certificate): string {
  return cert.fingerprint256.replaceAll(":", "").toLowerCase();
}

function isSelfSigned(cert: X509Certificate): boolean {
  try {
    return cert.checkIssued(cert) && cert.verify(cert.publicKey);
  } catch {
    return false;
  }
}

/**
 * Verify a leaf-first chain against the pinned organization root.
 * Every certificate must be within its validity window, each must be issued
 * AND signed by the next, the terminal certificate must be self-signed, and its
 * fingerprint must equal the pinned root. The pinned root PEM itself is
 * appended when the chain omits it, so a member may send only its leaf.
 */
export function verifyMembershipChain(input: {
  chainPems: readonly string[];
  pinnedRootPem: string | null;
  now: Date;
}): ChainVerification {
  const result: ChainVerification = { verified: false, presentedRootFingerprint: null, leafFingerprint: null, leafSubject: null, failure: null };
  if (!input.pinnedRootPem) return { ...result, failure: "no-pinned-root" };
  const pinned = parse(input.pinnedRootPem);
  if (!pinned) return { ...result, failure: "no-pinned-root" };
  const pinnedFingerprint = bareFingerprint(pinned);

  const pems = splitPemChain(input.chainPems);
  if (pems.length === 0) return { ...result, failure: "empty-chain" };
  if (pems.length > MEMBERSHIP_MAX_CHAIN_LENGTH) return { ...result, failure: "chain-too-long" };
  const chain: X509Certificate[] = [];
  for (const pem of pems) {
    const cert = parse(pem);
    if (!cert) return { ...result, failure: "unparseable-certificate" };
    chain.push(cert);
  }
  // A member may send only its leaf (and intermediates); the receiver supplies the root.
  if (!isSelfSigned(chain[chain.length - 1]!)) chain.push(pinned);

  const leaf = chain[0]!;
  result.leafFingerprint = bareFingerprint(leaf);
  result.leafSubject = leaf.subject;

  for (const cert of chain) {
    const from = new Date(cert.validFrom).getTime();
    const to = new Date(cert.validTo).getTime();
    if (Number.isFinite(to) && input.now.getTime() > to) return { ...result, failure: "certificate-expired" };
    if (Number.isFinite(from) && input.now.getTime() < from) return { ...result, failure: "certificate-not-yet-valid" };
  }
  for (let index = 0; index < chain.length - 1; index++) {
    const cert = chain[index]!;
    const issuer = chain[index + 1]!;
    if (!cert.checkIssued(issuer)) return { ...result, failure: "issuer-mismatch" };
    let ok = false;
    try {
      ok = cert.verify(issuer.publicKey);
    } catch {
      ok = false;
    }
    if (!ok) return { ...result, failure: "signature-invalid" };
  }
  const root = chain[chain.length - 1]!;
  if (!isSelfSigned(root)) return { ...result, failure: "chain-has-no-root" };
  result.presentedRootFingerprint = bareFingerprint(root);
  if (result.presentedRootFingerprint !== pinnedFingerprint) return { ...result, failure: "root-fingerprint-mismatch" };
  return { ...result, verified: true };
}

/** Deterministic serialisation so both sides sign and verify identical bytes. */
export function canonicalMembershipStatement(statement: MembershipStatement): string {
  const ordered: Record<string, unknown> = {};
  const source = statement as unknown as Record<string, unknown>;
  for (const key of Object.keys(source).sort()) ordered[key] = source[key];
  return JSON.stringify(ordered);
}

function privateKeyFrom(material: string): KeyObject {
  if (material.includes("-----BEGIN")) return createPrivateKey(material);
  return createPrivateKey({ key: Buffer.from(material, "base64"), format: "der", type: "pkcs8" });
}

/** Sign a statement with the key behind a certificate (PEM or PKCS8 DER base64). */
export function signMembershipStatement(privateKeyMaterial: string, statement: MembershipStatement): string {
  const key = privateKeyFrom(privateKeyMaterial);
  const signer = createSign("sha256");
  signer.update(canonicalMembershipStatement(statement));
  signer.end();
  return signer.sign(key).toString("base64");
}

/** Verify a statement signature with the leaf certificate's public key. Fails closed. */
export function verifyMembershipSignature(leafPem: string, statement: MembershipStatement, signatureBase64: string): boolean {
  try {
    const leaf = new X509Certificate(leafPem);
    const verifier = createVerify("sha256");
    verifier.update(canonicalMembershipStatement(statement));
    verifier.end();
    return verifier.verify(leaf.publicKey, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

export type StatementCheck =
  | { accepted: true }
  | { accepted: false; reason: "malformed" | "stale" | "wrong-audience" | "organization-ref-mismatch" | "root-fingerprint-mismatch" };

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse an untrusted statement object; null when its shape is wrong. */
export function parseMembershipStatement(value: unknown): MembershipStatement | null {
  if (!isRecordLike(value) || value.version !== MEMBERSHIP_STATEMENT_VERSION) return null;
  const s = (k: string, max = 400) => (typeof value[k] === "string" && (value[k] as string).length <= max ? (value[k] as string) : null);
  const installationId = s("installationId", 64);
  const organizationRef = s("organizationRef", 200);
  const authorityUrl = s("authorityUrl", 400);
  const rootFingerprint = s("rootFingerprint", 128);
  const audienceRootFingerprint = s("audienceRootFingerprint", 128);
  const displayName = s("displayName", 200);
  const nonce = s("nonce", 128);
  const issuedAt = s("issuedAt", 64);
  if (!installationId || !/^inst_[a-f0-9]{32}$/.test(installationId)) return null;
  if (!organizationRef || !authorityUrl || !rootFingerprint || !audienceRootFingerprint || !displayName || !nonce || !issuedAt) return null;
  if (Number.isNaN(Date.parse(issuedAt))) return null;
  const deviceId = value.deviceId === null || value.deviceId === undefined ? null : s("deviceId", 128);
  if (deviceId !== null && !/^did_[a-f0-9]{64}$/.test(deviceId)) return null;
  const callbackToken = value.callbackToken === null || value.callbackToken === undefined ? null : s("callbackToken", 400);
  return {
    version: MEMBERSHIP_STATEMENT_VERSION,
    installationId, deviceId, organizationRef, authorityUrl, rootFingerprint, audienceRootFingerprint,
    callbackToken, displayName, nonce, issuedAt,
  };
}

/**
 * Check a verified-signature statement against what THIS installation knows:
 * fresh, addressed to our root, chaining to the same root it claims, and from
 * an installation in our organization.
 */
export function checkMembershipStatement(input: {
  statement: MembershipStatement;
  chain: ChainVerification;
  localRootFingerprint: string;
  localOrganizationRef: string;
  now: Date;
}): StatementCheck {
  const issued = Date.parse(input.statement.issuedAt);
  if (Number.isNaN(issued) || Math.abs(input.now.getTime() - issued) > MEMBERSHIP_STATEMENT_MAX_AGE_MS) return { accepted: false, reason: "stale" };
  const local = normalizeFingerprint(input.localRootFingerprint);
  if (!local) return { accepted: false, reason: "malformed" };
  if (normalizeFingerprint(input.statement.audienceRootFingerprint) !== local) return { accepted: false, reason: "wrong-audience" };
  if (normalizeFingerprint(input.statement.rootFingerprint) !== local || input.chain.presentedRootFingerprint !== local) {
    return { accepted: false, reason: "root-fingerprint-mismatch" };
  }
  if (input.statement.organizationRef !== input.localOrganizationRef) return { accepted: false, reason: "organization-ref-mismatch" };
  return { accepted: true };
}
