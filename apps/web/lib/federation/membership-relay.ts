// EP-ZERO-CONFIG-FEDERATION — the authority's certificate relay.
// Spec: docs/superpowers/specs/2026-09-03-portal-mediated-organization-membership-design.md §5.1.
//
// A member installation holding an organization join file asks the AUTHORITY'S
// PORTAL — the address it already trusts, on the port it already reaches — to
// have the organization CA sign a key the member generated. This module is the
// relay: it forwards the member's CSR and the join file's one-time enrollment
// token to step-ca's sign API over the private compose network and returns the
// CA's answer verbatim.
//
// Safety invariants (spec §4):
//   1. The CA decides, the portal relays. No provisioner key lives here; a bad
//      or reused token is refused by the CA, and that refusal is what the
//      member sees.
//   2. The CA is reached over TLS pinned to the organization root the portal
//      already reads from disk — never the system trust store.
//   3. One relay per token per window, per-caller rate limit, and an audit ring
//      (member address, token id hash, CA verdict — never the token).
//
// The relay exists only on an installation that holds the organization root
// AND runs step-ca in its compose chain; elsewhere the route answers 404.

import { createHash } from "node:crypto";
import { access } from "node:fs/promises";

import { prisma } from "@dpf/db";

import { isRecord } from "@/lib/shared/coerce";
import { getErrorMessage } from "@/lib/shared/get-error-message";

import { caInternalUrl, caRequest, type CaResponse } from "./ca-client";
import { looksLikeCertificateSigningRequest } from "./csr";
import { splitPemChain, verifyMembershipChain } from "./membership-proof";
import { readPinnedRoot } from "./membership-material";
import { checkNearbyPairingRateLimit } from "./nearby-pairing-rate-limit";

export const MEMBERSHIP_SIGN_PATH = "/api/v1/federation/membership/sign";
export const MEMBERSHIP_SIGN_SPEC = "dpf.membership-sign/1" as const;
/** PlatformConfig key of the bounded audit ring. */
export const MEMBERSHIP_RELAY_AUDIT_KEY = "federation.membership.relay.v1";
const AUDIT_RING_SIZE = 50;
const RELAY_MAX_PER_MINUTE = 6;
const SAFE_TOKEN = /^[A-Za-z0-9._-]{1,4096}$/;

export interface MembershipSignRequest {
  spec: typeof MEMBERSHIP_SIGN_SPEC;
  csrPem: string;
  enrollmentToken: string;
  memberAddress: string;
}

export type MembershipSignRefusal = "ca-refused" | "ca-unreachable" | "token-invalid" | "malformed" | "rate-limited";

export type MembershipSignResult =
  | { accepted: true; certPem: string; chainPems: string[]; rootPem: string }
  | { accepted: false; reason: MembershipSignRefusal; detail?: string; retryAfterSeconds?: number };

/** Parse an untrusted request body. Null when its shape is wrong. */
export function parseMembershipSignRequest(value: unknown): MembershipSignRequest | null {
  if (!isRecord(value) || value.spec !== MEMBERSHIP_SIGN_SPEC) return null;
  if (!looksLikeCertificateSigningRequest(value.csrPem)) return null;
  if (typeof value.enrollmentToken !== "string" || !SAFE_TOKEN.test(value.enrollmentToken)) return null;
  if (typeof value.memberAddress !== "string" || value.memberAddress.length > 400) return null;
  try {
    const url = new URL(value.memberAddress);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { spec: MEMBERSHIP_SIGN_SPEC, csrPem: value.csrPem.trim(), enrollmentToken: value.enrollmentToken, memberAddress: value.memberAddress };
}

/** The token's id as an audit handle: a hash, never the token. */
export function tokenIdHash(enrollmentToken: string): string {
  return createHash("sha256").update(enrollmentToken).digest("hex").slice(0, 16);
}

export { caInternalUrl, DEFAULT_CA_INTERNAL_URL } from "./ca-client";

/**
 * Whether this installation can relay at all: it pins the organization root
 * AND is the authority — declared by DPF_ORGANIZATION_TRUST_ROLE=authority or
 * proven by the CA password file the PKI overlay mounts beside the root.
 */
export async function membershipRelayAvailable(
  options: {
    env?: Record<string, string | undefined>;
    readText?: (path: string) => Promise<string>;
    exists?: (path: string) => Promise<boolean>;
  } = {},
): Promise<{ available: true; rootPem: string } | { available: false; reason: "no-organization-root" | "not-the-authority" }> {
  const env = options.env ?? process.env;
  const root = await readPinnedRoot({ env, readText: options.readText });
  if (!root) return { available: false, reason: "no-organization-root" };
  if (env.DPF_ORGANIZATION_TRUST_ROLE?.trim().toLowerCase() === "authority") return { available: true, rootPem: root.rootPem };
  const exists = options.exists ?? (async (path: string) => { try { await access(path); return true; } catch { return false; } });
  const passwordFile = env.DPF_PKI_PASSWORD_PATH?.trim() || "/dpf-state/pki/secrets/step-ca-password";
  if (await exists(passwordFile)) return { available: true, rootPem: root.rootPem };
  return { available: false, reason: "not-the-authority" };
}

export type CaSignResponse = CaResponse;

/** POST to step-ca's sign API over TLS pinned to the organization root (ca-client.ts). */
export async function postToCaSign(input: {
  caUrl: string;
  rootPem: string;
  csrPem: string;
  enrollmentToken: string;
  timeoutMs?: number;
}): Promise<CaSignResponse> {
  return caRequest({ caUrl: input.caUrl, rootPem: input.rootPem, method: "POST", path: "/1.0/sign", body: { csr: input.csrPem, ott: input.enrollmentToken }, timeoutMs: input.timeoutMs });
}

export interface RelayDb {
  platformConfig: {
    findUnique(args: unknown): Promise<{ value: unknown } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
}

export interface MembershipRelayAuditEntry {
  at: string;
  memberAddress: string;
  tokenId: string;
  verdict: "accepted" | MembershipSignRefusal;
  detail?: string;
}

/** Append to the bounded audit ring; never throws. */
export async function recordMembershipRelayEvent(db: RelayDb, entry: MembershipRelayAuditEntry): Promise<void> {
  try {
    const row = await db.platformConfig.findUnique({ where: { key: MEMBERSHIP_RELAY_AUDIT_KEY }, select: { value: true } });
    const existing = isRecord(row?.value) && Array.isArray(row.value.events) ? (row.value.events as unknown[]) : [];
    const events = [...existing.slice(-(AUDIT_RING_SIZE - 1)), entry];
    await db.platformConfig.upsert({
      where: { key: MEMBERSHIP_RELAY_AUDIT_KEY },
      create: { key: MEMBERSHIP_RELAY_AUDIT_KEY, value: { schemaVersion: 1, events } },
      update: { value: { schemaVersion: 1, events } },
    });
  } catch {
    // The audit ring is best effort; the console line below always lands.
  }
  console.log(`[federation] membership relay ${entry.verdict} for ${entry.memberAddress} token=${entry.tokenId}${entry.detail ? ` (${entry.detail})` : ""}`);
}

function readCaAnswer(status: number, body: unknown): { certPem: string; chainPems: string[] } | { refused: string } {
  // step-ca answers 201 Created (verified against a live CA); 200 is tolerated.
  if ((status === 200 || status === 201) && isRecord(body) && typeof body.crt === "string") {
    // step-ca answers { crt, ca, certChain }: certChain is leaf-first and
    // already includes crt; an older CA may send only crt + ca.
    const chain = Array.isArray(body.certChain) ? splitPemChain(body.certChain.filter((v): v is string => typeof v === "string")) : [];
    const leaf = splitPemChain(body.crt)[0] ?? body.crt.trim();
    const ca = typeof body.ca === "string" ? splitPemChain(body.ca) : [];
    const rest = chain.length ? chain : ca;
    const chainPems = rest[0] === leaf ? rest : [leaf, ...rest];
    return { certPem: leaf, chainPems };
  }
  const message = isRecord(body) && typeof body.message === "string" ? body.message : isRecord(body) && typeof body.error === "string" ? body.error : `status ${status}`;
  return { refused: message.slice(0, 300) };
}

/**
 * Relay one signing request. Rate-limited per caller and per token; the CA's
 * verdict is returned as-is, with the issued chain verified against the pinned
 * root before it is handed back (a CA that answered with a foreign chain would
 * be a misconfiguration the member must not trust).
 */
export async function relayMembershipSign(
  input: { request: MembershipSignRequest; callerKey: string; now?: Date },
  deps: {
    env?: Record<string, string | undefined>;
    rootPem: string;
    db?: RelayDb;
    post?: typeof postToCaSign;
  },
): Promise<MembershipSignResult> {
  const db = deps.db ?? (prisma as unknown as RelayDb);
  const now = input.now ?? new Date();
  const tokenId = tokenIdHash(input.request.enrollmentToken);
  const audit = (verdict: MembershipRelayAuditEntry["verdict"], detail?: string) =>
    recordMembershipRelayEvent(db, { at: now.toISOString(), memberAddress: input.request.memberAddress, tokenId, verdict, ...(detail ? { detail } : {}) });

  const byCaller = checkNearbyPairingRateLimit(`membership-sign:caller:${input.callerKey}`, { maxRequests: RELAY_MAX_PER_MINUTE, now });
  if (!byCaller.allowed) {
    await audit("rate-limited", "caller");
    return { accepted: false, reason: "rate-limited", retryAfterSeconds: byCaller.retryAfterSeconds };
  }
  const byToken = checkNearbyPairingRateLimit(`membership-sign:token:${tokenId}`, { maxRequests: 1, now });
  if (!byToken.allowed) {
    await audit("rate-limited", "token");
    return { accepted: false, reason: "rate-limited", retryAfterSeconds: byToken.retryAfterSeconds };
  }

  const post = deps.post ?? postToCaSign;
  let answer: CaSignResponse;
  try {
    answer = await post({ caUrl: caInternalUrl(deps.env), rootPem: deps.rootPem, csrPem: input.request.csrPem, enrollmentToken: input.request.enrollmentToken });
  } catch (error) {
    const detail = getErrorMessage(error);
    await audit("ca-unreachable", detail);
    return { accepted: false, reason: "ca-unreachable", detail };
  }
  const read = readCaAnswer(answer.status, answer.body);
  if ("refused" in read) {
    const reason: MembershipSignRefusal = answer.status === 401 || answer.status === 403 || /token|ott|jwt|claim|audience|expired/i.test(read.refused) ? "token-invalid" : "ca-refused";
    await audit(reason, read.refused);
    return { accepted: false, reason, detail: read.refused };
  }
  const verified = verifyMembershipChain({ chainPems: read.chainPems, pinnedRootPem: deps.rootPem, now });
  if (!verified.verified) {
    await audit("ca-refused", `issued chain does not verify to the pinned root: ${verified.failure}`);
    return { accepted: false, reason: "ca-refused", detail: `issued chain does not verify to the pinned root: ${verified.failure}` };
  }
  await audit("accepted", verified.leafSubject ?? undefined);
  return { accepted: true, certPem: read.certPem, chainPems: read.chainPems, rootPem: deps.rootPem };
}
