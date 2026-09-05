import { X509Certificate } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { buildCertificateSigningRequest, generateMembershipKeypair } from "./csr";
import { FOREIGN_ROOT_CERT_PEM, MEMBER_CERT_PEM, ORG_ROOT_CERT_PEM, STRANGER_CERT_PEM } from "./membership-fixtures";
import {
  MEMBERSHIP_RELAY_AUDIT_KEY,
  MEMBERSHIP_SIGN_SPEC,
  caInternalUrl,
  membershipRelayAvailable,
  parseMembershipSignRequest,
  relayMembershipSign,
  tokenIdHash,
  type RelayDb,
} from "./membership-relay";
import { _resetNearbyPairingRateLimits } from "./nearby-pairing-rate-limit";

const now = new Date("2026-09-04T12:00:00.000Z");
const kp = generateMembershipKeypair();
const csrPem = buildCertificateSigningRequest({ privateKeyPem: kp.privateKeyPem, commonName: "192.168.0.200" });
const request = { spec: MEMBERSHIP_SIGN_SPEC, csrPem, enrollmentToken: "one-time.enrollment.token-1", memberAddress: "http://192.168.0.200:3000" } as const;

function auditDb(): RelayDb & { rows: Record<string, unknown> } {
  const rows: Record<string, unknown> = {};
  return {
    rows,
    platformConfig: {
      findUnique: vi.fn(async (args: { where: { key: string } }) => (rows[args.where.key] ? { value: rows[args.where.key] } : null)) as RelayDb["platformConfig"]["findUnique"],
      upsert: vi.fn(async (args: { where: { key: string }; create: { value: unknown } }) => { rows[args.where.key] = args.create.value; return {}; }) as RelayDb["platformConfig"]["upsert"],
    },
  };
}

const caAccepts = vi.fn(async () => ({ status: 200, body: { crt: MEMBER_CERT_PEM, ca: ORG_ROOT_CERT_PEM, certChain: [MEMBER_CERT_PEM, ORG_ROOT_CERT_PEM] } }));

beforeEach(() => {
  _resetNearbyPairingRateLimits();
  caAccepts.mockClear();
});

describe("parseMembershipSignRequest", () => {
  it("accepts the v1 shape and refuses anything else before a byte reaches the CA", () => {
    expect(parseMembershipSignRequest(request)).toEqual({ ...request, csrPem: csrPem.trim() });
    expect(parseMembershipSignRequest({ ...request, spec: "dpf.membership-sign/2" })).toBeNull();
    expect(parseMembershipSignRequest({ ...request, csrPem: MEMBER_CERT_PEM })).toBeNull();
    expect(parseMembershipSignRequest({ ...request, enrollmentToken: "has spaces" })).toBeNull();
    expect(parseMembershipSignRequest({ ...request, memberAddress: "ftp://x" })).toBeNull();
    expect(parseMembershipSignRequest(null)).toBeNull();
  });
});

describe("membershipRelayAvailable", () => {
  const rootOnly = async (path: string) => { if (path.endsWith("root_ca.crt")) return ORG_ROOT_CERT_PEM; throw new Error("ENOENT"); };

  it("needs the organization root and proof of being the authority", async () => {
    expect(await membershipRelayAvailable({ env: {}, readText: async () => { throw new Error("ENOENT"); }, exists: async () => true })).toEqual({ available: false, reason: "no-organization-root" });
    expect(await membershipRelayAvailable({ env: {}, readText: rootOnly, exists: async () => false })).toEqual({ available: false, reason: "not-the-authority" });
    expect(await membershipRelayAvailable({ env: { DPF_ORGANIZATION_TRUST_ROLE: "authority" }, readText: rootOnly, exists: async () => false })).toEqual({ available: true, rootPem: ORG_ROOT_CERT_PEM });
    const seen: string[] = [];
    expect(await membershipRelayAvailable({ env: {}, readText: rootOnly, exists: async (path) => { seen.push(path); return true; } })).toEqual({ available: true, rootPem: ORG_ROOT_CERT_PEM });
    expect(seen).toEqual(["/dpf-state/pki/secrets/step-ca-password"]);
  });

  it("reaches the CA at the compose service by default", () => {
    expect(caInternalUrl({})).toBe("https://step-ca:9000");
    expect(caInternalUrl({ DPF_ORGANIZATION_CA_INTERNAL_URL: "https://ca.internal:9443/" })).toBe("https://ca.internal:9443");
  });
});

describe("relayMembershipSign", () => {
  it("returns the CA's chain verbatim once it verifies to the pinned root, and audits without the token", async () => {
    const db = auditDb();
    const result = await relayMembershipSign({ request, callerKey: "192.168.0.200", now }, { rootPem: ORG_ROOT_CERT_PEM, db, post: caAccepts });
    expect(result).toEqual({ accepted: true, certPem: MEMBER_CERT_PEM, chainPems: [MEMBER_CERT_PEM, ORG_ROOT_CERT_PEM], rootPem: ORG_ROOT_CERT_PEM });
    expect(caAccepts).toHaveBeenCalledWith({ caUrl: "https://step-ca:9000", rootPem: ORG_ROOT_CERT_PEM, csrPem: csrPem, enrollmentToken: request.enrollmentToken });
    const ring = db.rows[MEMBERSHIP_RELAY_AUDIT_KEY] as { events: Array<Record<string, unknown>> };
    expect(ring.events).toHaveLength(1);
    expect(ring.events[0]).toMatchObject({ verdict: "accepted", memberAddress: "http://192.168.0.200:3000", tokenId: tokenIdHash(request.enrollmentToken) });
    expect(JSON.stringify(ring)).not.toContain(request.enrollmentToken);
  });

  it("relays one call per token: a replay is refused here, not at the CA", async () => {
    const db = auditDb();
    await relayMembershipSign({ request, callerKey: "a", now }, { rootPem: ORG_ROOT_CERT_PEM, db, post: caAccepts });
    const replay = await relayMembershipSign({ request, callerKey: "b", now }, { rootPem: ORG_ROOT_CERT_PEM, db, post: caAccepts });
    expect(replay).toMatchObject({ accepted: false, reason: "rate-limited" });
    expect(caAccepts).toHaveBeenCalledTimes(1);
  });

  it("maps the CA's verdicts: 401 is token-invalid, other refusals are ca-refused, a failed dial is ca-unreachable", async () => {
    const db = auditDb();
    const refused = await relayMembershipSign({ request: { ...request, enrollmentToken: "t2" }, callerKey: "a", now }, { rootPem: ORG_ROOT_CERT_PEM, db, post: async () => ({ status: 401, body: { message: "token expired" } }) });
    expect(refused).toMatchObject({ accepted: false, reason: "token-invalid", detail: "token expired" });
    const errored = await relayMembershipSign({ request: { ...request, enrollmentToken: "t3" }, callerKey: "a", now }, { rootPem: ORG_ROOT_CERT_PEM, db, post: async () => ({ status: 500, body: { message: "database down" } }) });
    expect(errored).toMatchObject({ accepted: false, reason: "ca-refused" });
    const down = await relayMembershipSign({ request: { ...request, enrollmentToken: "t4" }, callerKey: "a", now }, { rootPem: ORG_ROOT_CERT_PEM, db, post: async () => { throw new Error("ECONNREFUSED"); } });
    expect(down).toMatchObject({ accepted: false, reason: "ca-unreachable", detail: "ECONNREFUSED" });
  });

  it("never hands back a chain that does not end at the pinned root", async () => {
    const db = auditDb();
    const foreign = await relayMembershipSign(
      { request, callerKey: "a", now },
      { rootPem: ORG_ROOT_CERT_PEM, db, post: async () => ({ status: 200, body: { crt: STRANGER_CERT_PEM, ca: FOREIGN_ROOT_CERT_PEM, certChain: [STRANGER_CERT_PEM, FOREIGN_ROOT_CERT_PEM] } }) },
    );
    expect(foreign).toMatchObject({ accepted: false, reason: "ca-refused" });
    expect(String((foreign as { detail?: string }).detail)).toContain("pinned root");
  });

  it("rate-limits a chatty caller and bounds the audit ring", async () => {
    const db = auditDb();
    for (let index = 0; index < 6; index++) {
      await relayMembershipSign({ request: { ...request, enrollmentToken: `loop-${index}` }, callerKey: "noisy", now }, { rootPem: ORG_ROOT_CERT_PEM, db, post: caAccepts });
    }
    const seventh = await relayMembershipSign({ request: { ...request, enrollmentToken: "loop-7" }, callerKey: "noisy", now }, { rootPem: ORG_ROOT_CERT_PEM, db, post: caAccepts });
    expect(seventh).toMatchObject({ accepted: false, reason: "rate-limited" });
    const ring = db.rows[MEMBERSHIP_RELAY_AUDIT_KEY] as { events: unknown[] };
    expect(ring.events.length).toBe(7);
    expect(new X509Certificate(MEMBER_CERT_PEM).subject).toContain("member.internal");
  });
});
