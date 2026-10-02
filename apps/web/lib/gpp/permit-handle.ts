// GPP permit handle: `gpp1.<permitId>.<keyId>.<mac>` (spec §5.6, plan PR-D).
//
// mac = HMAC-SHA256(key[keyId], canonicalPermitClaims(row)), base64url. The
// pattern is the one reach-link.ts and delegation-receipt.ts use: the shared
// canonicalJson, a versioned key id, a length check then timingSafeEqual, and
// no fallback constant.
//
// KEY CUSTODY. The secret is DPF_GPP_PERMIT_SECRET and its id
// DPF_GPP_PERMIT_KEY_ID (default "local-install", as delegation receipts do).
// Unlike those two modules there is deliberately NO fallback to AUTH_SECRET:
// a dedicated key is the custody boundary, and sharing the session secret
// would widen who can mint a permit that verifies. When the key is unset,
// canSignPermits() is false, permits are minted unsigned, and the monitor
// records `unsigned`. That is a recorded state, never an error and never a
// refusal.
//
// WHAT THIS DOES NOT DO. On an install where an agent can read host secrets or
// write the database, a forged permit is DETECTED (`mac_invalid`), not
// prevented. Prevention depends on agent runtimes that hold neither the key
// nor database credentials, which is a deployment property (GPP Annex A).

import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalPermitClaims, type PermitClaims } from "./permit-claims";

export const PERMIT_HANDLE_VERSION = "gpp1";
export const DEFAULT_PERMIT_KEY_ID = "local-install";

/** A key id and permit id travel inside a dot-separated handle, so neither may contain a dot. */
const HANDLE_PART = /^[A-Za-z0-9_-]{1,128}$/;
const KEY_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** base64url of a 32-byte HMAC-SHA256, unpadded. */
const MAC = /^[A-Za-z0-9_-]{43}$/;

export type PermitKey = { keyId: string; secret: string };
export type PermitSignature = { keyId: string; mac: string };
export type ParsedPermitHandle = { permitId: string; keyId: string; mac: string };
export type PermitKeyOptions = { secret?: string; keyId?: string };

/** The configured signing key, or null when the install has none (or its id cannot travel in a handle). */
export function configuredPermitKey(options: PermitKeyOptions = {}): PermitKey | null {
  const secret = options.secret ?? process.env.DPF_GPP_PERMIT_SECRET;
  if (!secret || secret.trim().length === 0) return null;
  const rawKeyId = options.keyId ?? process.env.DPF_GPP_PERMIT_KEY_ID;
  const keyId = rawKeyId && rawKeyId.trim().length > 0 ? rawKeyId.trim() : DEFAULT_PERMIT_KEY_ID;
  if (!KEY_ID.test(keyId)) {
    console.error("[gpp-permit] DPF_GPP_PERMIT_KEY_ID must match %s; permits are minted unsigned", KEY_ID.source);
    return null;
  }
  return { keyId, secret };
}

/**
 * Whether this install can sign a permit at all. Exposed so callers decide
 * explicitly rather than by catching an exception (delegation-receipt.ts
 * canSignDelegationReceipts).
 */
export function canSignPermits(options: PermitKeyOptions = {}): boolean {
  return configuredPermitKey(options) !== null;
}

function mac(claims: PermitClaims, secret: string): string {
  return createHmac("sha256", secret).update(canonicalPermitClaims(claims)).digest("base64url");
}

/** Sign the claim set. Null, never a throw, when no key is configured. */
export function signPermit(claims: PermitClaims, options: PermitKeyOptions = {}): PermitSignature | null {
  const key = configuredPermitKey(options);
  if (!key) return null;
  return { keyId: key.keyId, mac: mac(claims, key.secret) };
}

export function formatPermitHandle(parts: ParsedPermitHandle): string {
  return `${PERMIT_HANDLE_VERSION}.${parts.permitId}.${parts.keyId}.${parts.mac}`;
}

/** Null when the value is not a well-formed signed handle (a bare permit id included). */
export function parsePermitHandle(value: string): ParsedPermitHandle | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== PERMIT_HANDLE_VERSION) return null;
  const [, permitId, keyId, macValue] = parts as [string, string, string, string];
  if (!HANDLE_PART.test(permitId) || !KEY_ID.test(keyId) || !MAC.test(macValue)) return null;
  return { permitId, keyId, mac: macValue };
}

/** Constant-time compare that is also safe when lengths differ (reach-link.ts). */
function macsMatch(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  if (expectedBytes.length !== actualBytes.length) return false;
  return timingSafeEqual(expectedBytes, actualBytes);
}

export type PermitMacCheck =
  | { result: "ok" }
  | { result: "unsigned"; reason: "no-key-configured" }
  | { result: "invalid"; reason: "key-not-configured" | "mac-mismatch" | "row-unsigned-while-key-configured" };

/**
 * Verify a permit row's claims against its MAC.
 *
 * - No key configured → `unsigned`: the install cannot verify anything, so it
 *   says so rather than guessing.
 * - A signed handle was presented → its MAC must equal the MAC recomputed over
 *   the row's claims, under the key id the handle names. An edited row no
 *   longer matches the MAC the handle carries; an invented row has no MAC that
 *   matches without the key.
 * - No signed handle (the monitor's own mint, or a bare permit id) → the row's
 *   stored MAC is checked the same way. On a keyed install, a row with no MAC
 *   is `invalid`: stripping the MAC must not downgrade a forgery to `unsigned`.
 *   (A permit minted in the minutes before a key was configured also lands
 *   here; its createdAt explains it.)
 */
export function verifyPermitMac(
  row: PermitClaims & { keyId: string | null; mac: string | null },
  handle: ParsedPermitHandle | null,
  options: PermitKeyOptions = {},
): PermitMacCheck {
  const key = configuredPermitKey(options);
  if (!key) return { result: "unsigned", reason: "no-key-configured" };
  const presented = handle ? { keyId: handle.keyId, mac: handle.mac } : row.keyId && row.mac ? { keyId: row.keyId, mac: row.mac } : null;
  if (!presented) return { result: "invalid", reason: "row-unsigned-while-key-configured" };
  if (presented.keyId !== key.keyId) return { result: "invalid", reason: "key-not-configured" };
  if (!macsMatch(mac(row, key.secret), presented.mac)) return { result: "invalid", reason: "mac-mismatch" };
  return { result: "ok" };
}
