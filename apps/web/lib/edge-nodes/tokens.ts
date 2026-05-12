// Edge Node token machinery for the DPF Authority Core.
//
// Two token classes, both `dpfedge_<base32>` on the wire, both sha256-hashed
// at rest, both shaped after the McpApiToken pattern at
// apps/web/lib/auth/mcp-api-token.ts.
//
//   - Bootstrap token: one-time, short-lived, scope:edge:enroll only.
//     Consumed by exactly one EdgeNode during enrollment. Mirrors the
//     osquery enroll_secret → node_key handshake and Tailscale's
//     one-off auth keys per the spec's Research & Benchmarking section.
//
//   - Node token: machine-bound, rotates per heartbeat (default 24h
//     TTL with a configurable grace window for the previous token so
//     a lost heartbeat response doesn't lock the node out).
//
// Both classes are issued by the Authority Core (NOT by the user the
// way MCP tokens are). The bootstrap token is issued by an operator
// through Admin > Platform Development; the node token is issued
// server-side as part of the enroll / heartbeat response.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
// (Token model + Token namespaces and lifecycle sections).

import { createHash, randomBytes } from "crypto";

import { prisma } from "@dpf/db";

export const EDGE_TOKEN_PREFIX = "dpfedge_";

const SECRET_BYTES = 24;
const PREFIX_DISPLAY_LENGTH = 12;

// Crockford base32 alphabet — same as the MCP token surface. RFC-style
// 32 symbols, excluding I/L/O/U for visual disambiguation. MUST be
// exactly 32 characters; `& 31` indexes 0..31, so a shorter alphabet
// produces `undefined` lookups that template-literal into the literal
// text "undefined" inside generated tokens.
const BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

if (BASE32_ALPHABET.length !== 32) {
  throw new Error(
    `BASE32_ALPHABET must be exactly 32 characters; got ${BASE32_ALPHABET.length}`,
  );
}

const DEFAULT_BOOTSTRAP_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_NODE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_ROTATION_GRACE_MS = 60 * 60 * 1000; // 1 hour

// Scope vocabulary for `dpfedge_*` tokens. Mirrors the catalog in the
// spec's "Token model" section. Adding a new scope requires updating
// this list and the AGENTS.md governance entry.
export const EDGE_SCOPES = [
  "edge:enroll",
  "edge:heartbeat",
  "edge:rotate",
  "discovery:submit",
  "metrics:submit",
  "mcp:gateway",
  "a2a:gateway",
  "policy:fetch",
] as const;

export type EdgeScope = (typeof EDGE_SCOPES)[number];

// Default scope set for a freshly-enrolled node. The Authority Core can
// narrow per-node via capability policy; these are the baseline scopes
// every trusted node gets.
export const DEFAULT_NODE_SCOPES: ReadonlyArray<EdgeScope> = [
  "edge:heartbeat",
  "edge:rotate",
  "discovery:submit",
  "policy:fetch",
];

export type IssueBootstrapTokenInput = {
  issuedByPrincipalId: string;
  ttlMs?: number;
  metadata?: Record<string, unknown> | null;
};

export type IssueBootstrapTokenResult = {
  tokenId: string;
  plaintext: string;
  prefix: string;
  expiresAt: Date;
};

export type ConsumeBootstrapTokenResult =
  | { ok: true; tokenId: string }
  | {
      ok: false;
      error:
        | "invalid_format"
        | "not_found"
        | "already_consumed"
        | "revoked"
        | "expired";
    };

export type IssueNodeTokenInput = {
  edgeNodeId: string;
  scopes?: ReadonlyArray<EdgeScope>;
  ttlMs?: number;
};

export type IssueNodeTokenResult = {
  tokenId: string;
  plaintext: string;
  prefix: string;
  expiresAt: Date;
  scopes: EdgeScope[];
};

export type RotateNodeTokenInput = {
  currentTokenPlaintext: string;
  scopes?: ReadonlyArray<EdgeScope>;
  ttlMs?: number;
  graceMs?: number;
};

export type RotateNodeTokenResult =
  | (IssueNodeTokenResult & { ok: true; edgeNodeId: string })
  | { ok: false; error: ResolveErrorReason };

export type ResolvedNodeToken = {
  tokenId: string;
  edgeNodeId: string;
  scopes: EdgeScope[];
};

export type ResolveErrorReason =
  | "invalid_format"
  | "not_found"
  | "revoked"
  | "expired"
  | "rotated_out_of_grace";

export type ResolveNodeTokenResult =
  | { ok: true; token: ResolvedNodeToken }
  | { ok: false; error: ResolveErrorReason };

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

function generateToken(): { plaintext: string; hash: string; prefix: string } {
  const secret = encodeBase32(randomBytes(SECRET_BYTES));
  const plaintext = `${EDGE_TOKEN_PREFIX}${secret}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  const prefix = plaintext.slice(0, PREFIX_DISPLAY_LENGTH);
  return { plaintext, hash, prefix };
}

function hashSecret(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function hasEdgePrefix(plaintext: unknown): plaintext is string {
  return typeof plaintext === "string" && plaintext.startsWith(EDGE_TOKEN_PREFIX);
}

function isExpired(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() < now.getTime();
}

// --- Bootstrap tokens ----------------------------------------------------

export async function issueBootstrapToken(
  input: IssueBootstrapTokenInput,
): Promise<IssueBootstrapTokenResult> {
  const { plaintext, hash, prefix } = generateToken();
  const ttl = input.ttlMs ?? DEFAULT_BOOTSTRAP_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);

  const row = await prisma.bootstrapToken.create({
    data: {
      tokenHash: hash,
      prefix,
      scope: "edge:enroll",
      issuedByPrincipalId: input.issuedByPrincipalId,
      expiresAt,
      metadata: (input.metadata ?? undefined) as object | undefined,
    },
  });

  return {
    tokenId: row.id,
    plaintext,
    prefix,
    expiresAt,
  };
}

// Validates a bootstrap-token plaintext and marks it consumed by a
// specific Edge Node. Single-use semantics enforced by the
// `consumedByEdgeNodeId @unique` constraint on BootstrapToken.
export async function consumeBootstrapToken(
  plaintext: string,
  edgeNodeId: string,
): Promise<ConsumeBootstrapTokenResult> {
  if (!hasEdgePrefix(plaintext)) {
    return { ok: false, error: "invalid_format" };
  }
  const hash = hashSecret(plaintext);
  const row = await prisma.bootstrapToken.findUnique({
    where: { tokenHash: hash },
  });
  if (!row) return { ok: false, error: "not_found" };
  if (row.revokedAt) return { ok: false, error: "revoked" };
  if (row.consumedAt) return { ok: false, error: "already_consumed" };
  if (isExpired(row.expiresAt)) return { ok: false, error: "expired" };

  // Single-use enforced by `consumedByEdgeNodeId @unique`. If a race
  // tries to consume the same token from two enrolls concurrently, one
  // will succeed and the other will get a Prisma unique-constraint
  // violation — treat that as already_consumed.
  try {
    await prisma.bootstrapToken.update({
      where: { id: row.id },
      data: {
        consumedAt: new Date(),
        consumedByEdgeNodeId: edgeNodeId,
      },
    });
  } catch {
    return { ok: false, error: "already_consumed" };
  }

  return { ok: true, tokenId: row.id };
}

export async function revokeBootstrapToken(
  tokenId: string,
  reason: string,
): Promise<{ ok: boolean; error?: "not_found" }> {
  const existing = await prisma.bootstrapToken.findUnique({
    where: { id: tokenId },
    select: { revokedAt: true, consumedAt: true },
  });
  if (!existing) return { ok: false, error: "not_found" };
  if (existing.consumedAt) return { ok: true };
  if (existing.revokedAt) return { ok: true };
  await prisma.bootstrapToken.update({
    where: { id: tokenId },
    data: { revokedAt: new Date(), revocationReason: reason },
  });
  return { ok: true };
}

// --- Node tokens ---------------------------------------------------------

export async function issueNodeToken(
  input: IssueNodeTokenInput,
): Promise<IssueNodeTokenResult> {
  const { plaintext, hash, prefix } = generateToken();
  const ttl = input.ttlMs ?? DEFAULT_NODE_TOKEN_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);
  const scopes = [...(input.scopes ?? DEFAULT_NODE_SCOPES)];

  const row = await prisma.edgeNodeToken.create({
    data: {
      edgeNodeId: input.edgeNodeId,
      tokenHash: hash,
      prefix,
      scopes,
      expiresAt,
    },
  });

  return {
    tokenId: row.id,
    plaintext,
    prefix,
    expiresAt,
    scopes: scopes as EdgeScope[],
  };
}

export async function resolveNodeToken(
  plaintext: string,
  options: { graceMs?: number; now?: Date } = {},
): Promise<ResolveNodeTokenResult> {
  if (!hasEdgePrefix(plaintext)) {
    return { ok: false, error: "invalid_format" };
  }
  const hash = hashSecret(plaintext);
  const row = await prisma.edgeNodeToken.findUnique({
    where: { tokenHash: hash },
  });
  if (!row) return { ok: false, error: "not_found" };
  if (row.revokedAt) return { ok: false, error: "revoked" };

  const now = options.now ?? new Date();
  const graceMs = options.graceMs ?? DEFAULT_ROTATION_GRACE_MS;

  if (isExpired(row.expiresAt, now)) {
    return { ok: false, error: "expired" };
  }
  if (row.rotatedAt) {
    const graceCutoff = new Date(row.rotatedAt.getTime() + graceMs);
    if (graceCutoff.getTime() < now.getTime()) {
      return { ok: false, error: "rotated_out_of_grace" };
    }
  }

  // Lazy lastUsedAt — fire-and-forget, never block the request.
  prisma.edgeNodeToken
    .update({ where: { id: row.id }, data: { lastUsedAt: now } })
    .catch(() => {});

  return {
    ok: true,
    token: {
      tokenId: row.id,
      edgeNodeId: row.edgeNodeId,
      scopes: row.scopes as EdgeScope[],
    },
  };
}

// Atomic rotation: issue a fresh node token bound to the same EdgeNode
// and stamp `rotatedAt` on the current one so it falls into the grace
// window. The prior token remains valid for `graceMs` after rotation
// to absorb heartbeat-race losses; after that it resolves to
// `rotated_out_of_grace`.
export async function rotateNodeToken(
  input: RotateNodeTokenInput,
): Promise<RotateNodeTokenResult> {
  const resolved = await resolveNodeToken(input.currentTokenPlaintext, {
    graceMs: input.graceMs,
  });
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  const { edgeNodeId, tokenId: currentId } = resolved.token;
  const scopes = input.scopes ?? (resolved.token.scopes as ReadonlyArray<EdgeScope>);

  const result = await prisma.$transaction(async (tx) => {
    await tx.edgeNodeToken.update({
      where: { id: currentId },
      data: { rotatedAt: new Date() },
    });
    const { plaintext, hash, prefix } = generateToken();
    const expiresAt = new Date(Date.now() + (input.ttlMs ?? DEFAULT_NODE_TOKEN_TTL_MS));
    const issued = await tx.edgeNodeToken.create({
      data: {
        edgeNodeId,
        tokenHash: hash,
        prefix,
        scopes: [...scopes],
        expiresAt,
      },
    });
    await tx.edgeNode.update({
      where: { id: edgeNodeId },
      data: { tokenRotatedAt: new Date() },
    });
    return { issued, plaintext, prefix, expiresAt };
  });

  return {
    ok: true,
    edgeNodeId,
    tokenId: result.issued.id,
    plaintext: result.plaintext,
    prefix: result.prefix,
    expiresAt: result.expiresAt,
    scopes: scopes as EdgeScope[],
  };
}

export async function revokeNodeToken(
  tokenId: string,
  reason: string,
): Promise<{ ok: boolean; error?: "not_found" }> {
  const existing = await prisma.edgeNodeToken.findUnique({
    where: { id: tokenId },
    select: { revokedAt: true },
  });
  if (!existing) return { ok: false, error: "not_found" };
  if (existing.revokedAt) return { ok: true };
  await prisma.edgeNodeToken.update({
    where: { id: tokenId },
    data: { revokedAt: new Date(), revocationReason: reason },
  });
  return { ok: true };
}

// Revoke every non-revoked token belonging to an Edge Node. Used by the
// quarantine and revocation flows so a compromised node cannot continue
// to use any token it has cached.
export async function revokeAllNodeTokens(
  edgeNodeId: string,
  reason: string,
): Promise<{ count: number }> {
  const result = await prisma.edgeNodeToken.updateMany({
    where: { edgeNodeId, revokedAt: null },
    data: { revokedAt: new Date(), revocationReason: reason },
  });
  return { count: result.count };
}
