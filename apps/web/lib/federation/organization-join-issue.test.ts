import { X509Certificate } from "node:crypto";

import { CompactEncrypt, exportJWK, generateKeyPair, jwtVerify } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/app-url", () => ({ resolveAppBaseUrl: () => null }));

import { parseOrganizationJoinPackageMaterial } from "@dpf/db/organization-join-action";

import type { CaRequest } from "./ca-client";
import { ORG_ROOT_CERT_PEM } from "./membership-fixtures";
import { buildJoinPackageText, issueOrganizationJoinFile, resolveAuthorityHost, unlockProvisionerKey } from "./organization-join-issue";
import { FEDERATION_REACHED_AT_CONFIG, type ReachedAtDb } from "./reached-at";

const now = new Date("2026-09-05T01:00:00.000Z");
const password = "correct horse battery staple";
const rootFingerprint = new X509Certificate(ORG_ROOT_CERT_PEM).fingerprint256.replaceAll(":", "").toLowerCase();

/** A step-ca-shaped provisioner: the private JWK sealed with the provisioner password (JWE PBES2). */
async function provisioner(name: string) {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const privateJwk = { ...(await exportJWK(privateKey)), kid: `${name}-kid`, alg: "ES256", use: "sig" };
  const publicJwk = { ...(await exportJWK(publicKey)), kid: `${name}-kid`, alg: "ES256", use: "sig" };
  const encryptedKey = await new CompactEncrypt(new TextEncoder().encode(JSON.stringify(privateJwk)))
    .setProtectedHeader({ alg: "PBES2-HS256+A128KW", enc: "A256GCM", cty: "jwk+json", p2c: 4096 })
    .encrypt(new TextEncoder().encode(password));
  return { type: "JWK", name, key: publicJwk, encryptedKey, publicKey };
}

let installer: Awaited<ReturnType<typeof provisioner>>;
let edge: Awaited<ReturnType<typeof provisioner>>;
beforeAll(async () => {
  installer = await provisioner("dpf-installer");
  edge = await provisioner("dpf-edge-client");
});

function db(rows: Record<string, unknown> = {}): ReachedAtDb {
  return {
    platformConfig: {
      findUnique: vi.fn(async (args: { where: { key: string } }) => (rows[args.where.key] ? { value: rows[args.where.key] } : null)) as ReachedAtDb["platformConfig"]["findUnique"],
      upsert: vi.fn(async () => ({})) as ReachedAtDb["platformConfig"]["upsert"],
    },
  };
}

const authorityFiles = async (path: string) => {
  if (path.endsWith("root_ca.crt")) return ORG_ROOT_CERT_PEM;
  if (path.endsWith("step-ca-password")) return `${password}\n`;
  throw new Error("ENOENT");
};

function fakeCa(list: unknown[]): CaRequest & { calls: unknown[] } {
  const calls: unknown[] = [];
  const request: CaRequest = async (input) => {
    calls.push(input);
    if (input.method === "GET" && input.path === "/provisioners") return { status: 200, body: { provisioners: list } };
    return { status: 404, body: {} };
  };
  return Object.assign(request, { calls });
}

describe("unlockProvisionerKey", () => {
  it("opens the JWE the way step-ca sealed it and refuses the wrong password", async () => {
    const jwk = await unlockProvisionerKey({ name: installer.name, kid: installer.key.kid, encryptedKey: installer.encryptedKey }, password);
    expect(jwk.kty).toBe("EC");
    expect(jwk.d).toBeTruthy();
    await expect(unlockProvisionerKey({ name: installer.name, kid: installer.key.kid, encryptedKey: installer.encryptedKey }, "nope")).rejects.toThrow();
  });
});

describe("resolveAuthorityHost", () => {
  it("takes the request host unless it is loopback, then the configured base URL, then a host a trusted peer reached us at", async () => {
    expect(await resolveAuthorityHost(db(), { requestHost: "http://192.168.0.152:3000", configuredBaseUrl: null })).toBe("192.168.0.152");
    expect(await resolveAuthorityHost(db(), { requestHost: "http://127.0.0.1:3000", configuredBaseUrl: "https://prod.example" })).toBe("prod.example");
    const reached = db({ [FEDERATION_REACHED_AT_CONFIG]: { schemaVersion: 1, hosts: { "192.168.0.152": now.toISOString() } } });
    expect(await resolveAuthorityHost(reached, { requestHost: "http://localhost:3000", configuredBaseUrl: null })).toBe("192.168.0.152");
    expect(await resolveAuthorityHost(db(), { requestHost: "http://localhost:3000", configuredBaseUrl: null })).toBeNull();
  });
});

describe("issueOrganizationJoinFile", () => {
  it("mints a V2 package the importer accepts, with tokens the CA's provisioner keys verify", async () => {
    const ca = fakeCa([installer, edge]);
    const result = await issueOrganizationJoinFile(
      { intendedPeer: "192.168.0.200", extraSans: ["dev.internal"], requestHost: "http://192.168.0.152:3000", now },
      { db: db(), env: {}, readText: authorityFiles, exists: async () => true, caRequest: ca, configuredBaseUrl: null },
    );
    expect(result.issued).toBe(true);
    if (!result.issued) throw new Error(result.reason);
    expect(result.caUrl).toBe("https://192.168.0.152:9000/");
    expect(result.fileName).toMatch(/^organization-join-192\.168\.0\.200-[a-f0-9]{8}\.dpfjoin$/);
    expect(result.expiresAt).toBe(new Date(now.getTime() + 30 * 60_000).toISOString());
    expect((ca.calls[0] as { caUrl: string; path: string }).caUrl).toBe("https://step-ca:9000");

    const parsed = parseOrganizationJoinPackageMaterial(result.packageText, now);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.value).toMatchObject({ caUrl: "https://192.168.0.152:9000/", intendedPeer: "192.168.0.200", intendedSans: ["dev.internal"], rootFingerprint });

    const { payload, protectedHeader } = await jwtVerify(parsed.value.enrollmentToken, installer.publicKey, { issuer: "dpf-installer", audience: "https://localhost/1.0/sign", subject: "192.168.0.200", currentDate: now });
    expect(protectedHeader.kid).toBe("dpf-installer-kid");
    expect(payload.sans).toEqual(["192.168.0.200", "dev.internal"]);
    expect(payload.sha).toBe(rootFingerprint);
    expect(payload.jti).toMatch(/^[a-f0-9]{64}$/);
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(30 * 60);

    const edgeToken = result.packageText.split("\n").find((l) => l.startsWith("edge_client_enrollment_token="))!.slice("edge_client_enrollment_token=".length);
    const edgeVerified = await jwtVerify(edgeToken, edge.publicKey, { issuer: "dpf-edge-client", subject: "dpf-edge-192.168.0.200", currentDate: now });
    expect(edgeVerified.payload.sans).toEqual(["dpf-edge-192.168.0.200"]);
  });

  it("refuses on an installation that is not the authority, and never dials the CA for a bad peer name", async () => {
    const ca = fakeCa([installer]);
    const member = await issueOrganizationJoinFile(
      { intendedPeer: "192.168.0.200", requestHost: "http://192.168.0.152:3000", now },
      { db: db(), env: {}, readText: async (path) => { if (path.endsWith("root_ca.crt")) return ORG_ROOT_CERT_PEM; throw new Error("ENOENT"); }, exists: async () => false, caRequest: ca, configuredBaseUrl: null },
    );
    expect(member).toMatchObject({ issued: false, reason: "not-the-authority" });
    const bad = await issueOrganizationJoinFile(
      { intendedPeer: "not a host!", requestHost: "http://192.168.0.152:3000", now },
      { db: db(), env: {}, readText: authorityFiles, exists: async () => true, caRequest: ca, configuredBaseUrl: null },
    );
    expect(bad).toMatchObject({ issued: false, reason: "invalid-intended-peer" });
    expect(ca.calls).toHaveLength(0);
  });

  it("reports an unknown own address, an unreachable CA, a missing provisioner and a wrong password as distinct outcomes", async () => {
    const base = { db: db(), env: {}, readText: authorityFiles, exists: async () => true, configuredBaseUrl: null };
    expect(await issueOrganizationJoinFile({ intendedPeer: "192.168.0.200", requestHost: "http://localhost:3000", now }, { ...base, caRequest: fakeCa([installer]) })).toMatchObject({ issued: false, reason: "own-address-unknown" });
    expect(await issueOrganizationJoinFile({ intendedPeer: "192.168.0.200", requestHost: "http://192.168.0.152:3000", now }, { ...base, caRequest: async () => { throw new Error("ECONNREFUSED"); } })).toMatchObject({ issued: false, reason: "ca-unreachable", detail: "ECONNREFUSED" });
    expect(await issueOrganizationJoinFile({ intendedPeer: "192.168.0.200", requestHost: "http://192.168.0.152:3000", now }, { ...base, caRequest: fakeCa([edge]) })).toMatchObject({ issued: false, reason: "provisioner-missing" });
    const wrongPassword = async (path: string) => (path.endsWith("step-ca-password") ? "nope" : authorityFiles(path));
    expect(await issueOrganizationJoinFile({ intendedPeer: "192.168.0.200", requestHost: "http://192.168.0.152:3000", now }, { ...base, readText: wrongPassword, caRequest: fakeCa([installer]) })).toMatchObject({ issued: false, reason: "provisioner-key-locked" });
  });

  it("falls back to the installer provisioner for the edge token when the CA has no edge-client provisioner", async () => {
    const result = await issueOrganizationJoinFile(
      { intendedPeer: "192.168.0.200", requestHost: "http://192.168.0.152:3000", now },
      { db: db(), env: {}, readText: authorityFiles, exists: async () => true, caRequest: fakeCa([installer]), configuredBaseUrl: null },
    );
    expect(result.issued).toBe(true);
  });
});

describe("buildJoinPackageText", () => {
  it("writes the exact V2 layout the host script wrote", () => {
    const text = buildJoinPackageText({ packageId: "a".repeat(32), caUrl: "https://192.168.0.152:9000/", rootFingerprint, intendedPeer: "192.168.0.200", intendedSans: [], expiresAtEpochSeconds: 1, enrollmentToken: "t1", edgeClientEnrollmentToken: "t2" });
    expect(text.split("\n")).toEqual([
      "DPF_ORGANIZATION_JOIN_V2", `package_id=${"a".repeat(32)}`, "ca_url=https://192.168.0.152:9000/", `root_fingerprint=${rootFingerprint}`,
      "intended_hostname=192.168.0.200", "intended_sans=", "expires_at=1", "enrollment_token=t1", "edge_client_enrollment_token=t2", "",
    ]);
  });
});
