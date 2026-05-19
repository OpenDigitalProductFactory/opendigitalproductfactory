// Personal-access-token model for the external MCP transport at /api/mcp/v1.
//
// Issued from the portal admin UI (settings/platform-development), shown to
// the user exactly once at issuance time, then stored only as sha256(secret).
// Resolution path: client sends Authorization: Bearer <secret>; server hashes
// and looks up by tokenHash. Lazy lastUsedAt update on success.
//
import { createHash, randomBytes } from "crypto";
import { prisma } from "@dpf/db";

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
};

export type IssueMcpTokenResult =
  | {
      ok: true;
      tokenId: string;
      plaintext: string;
      prefix: string;
      expiresAt: Date | null;
    }
  | {
      ok: false;
      error:
        | "missing_name"
        | "empty_scopes"
        | "invalid_scope"
        | "invalid_capability";
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

function generateToken(): { plaintext: string; hash: string; prefix: string } {
  const secret = encodeBase32(randomBytes(SECRET_BYTES));
  const plaintext = `${TOKEN_PREFIX}${secret}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  const prefix = plaintext.slice(0, PREFIX_DISPLAY_LENGTH);
  return { plaintext, hash, prefix };
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

  const { plaintext, hash, prefix } = generateToken();
  const expiresAt =
    input.expiresInDays != null
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  const row = await prisma.mcpApiToken.create({
    data: {
      userId: input.userId,
      agentId: input.agentId ?? null,
      name,
      tokenHash: hash,
      prefix,
      scopes: input.scopes,
      capability: scopeToCapability(scope),
      scope,
      expiresAt,
    },
  });

  return {
    ok: true,
    tokenId: row.id,
    plaintext,
    prefix,
    expiresAt,
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

export async function listMcpApiTokens(userId: string): Promise<
  Array<{
    id: string;
    name: string;
    prefix: string;
    scope: McpTokenScope;
    capability: McpTokenCapability;
    scopes: string[];
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }>
> {
  const rows = await prisma.mcpApiToken.findMany({
    where: { userId },
    orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      prefix: true,
      capability: true,
      scope: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    scope: normalizePersistedScope(r.scope, r.capability),
    capability: scopeToCapability(normalizePersistedScope(r.scope, r.capability)),
  }));
}
