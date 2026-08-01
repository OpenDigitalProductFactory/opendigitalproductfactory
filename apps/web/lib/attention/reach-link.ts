// Signed reach links — the pointer an off-site message carries.
// Spec: docs/superpowers/specs/2026-08-01-attention-reach-layer-design.md §4.2
//
// THE LOAD-BEARING PROPERTY: a reach link is a POINTER, NOT AN AUTHORIZATION. It names
// which attention item to land on; the route it lands on requires a normal authenticated
// session. So a link that leaks — forwarded, logged by a mail gateway, sitting in a
// screenshot — reveals nothing and grants nothing. The worst case is that someone learns an
// opaque item id they still cannot open.
//
// That property is what lets this ship without the per-class security review that an
// action-bearing token genuinely needs (BI-C7D25599 Open Decision 3). If a future change
// makes this token grant anything, that review becomes mandatory first.
//
// Stateless by design: no new table, nothing to clean up, nothing to leak at rest. The
// tradeoff is that a link cannot be individually revoked before it expires — acceptable
// precisely because it authorizes nothing. Keep expiries short anyway.

import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson } from "@/lib/shared/canonical-json";

/** Payload carried in the link. Deliberately minimal — see the no-business-content rule. */
export type ReachLinkPayload = {
  /** The attention item to land on. */
  itemId: string;
  /** In-app path for that specific item — never a list (BI-C7D25599, 2026-07-22 audit). */
  deepLink: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
};

export type ReachLinkVerification =
  | { ok: true; payload: ReachLinkPayload }
  | { ok: false; reason: ReachLinkFailure };

/** Distinguishable so the landing route can say something true and useful. An operator
 *  following a stale link deserves "this link has expired", not a generic failure. */
export type ReachLinkFailure = "malformed" | "signature_mismatch" | "expired";

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string | null {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    // base64url decoding is lenient and will happily produce garbage from arbitrary input;
    // re-encoding and comparing rejects anything that was not a faithful encoding.
    return base64UrlEncode(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Signing secret. Throws when unset — there is deliberately NO fallback constant.
 *
 * A hardcoded default in a signing path means anyone who can read the repository can mint
 * valid tokens (`never-hardcode-secrets`). Failing to start is the correct behaviour: a
 * reach link that cannot be trusted is worse than no reach link, because the operator would
 * act on it.
 */
function reachSecret(): string {
  const secret =
    process.env.DPF_ATTENTION_REACH_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      "Attention reach links require a signing secret: set DPF_ATTENTION_REACH_SECRET (or AUTH_SECRET / NEXTAUTH_SECRET).",
    );
  }
  return secret;
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

/** Constant-time compare that is also safe when lengths differ. */
function signaturesMatch(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  // timingSafeEqual throws on length mismatch, and the length itself is not secret here,
  // so compare it first rather than padding.
  if (expectedBytes.length !== actualBytes.length) return false;
  return timingSafeEqual(expectedBytes, actualBytes);
}

/**
 * Mint a link token. `canonicalJson` (not `JSON.stringify`) so the signed bytes do not
 * depend on key insertion order.
 */
export function createReachLink(
  payload: ReachLinkPayload,
  options: { secret?: string } = {},
): string {
  const encoded = base64UrlEncode(canonicalJson(payload));
  return `${encoded}.${sign(encoded, options.secret ?? reachSecret())}`;
}

/**
 * Verify a token. Fails closed on every path: a malformed token, a tampered payload, a
 * forged signature, and an expired-but-validly-signed token are all rejected.
 *
 * Order matters — the signature is checked BEFORE the payload is trusted for anything,
 * including its own expiry, so an attacker cannot extend a link's life by editing `exp`.
 */
export function verifyReachLink(
  token: string,
  options: { now?: Date; secret?: string } = {},
): ReachLinkVerification {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  let secret: string;
  try {
    secret = options.secret ?? reachSecret();
  } catch {
    // A missing secret is a configuration fault, not a bad link. Report it as a mismatch
    // rather than leaking the distinction to whoever is holding the URL.
    return { ok: false, reason: "signature_mismatch" };
  }

  if (!signaturesMatch(sign(encoded, secret), signature)) {
    return { ok: false, reason: "signature_mismatch" };
  }

  const decoded = base64UrlDecode(encoded);
  if (decoded === null) return { ok: false, reason: "malformed" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isReachLinkPayload(parsed)) return { ok: false, reason: "malformed" };

  const now = (options.now ?? new Date()).getTime();
  if (parsed.exp <= now) return { ok: false, reason: "expired" };

  return { ok: true, payload: parsed };
}

function isReachLinkPayload(value: unknown): value is ReachLinkPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.itemId === "string" &&
    candidate.itemId.length > 0 &&
    typeof candidate.deepLink === "string" &&
    // Relative in-app paths only. An absolute URL here would turn every reach link into an
    // open redirect the moment the landing route honoured it.
    candidate.deepLink.startsWith("/") &&
    !candidate.deepLink.startsWith("//") &&
    typeof candidate.exp === "number" &&
    Number.isFinite(candidate.exp)
  );
}

/** Default link lifetime. Short because a decision that has waited days should be re-sent
 *  with fresh context rather than followed from a stale message. */
export const REACH_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function reachLinkExpiry(now: Date = new Date(), ttlMs: number = REACH_LINK_TTL_MS): number {
  return now.getTime() + ttlMs;
}
