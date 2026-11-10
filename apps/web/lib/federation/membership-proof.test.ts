import { X509Certificate } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  FOREIGN_ROOT_CERT_PEM,
  MEMBER_CERT_PEM,
  MEMBER_KEY_PKCS8_B64,
  ORG_ROOT_CERT_PEM,
  STRANGER_CERT_PEM,
  STRANGER_KEY_PKCS8_B64,
} from "./membership-fixtures";
import {
  checkMembershipStatement,
  parseMembershipStatement,
  signMembershipStatement,
  splitPemChain,
  verifyMembershipChain,
  verifyMembershipSignature,
  type MembershipStatement,
} from "./membership-proof";

const now = new Date("2026-09-02T20:00:00.000Z");
const rootFingerprint = new X509Certificate(ORG_ROOT_CERT_PEM).fingerprint256.replaceAll(":", "").toLowerCase();

function statement(overrides: Partial<MembershipStatement> = {}): MembershipStatement {
  return {
    version: "dpf.membership-statement/1",
    installationId: `inst_${"a".repeat(32)}`,
    deviceId: `did_${"b".repeat(64)}`,
    organizationRef: "northwind-test-estate",
    authorityUrl: "http://192.168.0.200:3000",
    rootFingerprint,
    audienceRootFingerprint: rootFingerprint,
    callbackToken: "dpflink_callback",
    displayName: "Development",
    nonce: "n".repeat(32),
    issuedAt: now.toISOString(),
    ...overrides,
  };
}

describe("verifyMembershipChain", () => {
  it("accepts a member leaf that chains by signature to the pinned organization root", () => {
    const result = verifyMembershipChain({ chainPems: [MEMBER_CERT_PEM], pinnedRootPem: ORG_ROOT_CERT_PEM, now });
    expect(result).toMatchObject({ verified: true, presentedRootFingerprint: rootFingerprint, failure: null });
    expect(result.leafSubject).toContain("member.internal");
    // A full chain (leaf + root) verifies the same way.
    expect(verifyMembershipChain({ chainPems: [MEMBER_CERT_PEM, ORG_ROOT_CERT_PEM], pinnedRootPem: ORG_ROOT_CERT_PEM, now }).verified).toBe(true);
  });

  it("refuses a leaf from another organization's CA, and a chain whose root is not the pinned one", () => {
    expect(verifyMembershipChain({ chainPems: [STRANGER_CERT_PEM], pinnedRootPem: ORG_ROOT_CERT_PEM, now }).failure).toBe("issuer-mismatch");
    expect(verifyMembershipChain({ chainPems: [STRANGER_CERT_PEM, FOREIGN_ROOT_CERT_PEM], pinnedRootPem: ORG_ROOT_CERT_PEM, now }).failure).toBe("root-fingerprint-mismatch");
  });

  it("fails closed on an empty, unparseable, expired or too-long chain and on a missing root", () => {
    expect(verifyMembershipChain({ chainPems: [], pinnedRootPem: ORG_ROOT_CERT_PEM, now }).failure).toBe("empty-chain");
    expect(verifyMembershipChain({ chainPems: ["-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----"], pinnedRootPem: ORG_ROOT_CERT_PEM, now }).failure).toBe("unparseable-certificate");
    expect(verifyMembershipChain({ chainPems: [MEMBER_CERT_PEM], pinnedRootPem: ORG_ROOT_CERT_PEM, now: new Date("2050-01-01T00:00:00Z") }).failure).toBe("certificate-expired");
    expect(verifyMembershipChain({ chainPems: [MEMBER_CERT_PEM], pinnedRootPem: null, now }).failure).toBe("no-pinned-root");
    expect(verifyMembershipChain({ chainPems: Array(7).fill(MEMBER_CERT_PEM), pinnedRootPem: ORG_ROOT_CERT_PEM, now }).failure).toBe("chain-too-long");
    expect(splitPemChain(`${MEMBER_CERT_PEM}\n${ORG_ROOT_CERT_PEM}`)).toHaveLength(2);
  });
});

describe("statement signing", () => {
  it("verifies a statement signed with the key behind the member certificate, and nothing else", () => {
    const s = statement();
    const signature = signMembershipStatement(MEMBER_KEY_PKCS8_B64, s);
    expect(verifyMembershipSignature(MEMBER_CERT_PEM, s, signature)).toBe(true);
    // Any change to the statement, a foreign key, or a foreign certificate fails.
    expect(verifyMembershipSignature(MEMBER_CERT_PEM, { ...s, displayName: "Tampered" }, signature)).toBe(false);
    expect(verifyMembershipSignature(MEMBER_CERT_PEM, s, signMembershipStatement(STRANGER_KEY_PKCS8_B64, s))).toBe(false);
    expect(verifyMembershipSignature(STRANGER_CERT_PEM, s, signature)).toBe(false);
    expect(verifyMembershipSignature("garbage", s, signature)).toBe(false);
  });
});

describe("parse + check", () => {
  it("parses a well-formed statement and refuses malformed ones", () => {
    const s = statement();
    expect(parseMembershipStatement(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(parseMembershipStatement({ ...s, installationId: "nope" })).toBeNull();
    expect(parseMembershipStatement({ ...s, deviceId: "did_short" })).toBeNull();
    expect(parseMembershipStatement({ ...s, version: "other" })).toBeNull();
    expect(parseMembershipStatement(null)).toBeNull();
  });

  it("accepts a fresh statement for our root and organization, and names why otherwise", () => {
    const chain = verifyMembershipChain({ chainPems: [MEMBER_CERT_PEM], pinnedRootPem: ORG_ROOT_CERT_PEM, now });
    const base = { chain, localRootFingerprint: rootFingerprint, localOrganizationRef: "northwind-test-estate", now };
    expect(checkMembershipStatement({ statement: statement(), ...base })).toEqual({ accepted: true });
    expect(checkMembershipStatement({ statement: statement({ issuedAt: "2026-09-02T19:00:00.000Z" }), ...base })).toEqual({ accepted: false, reason: "stale" });
    expect(checkMembershipStatement({ statement: statement({ audienceRootFingerprint: "0".repeat(64) }), ...base })).toEqual({ accepted: false, reason: "wrong-audience" });
    expect(checkMembershipStatement({ statement: statement({ rootFingerprint: "0".repeat(64) }), ...base })).toEqual({ accepted: false, reason: "root-fingerprint-mismatch" });
    expect(checkMembershipStatement({ statement: statement({ organizationRef: "someone-else" }), ...base })).toEqual({ accepted: false, reason: "organization-ref-mismatch" });
    // Colon-separated fingerprint forms compare equal.
    const colon = new X509Certificate(ORG_ROOT_CERT_PEM).fingerprint256;
    expect(checkMembershipStatement({ statement: statement({ audienceRootFingerprint: colon, rootFingerprint: colon }), ...base })).toEqual({ accepted: true });
  });
});
