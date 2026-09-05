import { X509Certificate } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/app-url", () => ({ resolveAppBaseUrl: () => null }));

import { deriveDeviceId, generateInstanceSigningKeypair } from "./instance-identity";
import {
  FOREIGN_ROOT_CERT_PEM,
  MEMBER_CERT_PEM,
  MEMBER_KEY_PKCS8_B64,
  ORG_ROOT_CERT_PEM,
  STRANGER_CERT_PEM,
  STRANGER_KEY_PKCS8_B64,
} from "./membership-fixtures";
import {
  acceptOrganizationEnrolment,
  buildMembershipProof,
  deriveAuthorityPortalUrls,
  enrolWithOrganizationAuthority,
  readJoinPackageFacts,
  readMembershipMaterial,
  reconcileOrganizationMembership,
  type MembershipDb,
  type MembershipMaterial,
} from "./organization-membership";

const now = new Date("2026-09-02T21:00:00.000Z");
const rootFingerprint = new X509Certificate(ORG_ROOT_CERT_PEM).fingerprint256.replaceAll(":", "").toLowerCase();
const kp = generateInstanceSigningKeypair();

// PKCS8 DER base64 wrapped as PEM at test time; the fixtures keep DER so no
// PEM-shaped private key ever sits in the repository.
const pem = (der: string) => `-----BEGIN ${"PRIVATE KEY"}-----
${der}
-----END ${"PRIVATE KEY"}-----`;

const memberMaterial: MembershipMaterial = {
  rootPem: ORG_ROOT_CERT_PEM, rootFingerprint, certPem: MEMBER_CERT_PEM,
  keyPem: pem(MEMBER_KEY_PKCS8_B64),
};

/** A mock database for one installation: identity row, estate name, links, transactions. */
function installation(name: string, options: { links?: Array<{ linkId: string; peerAuthorityUrl: string; peerInstallationId: string | null; linkState: string }> } = {}) {
  const identity = {
    installationId: `inst_${name.padEnd(32, "0").slice(0, 32).replace(/[^a-f0-9]/g, "0")}`,
    projectionSecret: "a".repeat(64),
    deviceId: deriveDeviceId(kp.signingPublicKey),
    signingPublicKey: kp.signingPublicKey,
    signingPrivateKeyEnc: "enc:" + kp.signingPrivateKey,
  };
  const created: Array<Record<string, unknown>> = [];
  const tx = {
    principal: { create: vi.fn(async () => ({ id: `principal-${created.length}` })) },
    principalAlias: { create: vi.fn() },
    federationLink: { create: vi.fn(async (args: { data: Record<string, unknown> }) => { created.push(args.data); return { id: `link-row-${created.length}` }; }) },
  };
  const db = {
    platformConfig: {
      upsert: vi.fn().mockResolvedValue({ value: identity }),
      update: vi.fn(),
      findUnique: vi.fn(async (args: { where: { key: string } }) =>
        args.where.key === "installation.estate-identity.v1"
          ? { value: { schemaVersion: 1, estateName: "Northwind Test", source: "operator", declaredAt: now.toISOString(), declaredByPrincipalId: "PRN-1" } }
          : null),
    },
    federationLink: { findMany: vi.fn().mockResolvedValue(options.links ?? []) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { db: db as unknown as MembershipDb, created, identity };
}

const readMember = async (path: string) => {
  if (path.endsWith("root_ca.crt")) return ORG_ROOT_CERT_PEM;
  if (path.endsWith("authority.crt")) return MEMBER_CERT_PEM;
  if (path.endsWith("authority.key")) return memberMaterial.keyPem;
  throw new Error("missing");
};
const readAuthorityRootOnly = async (path: string) => {
  if (path.endsWith("root_ca.crt")) return ORG_ROOT_CERT_PEM;
  throw new Error("missing");
};

describe("readMembershipMaterial", () => {
  it("returns the material when the certificate chains to the root, null otherwise", async () => {
    const material = await readMembershipMaterial({ readText: readMember });
    expect(material?.rootFingerprint).toBe(rootFingerprint);
    expect(await readMembershipMaterial({ readText: readAuthorityRootOnly })).toBeNull();
    const foreign = async (path: string) => (path.endsWith("root_ca.crt") ? FOREIGN_ROOT_CERT_PEM : readMember(path));
    expect(await readMembershipMaterial({ readText: foreign })).toBeNull();
  });
});

describe("acceptOrganizationEnrolment", () => {
  it("creates a trusted link from a valid proof and answers with the receiver's own proof", async () => {
    const member = installation("member");
    const authority = installation("authority");
    const built = await buildMembershipProof(member.db, {
      material: memberMaterial, audienceRootFingerprint: rootFingerprint, authorityUrl: "http://192.168.0.200:3000",
      callbackToken: "dpflink_member-callback", displayName: "Development", now,
    });
    expect("error" in built).toBe(false);

    const result = await acceptOrganizationEnrolment(authority.db, {
      envelope: built, localAuthorityUrl: "http://192.168.0.152:3000", displayName: "Production", now, readText: readMember,
    });
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.linkToken).toMatch(/^dpflink_/);
    expect(authority.created[0]).toMatchObject({
      role: "same-org-peer", linkState: "trusted", peerAuthorityUrl: "http://192.168.0.200:3000",
      peerInstallationId: member.identity.installationId, approvedByPrincipalId: null,
    });
    expect((authority.created[0]!.metadata as { confirmationProvenance: string }).confirmationProvenance).toBe("organization-trust");
    expect(result.proof?.statement.audienceRootFingerprint).toBe(rootFingerprint);
  });

  it("refuses a stranger's certificate, a wrong organization, a tampered statement, and an install without a root", async () => {
    const member = installation("member");
    const authority = installation("authority");
    const built = await buildMembershipProof(member.db, {
      material: memberMaterial, audienceRootFingerprint: rootFingerprint, authorityUrl: "http://192.168.0.200:3000",
      callbackToken: null, displayName: "Development", now,
    });
    if ("error" in built) throw new Error("unexpected");

    const stranger = { ...built, certificateChain: [STRANGER_CERT_PEM] };
    expect(await acceptOrganizationEnrolment(authority.db, { envelope: stranger, localAuthorityUrl: "http://x", displayName: "P", now, readText: readAuthorityRootOnly }))
      .toMatchObject({ accepted: false, status: 403, reason: "chain:issuer-mismatch" });

    const tampered = { ...built, statement: { ...built.statement, displayName: "Evil" } };
    expect(await acceptOrganizationEnrolment(authority.db, { envelope: tampered, localAuthorityUrl: "http://x", displayName: "P", now, readText: readAuthorityRootOnly }))
      .toMatchObject({ accepted: false, status: 403, reason: "signature-invalid" });

    const otherOrg = installation("other");
    (otherOrg.db.platformConfig.findUnique as ReturnType<typeof vi.fn>).mockImplementation(async (args: { where: { key: string } }) =>
      args.where.key === "installation.estate-identity.v1"
        ? { value: { schemaVersion: 1, estateName: "Someone Else", source: "operator", declaredAt: now.toISOString(), declaredByPrincipalId: "PRN-1" } }
        : null);
    expect(await acceptOrganizationEnrolment(otherOrg.db, { envelope: built, localAuthorityUrl: "http://x", displayName: "P", now, readText: readAuthorityRootOnly }))
      .toMatchObject({ accepted: false, status: 403, reason: "organization-ref-mismatch" });

    expect(await acceptOrganizationEnrolment(authority.db, { envelope: built, localAuthorityUrl: "http://x", displayName: "P", now, readText: async () => { throw new Error("no pki"); } }))
      .toMatchObject({ accepted: false, status: 404, reason: "organization-trust-not-configured" });
    expect(authority.created).toHaveLength(0);
  });
});

describe("readJoinPackageFacts", () => {
  it("reads the portal-mediated facts row first and only then the script-era host action", async () => {
    const facts = { schemaVersion: 1, caUrl: "https://192.168.0.152:9000", intendedPeer: "192.168.0.200", rootFingerprint, packageId: "b".repeat(32), joinedAt: now.toISOString() };
    const remoteAction = { findFirst: vi.fn().mockResolvedValue(null) };
    const db = {
      platformConfig: { findUnique: vi.fn(async (args: { where: { key: string } }) => (args.where.key === "federation.membership.v1" ? { value: facts } : null)) },
      federationLink: { findMany: vi.fn().mockResolvedValue([]) },
      remoteAction,
      $transaction: vi.fn(),
    } as unknown as MembershipDb;
    expect(await readJoinPackageFacts(db, () => null, { readText: async () => { throw new Error("ENOENT"); } })).toEqual({
      caUrl: "https://192.168.0.152:9000", intendedPeer: "192.168.0.200", rootFingerprint,
    });
    expect(remoteAction.findFirst).not.toHaveBeenCalled();

    const empty = { ...db, platformConfig: { findUnique: vi.fn().mockResolvedValue(null) } } as unknown as MembershipDb;
    expect(await readJoinPackageFacts(empty, () => null, { readText: async () => { throw new Error("ENOENT"); } })).toBeNull();
    expect(remoteAction.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe("enrolWithOrganizationAuthority + reconcile", () => {
  it("member enrols with the authority, verifies the authority's proof, and records a trusted link", async () => {
    const member = installation("member");
    const authority = installation("authority");
    // The fake network: the authority accepts whatever the member posts.
    const post = vi.fn(async (input: { peerAuthorityUrl: string; cloudEvent: unknown }) => {
      const accepted = await acceptOrganizationEnrolment(authority.db, {
        envelope: input.cloudEvent, localAuthorityUrl: input.peerAuthorityUrl, displayName: "Production", now, readText: readMember,
      });
      if (!accepted.accepted) return { ok: false, status: accepted.status, body: { ok: false, reason: accepted.reason } };
      return { ok: true, status: 201, body: { linkId: accepted.linkId, linkToken: accepted.linkToken, proof: accepted.proof } };
    });
    const result = await enrolWithOrganizationAuthority(member.db, {
      material: memberMaterial, authorityUrls: ["http://192.168.0.152:3000"], localAuthorityUrl: "http://192.168.0.200:3000",
      displayName: "Development", now, post: post as never,
    });
    expect(result).toMatchObject({ enrolled: true, authorityUrl: "http://192.168.0.152:3000" });
    expect(member.created[0]).toMatchObject({ role: "same-org-peer", linkState: "trusted", peerAuthorityUrl: "http://192.168.0.152:3000", peerInstallationId: authority.identity.installationId });
    expect(authority.created[0]).toMatchObject({ linkState: "trusted", peerInstallationId: member.identity.installationId });
    // The authority's callback token is stored encrypted on the member's link.
    expect(typeof member.created[0]!.peerTokenEnc).toBe("string");
  });

  it("refuses an authority whose proof chains to another root, and reports a peer that predates the route", async () => {
    const member = installation("member");
    const strangerProof = await buildMembershipProof(installation("stranger").db, {
      material: { rootPem: FOREIGN_ROOT_CERT_PEM, rootFingerprint: "f".repeat(64), certPem: STRANGER_CERT_PEM, keyPem: pem(STRANGER_KEY_PKCS8_B64) },
      audienceRootFingerprint: rootFingerprint, authorityUrl: "http://evil", callbackToken: null, displayName: "Evil", now,
    });
    const post = vi.fn(async () => ({ ok: true, status: 201, body: { linkId: "link_x", linkToken: "dpflink_x", proof: strangerProof } }));
    expect(await enrolWithOrganizationAuthority(member.db, { material: memberMaterial, authorityUrls: ["http://192.168.0.152:3000"], localAuthorityUrl: "http://m", displayName: "D", now, post: post as never }))
      .toMatchObject({ enrolled: false, reason: expect.stringContaining("authority-proof:chain:") });
    expect(member.created).toHaveLength(0);

    const old = vi.fn(async () => ({ ok: false, status: 404 }));
    expect(await enrolWithOrganizationAuthority(member.db, { material: memberMaterial, authorityUrls: ["http://192.168.0.152:3000"], localAuthorityUrl: "http://m", displayName: "D", now, post: old as never }))
      .toMatchObject({ enrolled: false, reason: "peer responded 404" });
  });

  it("reconcile: not a member without material; already linked when a trusted link to the authority host exists", async () => {
    const none = installation("none");
    expect(await reconcileOrganizationMembership(none.db, { readText: async () => { throw new Error("missing"); } })).toEqual({ outcome: "not-a-member" });

    const linked = installation("member", { links: [{ linkId: "link_1", peerAuthorityUrl: "http://192.168.0.152:3000", peerInstallationId: null, linkState: "trusted" }] });
    expect(await reconcileOrganizationMembership(linked.db, { readText: readMember, caUrl: "https://192.168.0.152:9000", localAuthorityUrl: "http://192.168.0.200:3000" }))
      .toEqual({ outcome: "already-linked" });

    expect(deriveAuthorityPortalUrls("https://192.168.0.152:9000")).toEqual(["http://192.168.0.152:3000", "https://192.168.0.152"]);
    expect(deriveAuthorityPortalUrls("nope")).toEqual([]);
  });
});
