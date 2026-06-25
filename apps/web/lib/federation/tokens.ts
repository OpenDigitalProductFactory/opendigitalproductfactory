// EP-MSP-FEDERATION · B1 — federation token generation + hashing. Mirrors
// apps/web/lib/edge-node/tokens.ts (same Crockford-base32-over-24-random-bytes +
// sha256-at-rest pattern) so the dpf*_ token family stays uniform, with the
// federation prefixes (dpffboot_ bootstrap, dpflink_ link token).

import { createHash, randomBytes } from "crypto";

import {
  FEDERATION_BOOTSTRAP_DEFAULT_TTL_MS,
  FEDERATION_BOOTSTRAP_MAX_TTL_MS,
  FEDERATION_BOOTSTRAP_TOKEN_PREFIX,
  FEDERATION_LINK_TOKEN_PREFIX,
} from "@dpf/db/federation-link-types";

const SECRET_BYTES = 24;
const PREFIX_DISPLAY_LENGTH = 12;
const BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export type GeneratedToken = { plaintext: string; hash: string; prefix: string };

function generate(prefix: string): GeneratedToken {
  const secret = encodeBase32(randomBytes(SECRET_BYTES));
  const plaintext = `${prefix}${secret}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash, prefix: plaintext.slice(0, PREFIX_DISPLAY_LENGTH) };
}

/** One-time invitation token (dpffboot_), shown to the operator once. */
export function generateFederationBootstrapToken(): GeneratedToken {
  return generate(FEDERATION_BOOTSTRAP_TOKEN_PREFIX);
}

/** Rotating link token (dpflink_) returned to the peer at enrollment. */
export function generateLinkToken(): GeneratedToken {
  return generate(FEDERATION_LINK_TOKEN_PREFIX);
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function computeFederationBootstrapExpiry(
  ttlMs: number = FEDERATION_BOOTSTRAP_DEFAULT_TTL_MS,
  now: Date = new Date(),
): Date {
  const capped = Math.min(Math.max(ttlMs, 1), FEDERATION_BOOTSTRAP_MAX_TTL_MS);
  return new Date(now.getTime() + capped);
}

export function classifyFederationToken(plaintext: string): "link" | "bootstrap" | null {
  // Order matters only if one prefix were a prefix of the other; they are not.
  if (plaintext.startsWith(FEDERATION_LINK_TOKEN_PREFIX)) return "link";
  if (plaintext.startsWith(FEDERATION_BOOTSTRAP_TOKEN_PREFIX)) return "bootstrap";
  return null;
}
