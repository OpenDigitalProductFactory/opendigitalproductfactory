import { X509Certificate } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/app-url", () => ({ resolveAppBaseUrl: () => null }));

import { FOREIGN_ROOT_CERT_PEM, MEMBER_CERT_PEM, MEMBER_KEY_PKCS8_B64, ORG_ROOT_CERT_PEM, STRANGER_CERT_PEM } from "./membership-fixtures";
import { MEMBERSHIP_SIGN_PATH } from "./membership-relay";
import { importOrganizationJoinFile, ownAddresses, type JoinImportDb } from "./organization-join-import";
import { FEDERATION_MEMBERSHIP_CONFIG_KEY } from "./organization-membership";
import { FEDERATION_REACHED_AT_CONFIG } from "./reached-at";

const now = new Date("2026-09-04T12:00:00.000Z");
const rootFingerprint = new X509Certificate(ORG_ROOT_CERT_PEM).fingerprint256.replaceAll(":", "").toLowerCase();
const memberKeyPem = `-----BEGIN PRIVATE KEY-----\n${MEMBER_KEY_PKCS8_B64}\n-----END PRIVATE KEY-----`;
const memberPublicKeyPem = new X509Certificate(MEMBER_CERT_PEM).publicKey.export({ type: "spki", format: "pem" }).toString();
/** The fixture leaf certifies the fixture key, so the "CA" can answer with it. */
const fixtureKeypair = () => ({ privateKeyPem: memberKeyPem, publicKeyPem: memberPublicKeyPem });

function joinFile(overrides: Record<string, string> = {}): string {
  const fields = {
    package_id: "0123456789abcdef0123456789abcdef",
    ca_url: "https://192.168.0.152:9000",
    root_fingerprint: rootFingerprint,
    intended_hostname: "192.168.0.200",
    intended_sans: "192.168.0.200",
    expires_at: String(Math.floor(now.getTime() / 1000) + 600),
    enrollment_token: "one-time.token_1",
    edge_client_enrollment_token: "edge.token_1",
    ...overrides,
  };
  return ["DPF_ORGANIZATION_JOIN_V2", ...Object.entries(fields).map(([k, v]) => `${k}=${v}`), ""].join("\n");
}

function db(rows: Record<string, unknown> = {}): JoinImportDb & { rows: Record<string, unknown> } {
  return {
    rows,
    platformConfig: {
      findUnique: vi.fn(async (args: { where: { key: string } }) => (rows[args.where.key] ? { value: rows[args.where.key] } : null)) as JoinImportDb["platformConfig"]["findUnique"],
      upsert: vi.fn(async (args: { where: { key: string }; create: { value: unknown } }) => { rows[args.where.key] = args.create.value; return {}; }) as JoinImportDb["platformConfig"]["upsert"],
    },
  };
}

const authorityAccepts = vi.fn(async () => ({ ok: true, status: 200, body: { accepted: true, certPem: MEMBER_CERT_PEM, chainPems: [MEMBER_CERT_PEM, ORG_ROOT_CERT_PEM], rootPem: ORG_ROOT_CERT_PEM } }));
const writes: Array<Record<string, unknown>> = [];
const writeOk = vi.fn(async (input: Record<string, unknown>) => { writes.push(input); return { written: true as const, dir: "/dpf-federation/pki" }; });

beforeEach(() => {
  authorityAccepts.mockClear();
  writeOk.mockClear();
  writes.length = 0;
});

describe("ownAddresses", () => {
  it("unions the configured base URL, the request host and the hosts trusted peers reached us at", async () => {
    const store = db({ [FEDERATION_REACHED_AT_CONFIG]: { schemaVersion: 1, hosts: { "192.168.0.200": now.toISOString(), "dev.internal": now.toISOString() } } });
    const own = await ownAddresses(store, { requestHost: "http://127.0.0.1:3000", configuredBaseUrl: "https://Portal.Example:8443" });
    expect([...own].sort()).toEqual(["127.0.0.1", "192.168.0.200", "dev.internal", "portal.example"]);
  });
});

describe("importOrganizationJoinFile", () => {
  it("turns a join file into material with nothing else configured: CSR to the authority's portal, chain pinned, facts recorded", async () => {
    const store = db();
    const result = await importOrganizationJoinFile(
      { fileText: joinFile(), requestHost: "http://192.168.0.200:3000", now },
      { db: store, post: authorityAccepts, write: writeOk, generateKeypair: fixtureKeypair, configuredBaseUrl: null },
    );
    expect(result).toEqual({
      imported: true, authorityUrl: "http://192.168.0.152:3000", caUrl: "https://192.168.0.152:9000", intendedPeer: "192.168.0.200",
      expiresAt: new Date((Math.floor(now.getTime() / 1000) + 600) * 1000).toISOString(), materialDir: "/dpf-federation/pki",
    });
    const calls = authorityAccepts.mock.calls as unknown as Array<[{ peerAuthorityUrl: string; path: string; sameOrgLan: boolean; cloudEvent: Record<string, unknown> }]>;
    const call = calls[0]![0];
    expect(call.peerAuthorityUrl).toBe("http://192.168.0.152:3000");
    expect(call.path).toBe(MEMBERSHIP_SIGN_PATH);
    expect(call.sameOrgLan).toBe(true);
    expect(call.cloudEvent.enrollmentToken).toBe("one-time.token_1");
    expect(String(call.cloudEvent.csrPem)).toContain("BEGIN CERTIFICATE REQUEST");
    expect(call.cloudEvent.memberAddress).toBe("http://192.168.0.200:3000");
    expect(writes[0]).toMatchObject({ rootPem: ORG_ROOT_CERT_PEM, certPem: MEMBER_CERT_PEM, keyPem: memberKeyPem });
    expect(writes[0]!.facts).toEqual({ schemaVersion: 1, caUrl: "https://192.168.0.152:9000", intendedPeer: "192.168.0.200", rootFingerprint, packageId: "0123456789abcdef0123456789abcdef", joinedAt: now.toISOString() });
    expect(store.rows[FEDERATION_MEMBERSHIP_CONFIG_KEY]).toEqual(writes[0]!.facts);
  });

  it("accepts the file over a loopback MCP call when a trusted peer has reached us at the intended host", async () => {
    const store = db({ [FEDERATION_REACHED_AT_CONFIG]: { schemaVersion: 1, hosts: { "192.168.0.200": now.toISOString() } } });
    const result = await importOrganizationJoinFile(
      { fileText: joinFile(), requestHost: "http://127.0.0.1:3000", now },
      { db: store, post: authorityAccepts, write: writeOk, generateKeypair: fixtureKeypair, configuredBaseUrl: null },
    );
    expect(result.imported).toBe(true);
  });

  it("refuses a wrong-host, expired or tampered file before any network call", async () => {
    const store = db();
    const deps = { db: store, post: authorityAccepts, write: writeOk, generateKeypair: fixtureKeypair, configuredBaseUrl: null };
    expect(await importOrganizationJoinFile({ fileText: joinFile(), requestHost: "http://127.0.0.1:3000", now }, deps)).toMatchObject({ imported: false, reason: "intended-for-another-host" });
    expect(await importOrganizationJoinFile({ fileText: joinFile({ expires_at: String(Math.floor(now.getTime() / 1000) - 1) }), requestHost: "http://192.168.0.200:3000", now }, deps)).toMatchObject({ imported: false, reason: "join-package-expired" });
    expect(await importOrganizationJoinFile({ fileText: joinFile({ root_fingerprint: "zz" }), requestHost: "http://192.168.0.200:3000", now }, deps)).toMatchObject({ imported: false, reason: "invalid-join-file" });
    expect(authorityAccepts).not.toHaveBeenCalled();
    expect(writeOk).not.toHaveBeenCalled();
  });

  it("reports an authority that predates the relay, and a CA refusal, without writing anything", async () => {
    const store = db();
    const base = { db: store, write: writeOk, generateKeypair: fixtureKeypair, configuredBaseUrl: null };
    const stale = await importOrganizationJoinFile({ fileText: joinFile(), requestHost: "http://192.168.0.200:3000", now }, { ...base, post: async () => ({ ok: false, status: 404, body: undefined }) });
    expect(stale).toMatchObject({ imported: false, reason: "authority-unreachable" });
    expect(String((stale as { detail?: string }).detail)).toContain("current release");
    const refused = await importOrganizationJoinFile({ fileText: joinFile(), requestHost: "http://192.168.0.200:3000", now }, { ...base, post: async () => ({ ok: false, status: 403, body: { accepted: false, reason: "token-invalid", detail: "token expired" } }) });
    expect(refused).toEqual({ imported: false, reason: "authority-refused", detail: "token-invalid: token expired" });
    expect(writeOk).not.toHaveBeenCalled();
  });

  it("refuses a chain that ends at a root other than the one the file pins, or a leaf for another key", async () => {
    const store = db();
    const base = { db: store, write: writeOk, generateKeypair: fixtureKeypair, configuredBaseUrl: null };
    const foreign = await importOrganizationJoinFile(
      { fileText: joinFile(), requestHost: "http://192.168.0.200:3000", now },
      { ...base, post: async () => ({ ok: true, status: 200, body: { accepted: true, certPem: STRANGER_CERT_PEM, chainPems: [STRANGER_CERT_PEM, FOREIGN_ROOT_CERT_PEM], rootPem: FOREIGN_ROOT_CERT_PEM } }) },
    );
    expect(foreign).toMatchObject({ imported: false, reason: "chain-untrusted" });
    const otherKey = await importOrganizationJoinFile(
      { fileText: joinFile(), requestHost: "http://192.168.0.200:3000", now },
      { ...base, post: authorityAccepts, generateKeypair: undefined },
    );
    expect(otherKey).toMatchObject({ imported: false, reason: "chain-untrusted", detail: expect.stringContaining("not for the key") });
    expect(writeOk).not.toHaveBeenCalled();
  });

  it("reports an unwritable state directory as the outcome", async () => {
    const store = db();
    const result = await importOrganizationJoinFile(
      { fileText: joinFile(), requestHost: "http://192.168.0.200:3000", now },
      { db: store, post: authorityAccepts, generateKeypair: fixtureKeypair, configuredBaseUrl: null, write: async () => ({ written: false, reason: "federation state directory is not mounted" }) },
    );
    expect(result).toEqual({ imported: false, reason: "material-not-writable", detail: "federation state directory is not mounted" });
    expect(store.rows[FEDERATION_MEMBERSHIP_CONFIG_KEY]).toBeUndefined();
  });
});
