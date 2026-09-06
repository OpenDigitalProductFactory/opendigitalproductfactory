// EP-ZERO-CONFIG-FEDERATION — issuing the organization join file, authority side.
// Spec: docs/superpowers/specs/2026-09-03-portal-mediated-organization-membership-design.md §5.3.
//
// Until now only a host script wrapped by an edge node could create a join
// file, because only it could run `step ca token`. That command needs no CA
// endpoint: it fetches the provisioner list, decrypts the JWK provisioner's
// private key with the provisioner password, and signs a short-lived JWT the
// CA honours exactly once. The authority portal already reads the organization
// root and the provisioner password from the state directory, so it can do
// the same in-process — verified against a live step-ca: the token this mints
// is accepted by POST /1.0/sign and refused on replay.
//
// The package has the same V2 shape the script wrote, so a script-era member
// can still import it; a portal-mediated member (organization-join-import.ts)
// needs only the first token.

import { randomBytes, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";

import { compactDecrypt, importJWK, SignJWT, type JWK } from "jose";

import { prisma } from "@dpf/db";
import { parseOrganizationJoinPackage } from "@dpf/db/organization-join-action";

import { resolveAppBaseUrl } from "@/lib/app-url";
import { isRecord } from "@/lib/shared/coerce";
import { getErrorMessage } from "@/lib/shared/get-error-message";

import { caInternalUrl, caRequest as defaultCaRequest, type CaRequest } from "./ca-client";
import { classifySan, membershipSanSet } from "./csr";
import { membershipRelayAvailable } from "./membership-relay";
import { hostnameFromHostHeader, readReachedAtHosts, type ReachedAtDb } from "./reached-at";

/** The join file lives 30 minutes: long enough to move a file between machines, short enough to expire unused. */
export const JOIN_FILE_TTL_SECONDS = 30 * 60;
export const INSTALLER_PROVISIONER = "dpf-installer";
export const EDGE_CLIENT_PROVISIONER = "dpf-edge-client";
/** Audience the CA accepts for every authority: `localhost` is always among its DNS names. */
const SIGN_AUDIENCE = "https://localhost/1.0/sign";
const DEFAULT_PKI_PORT = 9000;
const SAFE_PEER = /^[A-Za-z0-9._:-]{1,253}$/;

export type JoinIssueRefusal =
  | "not-the-authority"
  | "invalid-intended-peer"
  | "own-address-unknown"
  | "ca-unreachable"
  | "provisioner-missing"
  | "provisioner-key-locked"
  | "package-invalid";

export type JoinIssueResult =
  | { issued: true; packageText: string; fileName: string; packageId: string; intendedPeer: string; caUrl: string; expiresAt: string }
  | { issued: false; reason: JoinIssueRefusal; detail?: string };

interface JwkProvisioner {
  name: string;
  kid: string;
  encryptedKey: string;
}

function readProvisioners(body: unknown): JwkProvisioner[] {
  if (!isRecord(body) || !Array.isArray(body.provisioners)) return [];
  const out: JwkProvisioner[] = [];
  for (const raw of body.provisioners) {
    if (!isRecord(raw) || raw.type !== "JWK" || typeof raw.name !== "string" || typeof raw.encryptedKey !== "string") continue;
    const kid = isRecord(raw.key) && typeof raw.key.kid === "string" ? raw.key.kid : null;
    if (!kid) continue;
    out.push({ name: raw.name, kid, encryptedKey: raw.encryptedKey });
  }
  return out;
}

/** Decrypt the provisioner's private JWK with the provisioner password (JWE PBES2, as step-ca stores it). */
export async function unlockProvisionerKey(provisioner: JwkProvisioner, password: string): Promise<JWK> {
  const { plaintext } = await compactDecrypt(provisioner.encryptedKey, new TextEncoder().encode(password), {
    keyManagementAlgorithms: ["PBES2-HS256+A128KW", "PBES2-HS384+A192KW", "PBES2-HS512+A256KW"],
    // step-ca derives with 600 000 iterations; jose's default bound is far lower.
    maxPBES2Count: 2_000_000,
  });
  return JSON.parse(new TextDecoder().decode(plaintext)) as JWK;
}

/** Mint the one-time token `step ca token` would: the CA honours it once for exactly this subject and these SANs. */
export async function mintEnrollmentToken(input: {
  provisioner: JwkProvisioner;
  privateJwk: JWK;
  subject: string;
  sans: string[];
  rootFingerprint: string;
  ttlSeconds: number;
  now: Date;
}): Promise<string> {
  const key = await importJWK(input.privateJwk, "ES256");
  const issuedAt = Math.floor(input.now.getTime() / 1000);
  return new SignJWT({ sha: input.rootFingerprint, sans: input.sans })
    .setProtectedHeader({ alg: "ES256", kid: input.provisioner.kid, typ: "JWT" })
    .setIssuer(input.provisioner.name)
    .setSubject(input.subject)
    .setAudience(SIGN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt)
    .setExpirationTime(issuedAt + input.ttlSeconds)
    .setJti(randomBytes(32).toString("hex"))
    .sign(key);
}

/** This authority's own reachable host, for the CA URL the member derives the portal from. Never typed. */
export async function resolveAuthorityHost(
  db: ReachedAtDb,
  input: { requestHost?: string | null; configuredBaseUrl?: string | null },
): Promise<string | null> {
  const fromRequest = hostnameFromHostHeader(input.requestHost?.replace(/^https?:\/\//, "") ?? null);
  const loopback = (host: string | null) => !host || host === "localhost" || host.startsWith("127.") || host === "::1" || host === "[::1]";
  if (!loopback(fromRequest)) return fromRequest;
  const configured = input.configuredBaseUrl === undefined ? resolveAppBaseUrl() : input.configuredBaseUrl;
  const fromConfig = configured ? hostnameFromHostHeader(configured.replace(/^https?:\/\//, "")) : null;
  if (!loopback(fromConfig)) return fromConfig;
  const reached = await readReachedAtHosts(db);
  return reached[0] ?? null;
}

export function buildJoinPackageText(fields: {
  packageId: string;
  caUrl: string;
  rootFingerprint: string;
  intendedPeer: string;
  intendedSans: string[];
  expiresAtEpochSeconds: number;
  enrollmentToken: string;
  edgeClientEnrollmentToken: string;
}): string {
  return [
    "DPF_ORGANIZATION_JOIN_V2",
    `package_id=${fields.packageId}`,
    `ca_url=${fields.caUrl}`,
    `root_fingerprint=${fields.rootFingerprint}`,
    `intended_hostname=${fields.intendedPeer}`,
    `intended_sans=${fields.intendedSans.join(",")}`,
    `expires_at=${fields.expiresAtEpochSeconds}`,
    `enrollment_token=${fields.enrollmentToken}`,
    `edge_client_enrollment_token=${fields.edgeClientEnrollmentToken}`,
    "",
  ].join("\n");
}

export async function issueOrganizationJoinFile(
  input: { intendedPeer: string; extraSans?: string[]; requestHost?: string | null; now?: Date },
  deps: {
    db?: ReachedAtDb;
    env?: Record<string, string | undefined>;
    configuredBaseUrl?: string | null;
    readText?: (path: string) => Promise<string>;
    exists?: (path: string) => Promise<boolean>;
    caRequest?: CaRequest;
  } = {},
): Promise<JoinIssueResult> {
  const db = deps.db ?? (prisma as unknown as ReachedAtDb);
  const env = deps.env ?? process.env;
  const now = input.now ?? new Date();
  const readText = deps.readText ?? ((path: string) => readFile(path, "utf8"));

  const intendedPeer = input.intendedPeer.trim();
  if (!SAFE_PEER.test(intendedPeer)) return { issued: false, reason: "invalid-intended-peer" };
  const extraSans = (input.extraSans ?? []).map((s) => s.trim()).filter(Boolean);
  if (extraSans.some((s) => !SAFE_PEER.test(s))) return { issued: false, reason: "invalid-intended-peer", detail: "an extra name is not a hostname" };

  // Only the authority holds the root and the provisioner password.
  const relay = await membershipRelayAvailable({ env, readText, exists: deps.exists });
  if (!relay.available) return { issued: false, reason: "not-the-authority", detail: relay.reason };
  const passwordPath = env.DPF_PKI_PASSWORD_PATH?.trim() || "/dpf-state/pki/secrets/step-ca-password";
  let password: string;
  try {
    password = (await readText(passwordPath)).trim();
  } catch {
    return { issued: false, reason: "not-the-authority", detail: "the provisioner password is not readable" };
  }

  // The CA URL a member derives the authority portal from: our own reachable host.
  const host = await resolveAuthorityHost(db, { requestHost: input.requestHost, configuredBaseUrl: deps.configuredBaseUrl });
  if (!host) return { issued: false, reason: "own-address-unknown", detail: "open the Connections page at this installation's network address once" };
  const pkiPort = Number.parseInt(env.DPF_PKI_PORT ?? "", 10) || DEFAULT_PKI_PORT;
  const caUrl = `https://${host.includes(":") ? `[${host}]` : host}:${pkiPort}/`;

  // The provisioners and their locked keys, from the CA over pinned TLS.
  const ca = deps.caRequest ?? defaultCaRequest;
  let provisioners: JwkProvisioner[];
  try {
    const answer = await ca({ caUrl: caInternalUrl(env), rootPem: relay.rootPem, method: "GET", path: "/provisioners" });
    if (answer.status !== 200) return { issued: false, reason: "ca-unreachable", detail: `CA answered ${answer.status} for the provisioner list` };
    provisioners = readProvisioners(answer.body);
  } catch (error) {
    return { issued: false, reason: "ca-unreachable", detail: getErrorMessage(error) };
  }
  const installer = provisioners.find((p) => p.name === INSTALLER_PROVISIONER);
  if (!installer) return { issued: false, reason: "provisioner-missing", detail: `the CA has no JWK provisioner named ${INSTALLER_PROVISIONER}` };
  const edgeClient = provisioners.find((p) => p.name === EDGE_CLIENT_PROVISIONER) ?? installer;

  const rootFingerprint = new X509Certificate(relay.rootPem).fingerprint256.replaceAll(":", "").toLowerCase();
  const sans = membershipSanSet(intendedPeer, extraSans).map((s) => classifySan(s).value);
  const edgeSubject = `dpf-edge-${intendedPeer.replaceAll(":", "-")}`;
  let enrollmentToken: string;
  let edgeClientEnrollmentToken: string;
  try {
    const installerKey = await unlockProvisionerKey(installer, password);
    enrollmentToken = await mintEnrollmentToken({ provisioner: installer, privateJwk: installerKey, subject: intendedPeer, sans, rootFingerprint, ttlSeconds: JOIN_FILE_TTL_SECONDS, now });
    const edgeKey = edgeClient === installer ? installerKey : await unlockProvisionerKey(edgeClient, password);
    edgeClientEnrollmentToken = await mintEnrollmentToken({ provisioner: edgeClient, privateJwk: edgeKey, subject: edgeSubject, sans: [edgeSubject], rootFingerprint, ttlSeconds: JOIN_FILE_TTL_SECONDS, now });
  } catch (error) {
    return { issued: false, reason: "provisioner-key-locked", detail: getErrorMessage(error) };
  }

  const packageId = randomBytes(16).toString("hex");
  const expiresAtEpochSeconds = Math.floor(now.getTime() / 1000) + JOIN_FILE_TTL_SECONDS;
  const packageText = buildJoinPackageText({
    packageId, caUrl, rootFingerprint, intendedPeer, intendedSans: sans.slice(1), expiresAtEpochSeconds, enrollmentToken, edgeClientEnrollmentToken,
  });
  // The same parser every importer runs: a package this authority cannot read is never handed out.
  const check = parseOrganizationJoinPackage(packageText, now);
  if (!check.ok) return { issued: false, reason: "package-invalid", detail: check.reason };
  console.log(`[federation] issued organization join file ${packageId} for ${intendedPeer} (CA ${caUrl}, expires ${new Date(expiresAtEpochSeconds * 1000).toISOString()})`);
  return {
    issued: true,
    packageText,
    fileName: `organization-join-${intendedPeer.replaceAll(":", "-")}-${packageId.slice(0, 8)}.dpfjoin`,
    packageId,
    intendedPeer,
    caUrl,
    expiresAt: new Date(expiresAtEpochSeconds * 1000).toISOString(),
  };
}
