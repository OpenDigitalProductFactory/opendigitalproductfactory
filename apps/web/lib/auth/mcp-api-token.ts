// Personal-access-token model for the external MCP transport at /api/mcp/v1.
//
// Issued from the portal admin UI (settings/platform-development), shown to
// the user exactly once at issuance time, then stored only as sha256(secret).
// Resolution path: client sends Authorization: Bearer <secret>; server hashes
// and looks up by tokenHash. Lazy lastUsedAt update on success.
//
// Write-capable tokens require contribution-mode to be configured first so
// every external MCP write is end-to-end traceable to a real GitHub identity
// if it ever becomes a contribution PR.

import { createHash, randomBytes } from "crypto";
import { prisma } from "@dpf/db";

export type McpTokenCapability = "read" | "write";

export type IssueMcpTokenInput = {
  userId: string;
  name: string;
  capability: McpTokenCapability;
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
        | "contribution_mode_required"
        | "invalid_capability";
      message: string;
    };

export type ResolvedMcpToken = {
  tokenId: string;
  userId: string;
  agentId: string | null;
  scopes: string[];
  capability: McpTokenCapability;
};

const TOKEN_PREFIX = "dpfmcp_";
const SECRET_BYTES = 24;
const PREFIX_DISPLAY_LENGTH = 12;

// Base32 alphabet (Crockford-ish, no I/L/O/U). Avoids characters that look
// like each other so tokens are easier for humans to verify visually.
const BASE32_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

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

async function contributionModeConfigured(): Promise<boolean> {
  try {
    const cfg = await prisma.platformDevConfig.findUnique({
      where: { id: "singleton" },
      select: { contributionModel: true },
    });
    return cfg?.contributionModel != null;
  } catch {
    return false;
  }
}

export async function issueMcpApiToken(
  input: IssueMcpTokenInput,
): Promise<IssueMcpTokenResult> {
  const name = input.name?.trim();
  if (!name) {
    return { ok: false, error: "missing_name", message: "name is required" };
  }
  if (input.capability !== "read" && input.capability !== "write") {
    return {
      ok: false,
      error: "invalid_capability",
      message: `capability must be "read" or "write"`,
    };
  }
  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    return {
      ok: false,
      error: "empty_scopes",
      message: "at least one scope is required",
    };
  }
  if (input.capability === "write") {
    const ok = await contributionModeConfigured();
    if (!ok) {
      return {
        ok: false,
        error: "contribution_mode_required",
        message:
          "Configure contribution mode (Admin > Platform Development) before issuing write-capable MCP tokens",
      };
    }
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
      capability: input.capability,
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
    capability: (row.capability as McpTokenCapability) ?? "read",
  };
}

export async function listMcpApiTokens(userId: string): Promise<
  Array<{
    id: string;
    name: string;
    prefix: string;
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
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    capability: (r.capability as McpTokenCapability) ?? "read",
  }));
}
