// EP-ZERO-CONFIG-FEDERATION §5.6 — membership-proof pairing, runtime half.
//
// Membership material is what importing the organization join file left on
// disk — root_ca.crt (the pinned organization root), authority.crt (this
// installation's certificate, issued by the organization CA) and
// authority.key — in one of the two homes membership-material.ts reads. With
// that material an installation can PROVE membership to a peer at the message
// layer (membership-proof.ts) and ACCEPT a peer's proof — no TLS overlay, no
// invitation token, no click.
//
// The authority installation is the one whose CA issued the join package; its
// portal is reached at the CA host on the portal port (derived, never typed).
// A member enrols with it on every federation tick until a trusted link exists;
// the authority then introduces the other members over the trusted link.
//
// DB and filesystem are injected so the policy runs under unit test.

import { randomUUID } from "node:crypto";

import { prisma } from "@dpf/db";
import type { FederationRole } from "@dpf/db/federation-link-types";
import { parseOrganizationJoinPackage } from "@dpf/db/organization-join-action";
import { normalizeFingerprint } from "@dpf/db/peer-certificate-verification";

import { resolveAppBaseUrl } from "@/lib/app-url";
import { decryptSecret } from "@/lib/govern/credential-crypto";
import { normalizeOrganizationRef } from "@/lib/install/estate-identity-contract";
import { loadEstateNameResolution } from "@/lib/install/estate-identity";
import { getErrorMessage } from "@/lib/shared/get-error-message";

import { postToPeer, type PeerPostResult } from "./client";
import { resolveFederationIdentity, type FederationIdentityDb } from "./demand-identity";
import { createFederationLinkRow } from "./enrollment";
import {
  parseMembershipFacts,
  readMembershipFacts,
  readMembershipMaterial,
  readPinnedRoot,
  type MembershipMaterial,
} from "./membership-material";
import {
  checkMembershipStatement,
  parseMembershipStatement,
  signMembershipStatement,
  splitPemChain,
  verifyMembershipChain,
  verifyMembershipSignature,
  type ChainVerification,
  type MembershipStatement,
} from "./membership-proof";
import { generateLinkToken } from "./tokens";

export { membershipPaths, readMembershipMaterial, readPinnedRoot, type MembershipMaterial } from "./membership-material";

export const ORGANIZATION_ENROLL_PATH = "/api/v1/federation/enroll/organization";
/** PlatformConfig key holding the join-file facts a portal-mediated import recorded. */
export const FEDERATION_MEMBERSHIP_CONFIG_KEY = "federation.membership.v1";
const SAME_ORG_ROLE: FederationRole = "same-org-peer";
const SAME_ORG_PROJECTION = {
  includeSlices: ["demand"],
  excludeSlices: ["localBacklog", "workCapsule", "privatePlanning", "attachments", "customerContext"],
  retentionClass: "standard",
};

export interface MembershipDb extends FederationIdentityDb {
  platformConfig: FederationIdentityDb["platformConfig"] & {
    findUnique(args: unknown): Promise<{ value: unknown } | null>;
  };
  federationLink: {
    findMany(args: unknown): Promise<Array<{ linkId: string; peerAuthorityUrl: string; peerInstallationId: string | null; linkState: string }>>;
  };
  remoteAction?: {
    findFirst(args: unknown): Promise<{ parameters: unknown } | null>;
  };
  $transaction<T>(fn: (tx: Parameters<typeof createFederationLinkRow>[0]) => Promise<T>): Promise<T>;
}

async function localOrganizationRef(db: MembershipDb, env?: Record<string, string | undefined>): Promise<string | null> {
  const resolution = await loadEstateNameResolution(
    { readConfig: async (key: string) => (await db.platformConfig.findUnique({ where: { key }, select: { value: true } }))?.value ?? null },
    env ? { env } : {},
  );
  return normalizeOrganizationRef(resolution.estateName);
}

export interface MembershipProofEnvelope {
  statement: MembershipStatement;
  signature: string;
  certificateChain: string[];
}

/** Build and sign this installation's proof for a given audience root. */
export async function buildMembershipProof(
  db: MembershipDb,
  input: {
    material: MembershipMaterial;
    audienceRootFingerprint: string;
    authorityUrl: string;
    callbackToken: string | null;
    displayName: string;
    now?: Date;
    env?: Record<string, string | undefined>;
  },
): Promise<MembershipProofEnvelope | { error: "no-organization-ref" }> {
  const organizationRef = await localOrganizationRef(db, input.env);
  if (!organizationRef) return { error: "no-organization-ref" };
  const identity = await resolveFederationIdentity(db);
  const statement: MembershipStatement = {
    version: "dpf.membership-statement/1",
    installationId: identity.installationId,
    deviceId: identity.deviceId ?? null,
    organizationRef,
    authorityUrl: input.authorityUrl,
    rootFingerprint: input.material.rootFingerprint,
    audienceRootFingerprint: normalizeFingerprint(input.audienceRootFingerprint) ?? input.audienceRootFingerprint,
    callbackToken: input.callbackToken,
    displayName: input.displayName,
    nonce: randomUUID().replaceAll("-", ""),
    issuedAt: (input.now ?? new Date()).toISOString(),
  };
  return {
    statement,
    signature: signMembershipStatement(input.material.keyPem, statement),
    certificateChain: splitPemChain(input.material.certPem),
  };
}

export type ProofVerdict =
  | { accepted: true; statement: MembershipStatement; chain: ChainVerification }
  | { accepted: false; reason: string };

/** Verify a peer's proof against our pinned root and organization. Fails closed. */
export async function verifyMembershipProof(
  db: MembershipDb,
  input: { envelope: unknown; rootPem: string; rootFingerprint: string; now?: Date; env?: Record<string, string | undefined> },
): Promise<ProofVerdict> {
  const now = input.now ?? new Date();
  const env = input.envelope as Partial<MembershipProofEnvelope> | null;
  if (!env || typeof env !== "object") return { accepted: false, reason: "malformed" };
  const statement = parseMembershipStatement(env.statement);
  if (!statement) return { accepted: false, reason: "malformed-statement" };
  if (typeof env.signature !== "string" || !Array.isArray(env.certificateChain)) return { accepted: false, reason: "malformed" };
  const chainPems = env.certificateChain.filter((v): v is string => typeof v === "string");
  const chain = verifyMembershipChain({ chainPems, pinnedRootPem: input.rootPem, now });
  if (!chain.verified) return { accepted: false, reason: `chain:${chain.failure}` };
  const leaf = splitPemChain(chainPems)[0]!;
  if (!verifyMembershipSignature(leaf, statement, env.signature)) return { accepted: false, reason: "signature-invalid" };
  const organizationRef = await localOrganizationRef(db, input.env);
  if (!organizationRef) return { accepted: false, reason: "no-local-organization" };
  const check = checkMembershipStatement({ statement, chain, localRootFingerprint: input.rootFingerprint, localOrganizationRef: organizationRef, now });
  if (!check.accepted) return { accepted: false, reason: check.reason };
  return { accepted: true, statement, chain };
}

/** Create a link born trusted on organization evidence. `approvedByPrincipalId` stays null on purpose. */
export async function createTrustedOrganizationLink(
  db: MembershipDb,
  input: { statement: MembershipStatement; chain: ChainVerification; now?: Date },
): Promise<{ linkId: string; linkToken: string }> {
  const now = input.now ?? new Date();
  const linkId = `link_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const inbound = generateLinkToken();
  await db.$transaction(async (tx) => {
    await createFederationLinkRow(tx, {
      linkId,
      role: SAME_ORG_ROLE,
      peerAuthorityUrl: input.statement.authorityUrl,
      displayName: input.statement.displayName,
      peerOrganizationRef: input.statement.organizationRef,
      peerDeviceId: input.statement.deviceId,
      peerInstallationId: input.statement.installationId,
      localOrganizationId: null,
      inboundToken: { hash: inbound.hash, prefix: inbound.prefix },
      callbackToken: input.statement.callbackToken,
      approvedAtLocal: now,
      approvedAtPeer: now,
      approvedByPrincipalId: null,
      now,
      metadata: {
        proposedProjection: SAME_ORG_PROJECTION,
        proposedAuthorityBand: null,
        confirmationProvenance: "organization-trust",
        organizationTrustEvidence: {
          presentedRootFingerprint: input.chain.presentedRootFingerprint,
          leafFingerprint: input.chain.leafFingerprint,
          leafSubject: input.chain.leafSubject,
          decidedAt: now.toISOString(),
        },
      },
    });
  });
  return { linkId, linkToken: inbound.plaintext };
}

/**
 * Receiver side of the handshake. Verifies the peer's proof, creates the link
 * trusted, and answers with OUR proof (so the peer verifies us too) and the
 * token it must use to call us.
 */
export async function acceptOrganizationEnrolment(
  db: MembershipDb,
  input: { envelope: unknown; localAuthorityUrl: string; displayName: string; now?: Date; env?: Record<string, string | undefined>; readText?: (path: string) => Promise<string> },
): Promise<
  | { accepted: true; linkId: string; linkToken: string; proof: MembershipProofEnvelope | null }
  | { accepted: false; status: number; reason: string }
> {
  const root = await readPinnedRoot({ env: input.env, readText: input.readText });
  if (!root) return { accepted: false, status: 404, reason: "organization-trust-not-configured" };
  const verdict = await verifyMembershipProof(db, { envelope: input.envelope, rootPem: root.rootPem, rootFingerprint: root.rootFingerprint, now: input.now, env: input.env });
  if (!verdict.accepted) return { accepted: false, status: 403, reason: verdict.reason };
  const created = await createTrustedOrganizationLink(db, { statement: verdict.statement, chain: verdict.chain, now: input.now });
  // Our own proof back, when we hold a member certificate (an authority may
  // hold only the root; the peer then trusts the link on the token exchange).
  const material = await readMembershipMaterial({ env: input.env, readText: input.readText });
  let proof: MembershipProofEnvelope | null = null;
  if (material) {
    const built = await buildMembershipProof(db, {
      material,
      audienceRootFingerprint: verdict.statement.rootFingerprint,
      authorityUrl: input.localAuthorityUrl,
      callbackToken: null,
      displayName: input.displayName,
      now: input.now,
      env: input.env,
    });
    if (!("error" in built)) proof = built;
  }
  return { accepted: true, linkId: created.linkId, linkToken: created.linkToken, proof };
}

/**
 * What the join package this installation imported says about the
 * organization: the CA host (where the authority lives) and the hostname the
 * package was issued for (this installation's own reachable name). Expiry is
 * ignored on purpose — the package was consumed long ago; its facts still hold.
 *
 * Read order: the PlatformConfig row a portal-mediated import wrote, then the
 * facts file beside the material (a fresh database re-reads it), then the
 * completed `organization.join.import` host action a script-era member left.
 */
export async function readJoinPackageFacts(
  db: MembershipDb,
  decrypt: (stored: string) => string | null = decryptSecret,
  options: { env?: Record<string, string | undefined>; readText?: (path: string) => Promise<string> } = {},
): Promise<{ caUrl: string; intendedPeer: string; rootFingerprint: string } | null> {
  const row = await db.platformConfig.findUnique({ where: { key: FEDERATION_MEMBERSHIP_CONFIG_KEY }, select: { value: true } });
  const recorded = parseMembershipFacts(row?.value);
  if (recorded) return { caUrl: recorded.caUrl, intendedPeer: recorded.intendedPeer, rootFingerprint: recorded.rootFingerprint };
  const onDisk = await readMembershipFacts(options);
  if (onDisk) return { caUrl: onDisk.caUrl, intendedPeer: onDisk.intendedPeer, rootFingerprint: onDisk.rootFingerprint };
  if (!db.remoteAction) return null;
  const record = await db.remoteAction.findFirst({
    where: { actionType: "organization.join.import", status: "completed" },
    orderBy: { createdAt: "desc" },
    select: { parameters: true },
  });
  const stored = record && typeof record.parameters === "object" && record.parameters !== null
    ? (record.parameters as Record<string, unknown>)["joinPackageEnc"]
    : null;
  if (typeof stored !== "string" || !stored) return null;
  let plaintext: string | null = null;
  try {
    plaintext = decrypt(stored);
  } catch {
    plaintext = null;
  }
  if (!plaintext) return null;
  const parsed = parseOrganizationJoinPackage(plaintext, new Date(0));
  if (!parsed.ok) return null;
  return { caUrl: parsed.value.caUrl, intendedPeer: parsed.value.intendedPeer, rootFingerprint: parsed.value.rootFingerprint.toLowerCase() };
}

/** The authority's portal is reached at the CA host on the portal port. Derived, never typed. */
export function deriveAuthorityPortalUrls(caUrl: string, portalPort = 3000): string[] {
  try {
    const url = new URL(caUrl);
    const host = url.hostname.includes(":") ? `[${url.hostname}]` : url.hostname;
    return [`http://${host}:${portalPort}`, `https://${host}`];
  } catch {
    return [];
  }
}

/**
 * Member side: prove membership to the authority and record the link trusted.
 * Tries each derived portal URL until one answers; a peer that predates this
 * route (404) is reported, never treated as a refusal.
 */
export async function enrolWithOrganizationAuthority(
  db: MembershipDb,
  input: {
    material: MembershipMaterial;
    authorityUrls: string[];
    localAuthorityUrl: string;
    displayName: string;
    now?: Date;
    env?: Record<string, string | undefined>;
    post?: typeof postToPeer;
  },
): Promise<{ enrolled: true; linkId: string; authorityUrl: string } | { enrolled: false; reason: string }> {
  const callback = generateLinkToken();
  const post = input.post ?? postToPeer;
  let last: PeerPostResult | null = null;
  for (const authorityUrl of input.authorityUrls) {
    const built = await buildMembershipProof(db, {
      material: input.material,
      // Same organization: the audience root IS our root.
      audienceRootFingerprint: input.material.rootFingerprint,
      authorityUrl: input.localAuthorityUrl,
      callbackToken: callback.plaintext,
      displayName: input.displayName,
      now: input.now,
      env: input.env,
    });
    if ("error" in built) return { enrolled: false, reason: built.error };
    const res = await post({ peerAuthorityUrl: authorityUrl, linkToken: "dpflink_organization-proof", path: ORGANIZATION_ENROLL_PATH, cloudEvent: built, sameOrgLan: true });
    last = res;
    if (!res.ok) continue;
    const body = res.body as { linkId?: string; linkToken?: string; proof?: unknown } | undefined;
    if (typeof body?.linkToken !== "string" || !body.linkToken.startsWith("dpflink_")) { last = { ok: false, status: res.status, error: "malformed-response" }; continue; }
    // Verify the authority's own proof when it sent one.
    let peerStatement: MembershipStatement | null = null;
    let peerChain: ChainVerification | null = null;
    if (body.proof) {
      const verdict = await verifyMembershipProof(db, { envelope: body.proof, rootPem: input.material.rootPem, rootFingerprint: input.material.rootFingerprint, now: input.now, env: input.env });
      if (!verdict.accepted) return { enrolled: false, reason: `authority-proof:${verdict.reason}` };
      peerStatement = verdict.statement;
      peerChain = verdict.chain;
    }
    const now = input.now ?? new Date();
    const linkId = `link_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    await db.$transaction(async (tx) => {
      await createFederationLinkRow(tx, {
        linkId,
        role: SAME_ORG_ROLE,
        peerAuthorityUrl: authorityUrl,
        displayName: peerStatement?.displayName ?? "Organization authority",
        peerOrganizationRef: peerStatement?.organizationRef ?? null,
        peerDeviceId: peerStatement?.deviceId ?? null,
        peerInstallationId: peerStatement?.installationId ?? null,
        localOrganizationId: null,
        inboundToken: { hash: callback.hash, prefix: callback.prefix },
        callbackToken: body.linkToken ?? null,
        approvedAtLocal: now,
        approvedAtPeer: now,
        approvedByPrincipalId: null,
        now,
        metadata: {
          proposedProjection: SAME_ORG_PROJECTION,
          proposedAuthorityBand: null,
          confirmationProvenance: "organization-trust",
          organizationTrustEvidence: peerChain
            ? { presentedRootFingerprint: peerChain.presentedRootFingerprint, leafFingerprint: peerChain.leafFingerprint, decidedAt: now.toISOString() }
            : { tokenExchangeOnly: true, decidedAt: now.toISOString() },
        },
      });
    });
    return { enrolled: true, linkId, authorityUrl };
  }
  return { enrolled: false, reason: last ? `peer responded ${last.status}${last.error ? `: ${last.error}` : ""}` : "no-authority-url" };
}

/**
 * Cadence hook: a member with organization material and no trusted link to
 * its authority enrols now. Returns what it did; never throws.
 */
export async function reconcileOrganizationMembership(
  db: MembershipDb = prisma as unknown as MembershipDb,
  deps: {
    env?: Record<string, string | undefined>;
    readText?: (path: string) => Promise<string>;
    post?: typeof postToPeer;
    caUrl?: string | null;
    localAuthorityUrl?: string | null;
    now?: Date;
  } = {},
): Promise<{ outcome: "not-a-member" | "no-authority" | "already-linked" | "enrolled" | "failed"; detail?: string }> {
  try {
    const env = deps.env ?? process.env;
    const material = await readMembershipMaterial({ env, readText: deps.readText });
    if (!material) return { outcome: "not-a-member" };
    const facts = await readJoinPackageFacts(db, decryptSecret, { env, readText: deps.readText });
    const caUrl = deps.caUrl ?? facts?.caUrl ?? env.DPF_ORGANIZATION_CA_URL ?? null;
    if (!caUrl) return { outcome: "no-authority", detail: "No organization CA URL is recorded on this installation." };
    const authorityUrls = deriveAuthorityPortalUrls(caUrl);
    // Our own reachable address: the hostname the join package was issued for,
    // else the configured base URL. Never typed by an operator.
    const localAuthorityUrl = deps.localAuthorityUrl
      ?? (facts?.intendedPeer ? `http://${facts.intendedPeer}:3000` : null)
      ?? resolveAppBaseUrl()
      ?? null;
    if (!localAuthorityUrl) return { outcome: "no-authority", detail: "This installation does not know its own reachable address yet." };
    // Already linked to the authority host? Then nothing to do.
    const hosts = new Set(authorityUrls.map((u) => new URL(u).hostname.toLowerCase()));
    const links = await db.federationLink.findMany({
      where: { role: SAME_ORG_ROLE, revokedAt: null, linkState: "trusted" },
      select: { linkId: true, peerAuthorityUrl: true, peerInstallationId: true, linkState: true },
    });
    const own = new URL(localAuthorityUrl).hostname.toLowerCase();
    if (hosts.has(own)) return { outcome: "already-linked", detail: "This installation is the organization authority." };
    if (links.some((link) => { try { return hosts.has(new URL(link.peerAuthorityUrl).hostname.toLowerCase()); } catch { return false; } })) {
      return { outcome: "already-linked" };
    }
    const displayName = (await localOrganizationRef(db, env)) ?? "Member installation";
    const result = await enrolWithOrganizationAuthority(db, {
      material, authorityUrls, localAuthorityUrl, displayName, now: deps.now, env, post: deps.post,
    });
    if (!result.enrolled) return { outcome: "failed", detail: result.reason };
    console.log(`[federation] enrolled with the organization authority at ${result.authorityUrl} as ${result.linkId} (organization-trust)`);
    return { outcome: "enrolled", detail: result.linkId };
  } catch (error) {
    return { outcome: "failed", detail: getErrorMessage(error) };
  }
}
