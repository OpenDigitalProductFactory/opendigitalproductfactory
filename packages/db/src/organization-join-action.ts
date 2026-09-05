// BI-A8399604 — the closed contract for the only founder-approved privileged
// Edge actions. This module is pure so the portal, dispatch gate, native-agent
// fixtures, and future Connections preview all share one parser.

export const ORGANIZATION_JOIN_ACTION_TYPES = [
  "organization.join.issue",
  "organization.join.import",
] as const;

export type OrganizationJoinActionType = (typeof ORGANIZATION_JOIN_ACTION_TYPES)[number];
export type OrganizationTrustRole = "authority" | "member";

export interface OrganizationJoinIssueParameters {
  intendedPeer: string;
  ttlSeconds: number;
}

export interface OrganizationJoinImportParameters {
  joinPackage: string;
}

export type OrganizationJoinRequestParameters =
  | OrganizationJoinIssueParameters
  | OrganizationJoinImportParameters;

export interface OrganizationJoinPackagePreview {
  packageId: string;
  caUrl: string;
  rootFingerprint: string;
  intendedPeer: string;
  intendedSans: string[];
  expiresAt: Date;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const ISSUE_KEYS = ["intendedPeer", "ttlSeconds"] as const;
const IMPORT_KEYS = ["joinPackage"] as const;
const PACKAGE_KEYS = [
  "package_id",
  "ca_url",
  "root_fingerprint",
  "intended_hostname",
  "intended_sans",
  "expires_at",
  "enrollment_token",
  "edge_client_enrollment_token",
] as const;
const REQUIRED_PACKAGE_KEYS = PACKAGE_KEYS.filter((key) => key !== "intended_sans");
const SAFE_PEER = /^[A-Za-z0-9._:-]{1,253}$/;
const SAFE_TOKEN = /^[A-Za-z0-9._-]{1,4096}$/;
const MAX_JOIN_PACKAGE_BYTES = 64 * 1024;
const MIN_TTL_SECONDS = 5 * 60;
const MAX_TTL_SECONDS = 15 * 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]);
}

export function isOrganizationJoinActionType(value: string): value is OrganizationJoinActionType {
  return (ORGANIZATION_JOIN_ACTION_TYPES as readonly string[]).includes(value);
}

export function requiredOrganizationTrustRole(actionType: OrganizationJoinActionType): OrganizationTrustRole {
  return actionType === "organization.join.issue" ? "authority" : "member";
}

export function parseOrganizationJoinRequest(
  actionType: string,
  parameters: unknown,
  now: Date = new Date(),
): ParseResult<OrganizationJoinRequestParameters> {
  if (!isOrganizationJoinActionType(actionType)) return { ok: false, reason: "unsupported-action-type" };
  if (!isRecord(parameters)) return { ok: false, reason: "invalid-parameters" };
  if (actionType === "organization.join.issue") {
    if (!hasExactKeys(parameters, ISSUE_KEYS)) return { ok: false, reason: "invalid-parameters" };
    if (typeof parameters.intendedPeer !== "string" || !SAFE_PEER.test(parameters.intendedPeer)) {
      return { ok: false, reason: "invalid-intended-peer" };
    }
    if (!Number.isInteger(parameters.ttlSeconds) ||
        (parameters.ttlSeconds as number) < MIN_TTL_SECONDS ||
        (parameters.ttlSeconds as number) > MAX_TTL_SECONDS) {
      return { ok: false, reason: "invalid-ttl" };
    }
    return {
      ok: true,
      value: { intendedPeer: parameters.intendedPeer, ttlSeconds: parameters.ttlSeconds as number },
    };
  }
  if (!hasExactKeys(parameters, IMPORT_KEYS) || typeof parameters.joinPackage !== "string") {
    return { ok: false, reason: "invalid-parameters" };
  }
  const parsedPackage = parseOrganizationJoinPackage(parameters.joinPackage, now);
  if (!parsedPackage.ok) return parsedPackage;
  return { ok: true, value: { joinPackage: parameters.joinPackage } };
}

export function parseOrganizationJoinDispatchParameters(
  actionType: string,
  parameters: unknown,
  now: Date = new Date(),
): ParseResult<OrganizationJoinRequestParameters> {
  return parseOrganizationJoinRequest(actionType, parameters, now);
}

/** The preview plus the one-time enrollment authority the CA honours exactly once. */
export interface OrganizationJoinPackageMaterial extends OrganizationJoinPackagePreview {
  enrollmentToken: string;
}

export function parseOrganizationJoinPackage(
  raw: string,
  now: Date = new Date(),
): ParseResult<OrganizationJoinPackagePreview> {
  const parsed = parseOrganizationJoinPackageMaterial(raw, now);
  if (!parsed.ok) return parsed;
  const { enrollmentToken: _token, ...preview } = parsed.value;
  return { ...parsed, value: preview };
}

/**
 * The full material a member portal needs to turn the package into a
 * certificate (EP-ZERO-CONFIG-FEDERATION, portal-mediated membership): the
 * preview facts plus the enrollment token. Never render the token; it is the
 * credential the organization CA accepts once.
 */
export function parseOrganizationJoinPackageMaterial(
  raw: string,
  now: Date = new Date(),
): ParseResult<OrganizationJoinPackageMaterial> {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > MAX_JOIN_PACKAGE_BYTES || raw.includes("\0")) {
    return { ok: false, reason: "invalid-join-package" };
  }
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  if (lines.shift() !== "DPF_ORGANIZATION_JOIN_V2") return { ok: false, reason: "unsupported-package-version" };
  const fields = new Map<string, string>();
  for (const line of lines) {
    if (line === "") continue;
    const separator = line.indexOf("=");
    if (separator <= 0) return { ok: false, reason: "malformed-package-field" };
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!(PACKAGE_KEYS as readonly string[]).includes(key)) return { ok: false, reason: "unknown-package-field" };
    if (fields.has(key)) return { ok: false, reason: "duplicate-package-field" };
    fields.set(key, value);
  }
  if (REQUIRED_PACKAGE_KEYS.some((key) => !fields.get(key))) return { ok: false, reason: "incomplete-join-package" };

  const packageId = fields.get("package_id")!;
  const caUrl = fields.get("ca_url")!;
  const rootFingerprint = fields.get("root_fingerprint")!;
  const intendedPeer = fields.get("intended_hostname")!;
  const intendedSansRaw = fields.get("intended_sans") ?? "";
  const expiresRaw = fields.get("expires_at")!;
  if (!/^[a-f0-9]{32}$/.test(packageId) || !/^[A-Fa-f0-9]{64}$/.test(rootFingerprint) || !SAFE_PEER.test(intendedPeer)) {
    return { ok: false, reason: "invalid-join-package" };
  }
  const intendedSans = intendedSansRaw === "" ? [] : intendedSansRaw.split(",");
  if (intendedSans.some((value) => !SAFE_PEER.test(value))) return { ok: false, reason: "invalid-join-package" };
  if (!isPrivateOrganizationCaUrl(caUrl)) return { ok: false, reason: "invalid-private-ca-url" };
  if (!/^\d{1,12}$/.test(expiresRaw)) return { ok: false, reason: "invalid-package-expiry" };
  const expiresAt = new Date(Number(expiresRaw) * 1000);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "join-package-expired" };
  }
  if (!SAFE_TOKEN.test(fields.get("enrollment_token")!) || !SAFE_TOKEN.test(fields.get("edge_client_enrollment_token")!)) {
    return { ok: false, reason: "invalid-enrollment-authority" };
  }
  return {
    ok: true,
    value: { packageId, caUrl, rootFingerprint, intendedPeer, intendedSans, expiresAt, enrollmentToken: fields.get("enrollment_token")! },
  };
}

function isPrivateOrganizationCaUrl(value: string): boolean {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return false; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "host.docker.internal" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  return octets[0] === 127 || octets[0] === 10 ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31);
}
