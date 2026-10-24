// EP-ZERO-CONFIG-FEDERATION — importing the organization join file, member side.
// Spec: docs/superpowers/specs/2026-09-03-portal-mediated-organization-membership-design.md §5.2.
//
// Choosing the join file IS joining. Everything runs inside this portal:
//   1. parse and validate the file; refuse one intended for another host
//      before any network call;
//   2. generate a keypair and a CSR for the intended hostname and SANs;
//   3. ask the authority's PORTAL (derived from the CA URL, never typed) to
//      have the organization CA sign it;
//   4. verify the returned chain against the root fingerprint the file pins;
//   5. write the material under the federation state directory and record the
//      facts; the next federation tick enrols and the link is born trusted.
// No edge node, no host script, no overlay, no `.env` line.

import { createPublicKey, X509Certificate } from "node:crypto";

import { prisma } from "@dpf/db";
import { parseOrganizationJoinPackageMaterial } from "@dpf/db/organization-join-action";

import { resolveAppBaseUrl } from "@/lib/app-url";
import { getErrorMessage } from "@/lib/shared/get-error-message";

import { postToPeer } from "./client";
import { buildCertificateSigningRequest, classifySan, generateMembershipKeypair } from "./csr";
import { splitPemChain, verifyMembershipChain } from "./membership-proof";
import { writeMembershipMaterial, type MembershipFactsV1 } from "./membership-material";
import { MEMBERSHIP_SIGN_PATH, MEMBERSHIP_SIGN_SPEC } from "./membership-relay";
import { deriveAuthorityPortalUrls, FEDERATION_MEMBERSHIP_CONFIG_KEY } from "./organization-membership";
import { readReachedAtHosts, type ReachedAtDb } from "./reached-at";

export type JoinImportDb = ReachedAtDb;

export type JoinImportRefusal =
  | "invalid-join-file"
  | "join-package-expired"
  | "intended-for-another-host"
  | "authority-unreachable"
  | "authority-refused"
  | "chain-untrusted"
  | "material-not-writable";

export type JoinImportResult =
  | { imported: true; authorityUrl: string; caUrl: string; intendedPeer: string; expiresAt: string; materialDir: string }
  | { imported: false; reason: JoinImportRefusal; detail?: string };

function hostnameOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.includes("://") ? url : `http://${url}`).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * The hostnames this installation answers to, none of them typed: the
 * configured base URL, the host the current request arrived on, and the hosts
 * trusted peers have reached us at.
 */
export async function ownAddresses(
  db: JoinImportDb,
  input: { requestHost?: string | null; configuredBaseUrl?: string | null } = {},
): Promise<Set<string>> {
  const out = new Set<string>();
  const configured = input.configuredBaseUrl === undefined ? resolveAppBaseUrl() : input.configuredBaseUrl;
  for (const candidate of [hostnameOf(configured), hostnameOf(input.requestHost), ...(await readReachedAtHosts(db))]) {
    if (candidate) out.add(classifySan(candidate).value);
  }
  return out;
}

/** The leaf must certify OUR key; a certificate for any other key is useless and suspect. */
function certifiesKey(chainPems: readonly string[], publicKeyPem: string): boolean {
  try {
    const leaf = new X509Certificate(splitPemChain(chainPems)[0] ?? "");
    const ours = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
    return leaf.publicKey.export({ type: "spki", format: "der" }).equals(ours);
  } catch {
    return false;
  }
}

function fingerprintOf(pem: string): string | null {
  try {
    return new X509Certificate(pem).fingerprint256.replaceAll(":", "").toLowerCase();
  } catch {
    return null;
  }
}

export async function importOrganizationJoinFile(
  input: { fileText: string; requestHost?: string | null; now?: Date },
  deps: {
    db?: JoinImportDb;
    env?: Record<string, string | undefined>;
    configuredBaseUrl?: string | null;
    post?: typeof postToPeer;
    write?: typeof writeMembershipMaterial;
    generateKeypair?: typeof generateMembershipKeypair;
  } = {},
): Promise<JoinImportResult> {
  const db = deps.db ?? (prisma as unknown as JoinImportDb);
  const now = input.now ?? new Date();

  // 1. The file, and whom it is for — refused before any network call.
  const parsed = parseOrganizationJoinPackageMaterial(input.fileText, now);
  if (!parsed.ok) {
    return { imported: false, reason: parsed.reason === "join-package-expired" ? "join-package-expired" : "invalid-join-file", detail: parsed.reason };
  }
  const pkg = parsed.value;
  const own = await ownAddresses(db, { requestHost: input.requestHost, configuredBaseUrl: deps.configuredBaseUrl });
  if (!own.has(classifySan(pkg.intendedPeer).value)) {
    return { imported: false, reason: "intended-for-another-host", detail: `the file is for ${pkg.intendedPeer}` };
  }

  // 2. A key that never leaves this machine, and the request to certify it.
  const keypair = (deps.generateKeypair ?? generateMembershipKeypair)();
  const csrPem = buildCertificateSigningRequest({ privateKeyPem: keypair.privateKeyPem, commonName: pkg.intendedPeer, extraSans: pkg.intendedSans });

  // 3. The authority's portal, derived from the CA URL exactly as enrolment does.
  const authorityUrls = deriveAuthorityPortalUrls(pkg.caUrl);
  if (authorityUrls.length === 0) return { imported: false, reason: "invalid-join-file", detail: "the CA URL names no host" };
  const memberAddress = `http://${pkg.intendedPeer.includes(":") ? `[${pkg.intendedPeer}]` : pkg.intendedPeer}:3000`;
  const post = deps.post ?? postToPeer;
  let answer: { certPem: string; chainPems: string[]; rootPem: string; authorityUrl: string } | null = null;
  let failure: { reason: JoinImportRefusal; detail: string } | null = null;
  for (const authorityUrl of authorityUrls) {
    const res = await post({
      peerAuthorityUrl: authorityUrl,
      linkToken: "dpflink_membership-sign",
      path: MEMBERSHIP_SIGN_PATH,
      cloudEvent: { spec: MEMBERSHIP_SIGN_SPEC, csrPem, enrollmentToken: pkg.enrollmentToken, memberAddress },
      sameOrgLan: true,
    });
    const body = res.body as { accepted?: boolean; reason?: string; detail?: string; certPem?: string; chainPems?: unknown; rootPem?: string } | undefined;
    if (res.ok && body?.accepted === true && typeof body.certPem === "string" && typeof body.rootPem === "string") {
      const chainPems = Array.isArray(body.chainPems) ? body.chainPems.filter((v): v is string => typeof v === "string") : [];
      answer = { certPem: body.certPem, chainPems: chainPems.length ? chainPems : [body.certPem], rootPem: body.rootPem, authorityUrl };
      break;
    }
    if (res.status === 404) {
      failure = { reason: "authority-unreachable", detail: `${authorityUrl} has no membership relay (the organization installation needs the current release)` };
      continue;
    }
    if (body && body.accepted === false) {
      failure = { reason: "authority-refused", detail: `${body.reason ?? "refused"}${body.detail ? `: ${body.detail}` : ""}` };
      // The CA's verdict is final; a second portal URL would spend nothing more.
      break;
    }
    failure = { reason: "authority-unreachable", detail: res.error ? `${authorityUrl}: ${res.error}` : `${authorityUrl} answered ${res.status}` };
  }
  if (!answer) return { imported: false, reason: failure?.reason ?? "authority-unreachable", detail: failure?.detail };

  // 4. Trust only a chain that ends at the root the file pins.
  const pinnedFingerprint = pkg.rootFingerprint.toLowerCase();
  const returnedRootFingerprint = fingerprintOf(answer.rootPem);
  if (!returnedRootFingerprint || returnedRootFingerprint !== pinnedFingerprint) {
    return { imported: false, reason: "chain-untrusted", detail: "the authority returned a root other than the one the join file pins" };
  }
  const chain = verifyMembershipChain({ chainPems: answer.chainPems, pinnedRootPem: answer.rootPem, now });
  if (!chain.verified) return { imported: false, reason: "chain-untrusted", detail: chain.failure ?? undefined };
  if (!certifiesKey(answer.chainPems, keypair.publicKeyPem)) {
    return { imported: false, reason: "chain-untrusted", detail: "the certificate is not for the key this installation generated" };
  }
  // Keep the leaf and any intermediates; the pinned root lives in its own file.
  const certPem = splitPemChain(answer.chainPems).filter((pem) => fingerprintOf(pem) !== pinnedFingerprint).join("\n");

  // 5. Material and facts on disk, facts in the database.
  const facts: MembershipFactsV1 = {
    schemaVersion: 1,
    caUrl: pkg.caUrl,
    intendedPeer: pkg.intendedPeer,
    rootFingerprint: pinnedFingerprint,
    packageId: pkg.packageId,
    joinedAt: now.toISOString(),
  };
  const written = await (deps.write ?? writeMembershipMaterial)({ rootPem: answer.rootPem, certPem, keyPem: keypair.privateKeyPem, facts }, { env: deps.env });
  if (!written.written) return { imported: false, reason: "material-not-writable", detail: written.reason };
  try {
    await db.platformConfig.upsert({
      where: { key: FEDERATION_MEMBERSHIP_CONFIG_KEY },
      create: { key: FEDERATION_MEMBERSHIP_CONFIG_KEY, value: facts },
      update: { value: facts },
    });
  } catch (error) {
    // The facts file beside the material is the durable copy; the row is a cache.
    console.warn(`[federation] membership facts row not written: ${getErrorMessage(error)}`);
  }
  console.log(`[federation] joined the organization at ${answer.authorityUrl} as ${pkg.intendedPeer} (material in ${written.dir})`);
  return { imported: true, authorityUrl: answer.authorityUrl, caUrl: pkg.caUrl, intendedPeer: pkg.intendedPeer, expiresAt: pkg.expiresAt.toISOString(), materialDir: written.dir };
}
