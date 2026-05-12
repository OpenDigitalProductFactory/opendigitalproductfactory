// Token generation + hashing for the Edge Node Phase 0 surface.
//
// Two token kinds:
//   BootstrapToken  one-time enrollment material; operator-issued via
//                   Admin > Platform Development; consumed exactly once
//                   by an Edge Node calling /api/v1/edge/enroll.
//   Node token      machine-bound dpfedge_* bearer; rotates on heartbeat;
//                   used for /api/v1/edge/heartbeat and
//                   /api/v1/edge/discovery-runs.
//
// Generation pattern mirrors apps/web/lib/auth/mcp-api-token.ts so the
// dpf*_ token family stays consistent: Crockford base32 over 24 random
// bytes, sha256 hash at rest, prefix-only display in operator UI.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Token model, § Token namespaces and lifecycle.

import { createHash, randomBytes } from "crypto";

import {
  BOOTSTRAP_TOKEN_DEFAULT_TTL_MS,
  BOOTSTRAP_TOKEN_MAX_TTL_MS,
  BOOTSTRAP_TOKEN_PREFIX,
  EDGE_NODE_TOKEN_PREFIX,
} from "@dpf/db/edge-node-types";

const SECRET_BYTES = 24;
const PREFIX_DISPLAY_LENGTH = 12;

// Crockford base32 (32 symbols, excluding I/L/O/U for visual
// disambiguation). MUST be exactly 32 characters — `& 31` indexes
// 0..31, so a shorter alphabet produces `undefined` lookups that
// template-literal into the literal text "undefined" inside generated
// tokens. Same alphabet as McpApiToken so the dpf*_ family is uniform.
const BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

if (BASE32_ALPHABET.length !== 32) {
  throw new Error(
    `BASE32_ALPHABET must be exactly 32 characters; got ${BASE32_ALPHABET.length}`,
  );
}

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
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export type GeneratedToken = {
  plaintext: string;
  hash: string;
  prefix: string;
};

function generate(prefix: string): GeneratedToken {
  const secret = encodeBase32(randomBytes(SECRET_BYTES));
  const plaintext = `${prefix}${secret}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  const display = plaintext.slice(0, PREFIX_DISPLAY_LENGTH);
  return { plaintext, hash, prefix: display };
}

/**
 * Generate a fresh bootstrap-token triplet. Plaintext is shown to the
 * operator exactly once at issuance time and never persisted; only the
 * hash + display prefix go into the BootstrapToken row.
 */
export function generateBootstrapToken(): GeneratedToken {
  return generate(BOOTSTRAP_TOKEN_PREFIX);
}

/**
 * Generate a fresh node-token triplet. Plaintext is returned to the
 * Edge Node in the enrollment response (or in the heartbeat-rotation
 * response). The Authority persists only the hash on EdgeNode.tokenHash.
 */
export function generateNodeToken(): GeneratedToken {
  return generate(EDGE_NODE_TOKEN_PREFIX);
}

/**
 * Hash a presented plaintext token (any kind) with the same algorithm
 * the issuance path uses, so token validation is a hash-then-lookup.
 */
export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Compute an expiry Date for a bootstrap token from a TTL in
 * milliseconds. Caps at BOOTSTRAP_TOKEN_MAX_TTL_MS per spec.
 */
export function computeBootstrapExpiry(
  ttlMs: number = BOOTSTRAP_TOKEN_DEFAULT_TTL_MS,
  now: Date = new Date(),
): Date {
  const capped = Math.min(Math.max(ttlMs, 1), BOOTSTRAP_TOKEN_MAX_TTL_MS);
  return new Date(now.getTime() + capped);
}

/**
 * Cheap precondition check before hashing a presented token: must
 * have the right namespace prefix. Avoids burning a hash on garbage
 * input. Returns the kind, or null if the prefix doesn't match either
 * known token kind.
 */
export function classifyTokenPrefix(
  plaintext: string,
): "node" | "bootstrap" | null {
  if (plaintext.startsWith(EDGE_NODE_TOKEN_PREFIX)) return "node";
  if (plaintext.startsWith(BOOTSTRAP_TOKEN_PREFIX)) return "bootstrap";
  return null;
}
