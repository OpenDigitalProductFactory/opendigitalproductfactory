// Personal-access-token model for the external MCP transport at /api/mcp/v1.
//
// Issued from the portal admin UI (settings/platform-development), stored as
// sha256(secret) for request lookup plus encrypted plaintext for copy/rotate.
// Resolution path: client sends Authorization: Bearer <secret>; server hashes
// and looks up by tokenHash. Lazy lastUsedAt update on success.
//
import { createHash, randomBytes } from "crypto";
import { prisma } from "@dpf/db";
import { decryptSecret, encryptSecret } from "@/lib/govern/credential-crypto";

export type McpTokenScope = "read" | "write" | "admin";
export type McpTokenCapability = "read" | "write";

export type IssueMcpTokenInput = {
  userId: string;
  name: string;
  /**
   * Coarse token authority tier. `capability` is accepted for old internal
   * callers, but new persisted tokens use `scope` as the source of truth.
   */
  scope?: McpTokenScope;
  capability?: McpTokenCapability;
  scopes: string[];
  expiresInDays: number | null;
  agentId?: string | null;
  /**
   * Lifecycle classification.
   * - "operator" (default): manually issued, manually revoked.
   * - "ephemeral_ship": auto-issued on FeatureBuild review→ship transition,
   *   auto-revoked on ship exit. Requires `buildId` to be set.
   * Persisted to McpApiToken.kind.
   */
  kind?: "operator" | "ephemeral_ship";
  /**
   * FeatureBuild owning this token's lifecycle. Set when kind is an
   * ephemeral_* variant; null for operator tokens. Persisted as a loose FK
   * (no Prisma relation) so a build delete does not cascade-delete the
   * audit row.
   */
  buildId?: string | null;
};

export type IssueMcpTokenResult =
  | {
      ok: true;
      tokenId: string;
      plaintext: string;
      prefix: string;
      tokenSuffix: string;
      expiresAt: Date | null;
    }
  | {
      ok: false;
      error:
        | "missing_name"
        | "empty_scopes"
        | "invalid_scope"
        | "invalid_capability"
        | "missing_build_id";
      message: string;
    };

export type ResolvedMcpToken = {
  tokenId: string;
  userId: string;
  agentId: string | null;
  scopes: string[];
  scope: McpTokenScope;
  capability: McpTokenCapability;
};

export type AddMcpTokenScopesResult =
  | {
      ok: true;
      scopes: string[];
      addedScopes: string[];
    }
  | {
      ok: false;
      error: "not_found" | "revoked" | "expired";
    };

export type CopyMcpTokenPlaintextResult =
  | {
      ok: true;
      plaintext: string;
      prefix: string;
      tokenSuffix: string;
    }
  | {
      ok: false;
      error: "not_found" | "revoked" | "expired" | "unavailable" | "decrypt_failed";
    };

export type RefreshMcpTokenResult =
  | {
      ok: true;
      tokenId: string;
      prefix: string;
      tokenSuffix: string;
      scope: McpTokenScope;
      capability: McpTokenCapability;
      scopes: string[];
    }
  | {
      ok: false;
      error: "invalid_token";
    };

export type RotateMcpTokenInput = {
  tokenId: string;
  userId: string;
};

export type RotateMcpTokenResult =
  | {
      ok: true;
      tokenId: string;
      revokedTokenId: string;
      plaintext: string;
      prefix: string;
      tokenSuffix: string;
      expiresAt: Date | null;
    }
  | {
      ok: false;
      error: "not_found_or_not_yours" | "revoked" | "expired" | "empty_scopes" | "invalid_capability";
      message?: string;
    };

const TOKEN_PREFIX = "dpfmcp_";
const SECRET_BYTES = 24;
const PREFIX_DISPLAY_LENGTH = 12;

// Crockford base32 (RFC-style 32 symbols, excluding I/L/O/U for visual
// disambiguation). MUST be exactly 32 characters — `& 31` indexes 0..31, so
// a shorter alphabet produces `undefined` lookups that template-literal
// into the literal text "undefined" inside generated tokens.
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

function generateToken(): {
  plaintext: string;
  hash: string;
  prefix: string;
  tokenSuffix: string;
  secretEnc: string;
} {
  const secret = encodeBase32(randomBytes(SECRET_BYTES));
  const plaintext = `${TOKEN_PREFIX}${secret}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  const prefix = plaintext.slice(0, PREFIX_DISPLAY_LENGTH);
  const tokenSuffix = plaintext.slice(-4);
  const secretEnc = encryptSecret(plaintext);
  return { plaintext, hash, prefix, tokenSuffix, secretEnc };
}

function hashSecret(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function isMcpTokenScope(value: unknown): value is McpTokenScope {
  return value === "read" || value === "write" || value === "admin";
}

function isLegacyCapability(value: unknown): value is McpTokenCapability {
  return value === "read" || value === "write";
}

function scopeToCapability(scope: McpTokenScope): McpTokenCapability {
  return scope === "read" ? "read" : "write";
}

function normalizePersistedScope(scope: unknown, capability: unknown): McpTokenScope {
  if (isMcpTokenScope(scope)) return scope;
  if (capability === "write") return "write";
  return "read";
}

export async function issueMcpApiToken(
  input: IssueMcpTokenInput,
): Promise<IssueMcpTokenResult> {
  const name = input.name?.trim();
  if (!name) {
    return { ok: false, error: "missing_name", message: "name is required" };
  }
  if (input.capability !== undefined && !isLegacyCapability(input.capability)) {
    return {
      ok: false,
      error: "invalid_capability",
      message: `capability must be "read" or "write"`,
    };
  }
  const scope = input.scope ?? input.capability ?? "read";
  if (!isMcpTokenScope(scope)) {
    return {
      ok: false,
      error: "invalid_scope",
      message: `scope must be "read", "write", or "admin"`,
    };
  }
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    return {
      ok: false,
      error: "empty_scopes",
      message: "at least one scope is required",
    };
  }

  const { plaintext, hash, prefix, tokenSuffix, secretEnc } = generateToken();
  const expiresAt =
    input.expiresInDays != null
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  const kind = input.kind ?? "operator";
  if (kind === "ephemeral_ship" && !input.buildId) {
    return {
      ok: false,
      error: "missing_build_id",
      message: "buildId is required when kind is 'ephemeral_ship'",
    };
  }

  const row = await prisma.mcpApiToken.create({
    data: {
      userId: input.userId,
      agentId: input.agentId ?? null,
      name,
      tokenHash: hash,
      prefix,
      tokenSuffix,
      secretEnc,
      scopes: input.scopes,
      capability: scopeToCapability(scope),
      scope,
      expiresAt,
      kind,
      buildId: input.buildId ?? null,
    },
  });

  return {
    ok: true,
    tokenId: row.id,
    plaintext,
    prefix,
    tokenSuffix,
    expiresAt,
  };
}

export async function copyMcpApiTokenPlaintext(
  tokenId: string,
): Promise<CopyMcpTokenPlaintextResult> {
  const row = await prisma.mcpApiToken.findUnique({
    where: { id: tokenId },
    select: {
      prefix: true,
      tokenSuffix: true,
      secretEnc: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  if (!row) return { ok: false, error: "not_found" };
  if (row.revokedAt != null) return { ok: false, error: "revoked" };
  if (row.expiresAt != null && row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "expired" };
  }
  if (!row.secretEnc) return { ok: false, error: "unavailable" };

  let plaintext: string | null = null;
  try {
    plaintext = decryptSecret(row.secretEnc);
  } catch {
    return { ok: false, error: "decrypt_failed" };
  }
  if (!plaintext) return { ok: false, error: "decrypt_failed" };
  return {
    ok: true,
    plaintext,
    prefix: row.prefix,
    tokenSuffix: row.tokenSuffix ?? plaintext.slice(-4),
  };
}

export async function rotateMcpApiToken(
  input: RotateMcpTokenInput,
): Promise<RotateMcpTokenResult> {
  const existing = await prisma.mcpApiToken.findUnique({
    where: { id: input.tokenId },
    select: {
      id: true,
      userId: true,
      agentId: true,
      name: true,
      capability: true,
      scope: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  if (!existing || existing.userId !== input.userId) {
    return { ok: false, error: "not_found_or_not_yours" };
  }
  if (existing.revokedAt != null) {
    return { ok: false, error: "revoked", message: "Revoked tokens cannot be rotated." };
  }
  if (existing.expiresAt != null && existing.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "expired", message: "Expired tokens cannot be rotated." };
  }
  const existingScope = normalizePersistedScope(existing.scope, existing.capability);
  if (!Array.isArray(existing.scopes) || existing.scopes.length === 0) {
    return { ok: false, error: "empty_scopes" };
  }

  const { plaintext, hash, prefix, tokenSuffix, secretEnc } = generateToken();
  const now = new Date();
  const replacementName = existing.name.endsWith(" (rotated)")
    ? existing.name
    : `${existing.name} (rotated)`;

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.mcpApiToken.create({
      data: {
        userId: existing.userId,
        agentId: existing.agentId,
        name: replacementName,
        tokenHash: hash,
        prefix,
        tokenSuffix,
        secretEnc,
        scopes: existing.scopes,
        capability: scopeToCapability(existingScope),
        scope: existingScope,
        expiresAt: existing.expiresAt,
      },
    });
    await tx.mcpApiToken.update({
      where: { id: existing.id },
      data: {
        revokedAt: now,
        revokedReason: `rotated to ${prefix}...${tokenSuffix}`,
      },
    });
    return created;
  });

  return {
    ok: true,
    tokenId: row.id,
    revokedTokenId: existing.id,
    plaintext,
    prefix,
    tokenSuffix,
    expiresAt: row.expiresAt,
  };
}

export async function revokeMcpApiToken(
  tokenId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const existing = await prisma.mcpApiToken.findUnique({
    where: { id: tokenId },
    select: { revokedAt: true },
  });
  if (!existing) return { ok: false, error: "not_found" };
  if (existing.revokedAt) return { ok: true };
  await prisma.mcpApiToken.update({
    where: { id: tokenId },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return { ok: true };
}

export async function addScopesToMcpApiToken(
  tokenId: string,
  scopes: string[],
): Promise<AddMcpTokenScopesResult> {
  const existing = await prisma.mcpApiToken.findUnique({
    where: { id: tokenId },
    select: { scopes: true, revokedAt: true, expiresAt: true },
  });
  if (!existing) return { ok: false, error: "not_found" };
  if (existing.revokedAt) return { ok: false, error: "revoked" };
  if (existing.expiresAt != null && existing.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "expired" };
  }

  const current = Array.isArray(existing.scopes) ? existing.scopes : [];
  const seen = new Set(current);
  const addedScopes: string[] = [];
  const merged = [...current];
  for (const scope of scopes) {
    const trimmed = scope.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    addedScopes.push(trimmed);
    merged.push(trimmed);
  }

  if (addedScopes.length > 0) {
    await prisma.mcpApiToken.update({
      where: { id: tokenId },
      data: { scopes: merged },
    });
  }

  return { ok: true, scopes: merged, addedScopes };
}

export async function resolveMcpApiToken(
  plaintext: string,
): Promise<ResolvedMcpToken | null> {
  if (typeof plaintext !== "string" || !plaintext.startsWith(TOKEN_PREFIX)) {
    return null;
  }
  const hash = hashSecret(plaintext);
  const row = await prisma.mcpApiToken.findUnique({ where: { tokenHash: hash } });
  if (!row) return null;
  if (row.revokedAt != null) return null;
  if (row.expiresAt != null && row.expiresAt.getTime() < Date.now()) return null;

  // Lazy lastUsedAt — fire-and-forget, never block the request.
  prisma.mcpApiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    tokenId: row.id,
    userId: row.userId,
    agentId: row.agentId,
    scopes: row.scopes,
    scope: normalizePersistedScope(row.scope, row.capability),
    capability: scopeToCapability(normalizePersistedScope(row.scope, row.capability)),
  };
}

export async function acknowledgeMcpTokenRefresh(
  plaintext: string,
): Promise<RefreshMcpTokenResult> {
  if (typeof plaintext !== "string" || !plaintext.startsWith(TOKEN_PREFIX)) {
    return { ok: false, error: "invalid_token" };
  }
  const hash = hashSecret(plaintext);
  const row = await prisma.mcpApiToken.findUnique({
    where: { tokenHash: hash },
    select: {
      id: true,
      prefix: true,
      tokenSuffix: true,
      scopes: true,
      capability: true,
      scope: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  if (!row) return { ok: false, error: "invalid_token" };
  if (row.revokedAt != null) return { ok: false, error: "invalid_token" };
  if (row.expiresAt != null && row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "invalid_token" };
  }

  prisma.mcpApiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    ok: true,
    tokenId: row.id,
    prefix: row.prefix,
    tokenSuffix: row.tokenSuffix ?? plaintext.slice(-4),
    scope: normalizePersistedScope(row.scope, row.capability),
    capability: scopeToCapability(normalizePersistedScope(row.scope, row.capability)),
    scopes: row.scopes,
  };
}

export async function listMcpApiTokens(userId: string): Promise<
  Array<{
    id: string;
    name: string;
    prefix: string;
    scope: McpTokenScope;
    tokenSuffix: string;
    canCopy: boolean;
    capability: McpTokenCapability;
    scopes: string[];
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    kind: string;
    buildId: string | null;
    /** Acting coworker this token speaks as; null = anonymous (BI-B986A18B). */
    agentId: string | null;
  }>
> {
  const rows = await prisma.mcpApiToken.findMany({
    where: { userId },
    orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      prefix: true,
      tokenSuffix: true,
      secretEnc: true,
      capability: true,
      scope: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      kind: true,
      buildId: true,
      agentId: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    scope: normalizePersistedScope(r.scope, r.capability),
    capability: scopeToCapability(normalizePersistedScope(r.scope, r.capability)),
    tokenSuffix: r.tokenSuffix ?? r.prefix.slice(-4),
    canCopy: r.secretEnc != null,
  }));
}

/**
 * Revoke every active ephemeral_ship token tied to a given FeatureBuild.
 * Called from transitionBuildPhase when the build leaves the ship phase
 * (complete / failed / phase rollback). Idempotent — already-revoked rows
 * are filtered out by the indexed query.
 *
 * Returns the number of rows that were revoked. Errors bubble; the caller
 * (the phase transition path) catches them so a token-side failure never
 * blocks the phase transition.
 */
export async function revokeEphemeralShipTokensForBuild(
  buildId: string,
  reason: string,
): Promise<{ revokedCount: number }> {
  const result = await prisma.mcpApiToken.updateMany({
    where: {
      buildId,
      kind: "ephemeral_ship",
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
      revokedReason: reason,
    },
  });
  return { revokedCount: result.count };
}
