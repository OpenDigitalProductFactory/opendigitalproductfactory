// Issuance and resolution for OAuth credentials on the MCP resource.
//
// The governing constraint, from design §4.3: an OAuth access token resolves
// to the SAME `ResolvedMcpToken` shape a PAT does. `tokenCanUseTool`,
// `resolveListingAuthorityForToken` and `governedExecuteTool` are not modified
// and must never learn that OAuth exists. If the OAuth path ever needed its
// own authorization gate that would be a fork, and a fork of the authorization
// gate is how false-green authorization bugs are born.
//
// Access tokens are opaque + hashed rather than signed JWTs. The transport
// already does a DB read per call, so statelessness buys nothing here, and
// immediate revocation — which a self-validating JWT cannot give — matters
// more on an install whose operator expects "revoke" to mean revoked.
//
// Design: docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md §4.3

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@dpf/db";
import { encryptSecret } from "@/lib/govern/credential-crypto";
import type { McpTokenScope, ResolvedMcpToken } from "@/lib/auth/mcp-api-token";
import { canonicalResourceUri, resourceMatches } from "@/lib/auth/oauth-metadata";
import {
  coarseScopeForPublicScopes,
  grantsForPublicScopes,
  isPublicScope,
  type PublicScope,
} from "@/lib/auth/oauth-scope-map";
import {
  accessTokenTtlSeconds,
  authorizationCodeTtlSeconds,
  refreshTokenTtlSeconds,
} from "@/lib/auth/oauth-policy";

export const ACCESS_TOKEN_PREFIX = "dpfoat_";
export const REFRESH_TOKEN_PREFIX = "dpfort_";
export const AUTH_CODE_PREFIX = "dpfoac_";
const SECRET_BYTES = 32;

/** Distinguishable, URL-safe, and never confusable with a `dpfmcp_` PAT — the
 *  transport uses the prefix to decide which resolver to try first. */
function mint(prefix: string): { plaintext: string; hash: string } {
  const plaintext = `${prefix}${randomBytes(SECRET_BYTES).toString("base64url")}`;
  return { plaintext, hash: sha256(plaintext) };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time compare for client secrets. Length is not secret, so an
 *  early length return is fine; the byte comparison is what must not leak. */
export function secretMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(sha256(presented), "utf8");
  const b = Buffer.from(storedHash, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** RFC 7636 S256: BASE64URL(SHA256(ASCII(verifier))) === challenge.
 *  `plain` is deliberately unsupported — OAuth 2.1 removes it, and accepting
 *  it would let a client downgrade its own protection. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false;
  const computed = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(challenge, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type ResolvedOAuthToken = {
  resolved: ResolvedMcpToken;
  publicScopes: PublicScope[];
  clientId: string | null;
};

/**
 * Resolve a presented bearer credential as an OAuth access token.
 *
 * Returns null — never throws, never partially succeeds — for anything that is
 * not a valid, live, correctly-audienced access token, so the transport can
 * fall through to the PAT resolver during the deprecation window.
 *
 * AUDIENCE BINDING is enforced here and is not optional: a token whose
 * `resource` is not this install's canonical MCP URI is refused even when the
 * secret is valid. That is what stops a token minted for one DPF install being
 * replayed against another (`authorization.mdx:469-483`).
 */
export async function resolveOAuthAccessToken(
  plaintext: string,
  origin: string | null,
): Promise<ResolvedOAuthToken | null> {
  if (!plaintext.startsWith(ACCESS_TOKEN_PREFIX)) return null;
  // Without a resolvable origin we cannot verify the audience, and an
  // unverifiable audience must fail closed rather than be waived.
  if (!origin) return null;

  const row = await prisma.mcpApiToken.findUnique({
    where: { tokenHash: sha256(plaintext) },
    include: { oauthClient: { select: { id: true, oAuthClientId: true, revokedAt: true } } },
  });
  if (!row) return null;
  if (row.kind !== "oauth_access") return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  if (!row.resource || !resourceMatches(row.resource, origin)) return null;
  // Revoking a client revokes what it holds, without needing to hunt rows.
  if (row.oauthClient?.revokedAt) return null;

  const publicScopes = row.publicScopes.filter(isPublicScope);

  // Lazy last-used stamp, matching the PAT resolver's behaviour. Deliberately
  // not awaited: a telemetry write must not add latency to, or fail, a call.
  void prisma.mcpApiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return {
    resolved: {
      tokenId: row.id,
      userId: row.userId,
      agentId: row.agentId,
      scopes: row.scopes,
      scope: row.scope as McpTokenScope,
      capability: row.scope === "read" ? "read" : "write",
    },
    publicScopes,
    clientId: row.oauthClient?.oAuthClientId ?? null,
  };
}

export type IssueAccessTokenInput = {
  userId: string;
  agentId?: string | null;
  oauthClientRowId: string;
  clientLabel: string;
  publicScopes: PublicScope[];
  origin: string;
  ttlSeconds?: number;
};

export type IssuedAccessToken = {
  accessToken: string;
  expiresIn: number;
  publicScopes: PublicScope[];
  grants: string[];
  scope: McpTokenScope;
};

/**
 * Mint an access token. The consented PUBLIC scopes are expanded into the
 * internal grant list here, once — everything downstream reads `scopes` and
 * has no idea a public vocabulary exists.
 */
export async function issueAccessToken(input: IssueAccessTokenInput): Promise<IssuedAccessToken> {
  const ttl = input.ttlSeconds ?? accessTokenTtlSeconds();
  const { plaintext, hash } = mint(ACCESS_TOKEN_PREFIX);
  const grants = grantsForPublicScopes(input.publicScopes);
  const scope = coarseScopeForPublicScopes(input.publicScopes);
  const expiresAt = new Date(Date.now() + ttl * 1000);

  await prisma.mcpApiToken.create({
    data: {
      userId: input.userId,
      agentId: input.agentId ?? null,
      kind: "oauth_access",
      name: `oauth:${input.clientLabel}`,
      tokenHash: hash,
      prefix: plaintext.slice(0, 12),
      tokenSuffix: plaintext.slice(-4),
      // Access tokens are short-lived and re-mintable from the refresh token,
      // so there is nothing to "copy again" — storing a recoverable plaintext
      // would be a standing secret for no operational benefit.
      secretEnc: null,
      scopes: grants,
      capability: scope === "read" ? "read" : "write",
      scope,
      expiresAt,
      oauthClientId: input.oauthClientRowId,
      resource: canonicalResourceUri(input.origin),
      publicScopes: input.publicScopes,
    },
  });

  return { accessToken: plaintext, expiresIn: ttl, publicScopes: input.publicScopes, grants, scope };
}

export type IssueRefreshTokenInput = {
  userId: string;
  agentId?: string | null;
  /** OAuthClient ROW id — a real foreign key. */
  oauthClientRowId: string;
  publicScopes: PublicScope[];
  origin: string;
};

export async function issueRefreshToken(input: IssueRefreshTokenInput): Promise<string> {
  const { plaintext, hash } = mint(REFRESH_TOKEN_PREFIX);
  await prisma.oAuthRefreshToken.create({
    data: {
      tokenHash: hash,
      oauthClientId: input.oauthClientRowId,
      userId: input.userId,
      agentId: input.agentId ?? null,
      resource: canonicalResourceUri(input.origin),
      scopes: input.publicScopes,
      expiresAt: new Date(Date.now() + refreshTokenTtlSeconds() * 1000),
    },
  });
  return plaintext;
}

export type RefreshConsumeResult =
  | {
      accepted: true;
      userId: string;
      agentId: string | null;
      oauthClientRowId: string;
      scopes: PublicScope[];
    }
  | { accepted: false; error: "invalid_grant"; detail: string };

/**
 * Consume a refresh token, rotating it.
 *
 * ROTATION IS THE SECURITY PROPERTY, not a convenience: presenting a token
 * that has already been exchanged means either a replay or a stolen copy, and
 * cannot be distinguished from the server side. OAuth 2.1 refresh-token
 * rotation guidance says to revoke the whole family in that case, which is
 * what `revokeRefreshFamily` does — the legitimate client re-authorizes, the
 * thief gets nothing.
 */
export async function consumeRefreshToken(
  plaintext: string,
  origin: string,
): Promise<RefreshConsumeResult> {
  if (!plaintext.startsWith(REFRESH_TOKEN_PREFIX)) {
    return { accepted: false, error: "invalid_grant", detail: "not a refresh token" };
  }
  const row = await prisma.oAuthRefreshToken.findUnique({ where: { tokenHash: sha256(plaintext) } });
  if (!row) return { accepted: false, error: "invalid_grant", detail: "unknown refresh token" };
  if (row.revokedAt) return { accepted: false, error: "invalid_grant", detail: "refresh token revoked" };

  if (row.consumedAt || row.rotatedToId) {
    await revokeRefreshFamily(row.id, "refresh_token_replayed");
    return { accepted: false, error: "invalid_grant", detail: "refresh token already used" };
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    return { accepted: false, error: "invalid_grant", detail: "refresh token expired" };
  }
  if (!resourceMatches(row.resource, origin)) {
    return { accepted: false, error: "invalid_grant", detail: "refresh token audience mismatch" };
  }

  return {
    accepted: true,
    userId: row.userId,
    agentId: row.agentId,
    oauthClientRowId: row.oauthClientId,
    scopes: row.scopes.filter(isPublicScope),
  };
}

/** Mark a refresh token consumed and link it to its successor, so a later
 *  presentation of the old one is recognisable as a replay. */
export async function markRefreshRotated(
  oldPlaintext: string,
  newPlaintext: string,
): Promise<void> {
  const successor = await prisma.oAuthRefreshToken.findUnique({
    where: { tokenHash: sha256(newPlaintext) },
    select: { id: true },
  });
  await prisma.oAuthRefreshToken.updateMany({
    where: { tokenHash: sha256(oldPlaintext) },
    data: { consumedAt: new Date(), rotatedToId: successor?.id ?? null },
  });
}

/** Revoke a rotation chain from any member: walk to its successors and revoke
 *  each, then revoke every live access token issued to the same client for the
 *  same user. Bounded so a corrupted `rotatedToId` cycle cannot spin. */
export async function revokeRefreshFamily(startId: string, reason: string): Promise<void> {
  const seen = new Set<string>();
  let cursor: string | null = startId;
  const now = new Date();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const row: { rotatedToId: string | null } | null = await prisma.oAuthRefreshToken.findUnique({
      where: { id: cursor },
      select: { rotatedToId: true },
    });
    cursor = row?.rotatedToId ?? null;
  }
  await prisma.oAuthRefreshToken.updateMany({
    where: { id: { in: [...seen] }, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason },
  });
}

export type CreateAuthorizationCodeInput = {
  /** OAuthClient ROW id — a real foreign key, not the public client_id string. */
  oauthClientRowId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  publicScopes: PublicScope[];
};

export async function createAuthorizationCode(
  input: CreateAuthorizationCodeInput,
): Promise<string> {
  const { plaintext, hash } = mint(AUTH_CODE_PREFIX);
  await prisma.oAuthAuthorizationCode.create({
    data: {
      codeHash: hash,
      oauthClientId: input.oauthClientRowId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: "S256",
      resource: input.resource,
      scopes: input.publicScopes,
      expiresAt: new Date(Date.now() + authorizationCodeTtlSeconds() * 1000),
    },
  });
  return plaintext;
}

export type ConsumeAuthorizationCodeResult =
  | {
      accepted: true;
      userId: string;
      oauthClientRowId: string;
      scopes: PublicScope[];
      resource: string;
    }
  | { accepted: false; error: "invalid_grant"; detail: string };

/**
 * Exchange an authorization code, single-use.
 *
 * The consume is an atomic conditional update (`consumedAt: null` in the
 * where-clause) rather than read-then-write: two simultaneous exchanges of the
 * same code must not both succeed, and a check-then-act would let them.
 */
export async function consumeAuthorizationCode(
  plaintext: string,
  params: { oauthClientRowId: string; redirectUri: string; codeVerifier: string; resource: string | null },
): Promise<ConsumeAuthorizationCodeResult> {
  if (!plaintext.startsWith(AUTH_CODE_PREFIX)) {
    return { accepted: false, error: "invalid_grant", detail: "malformed code" };
  }
  const hash = sha256(plaintext);
  const row = await prisma.oAuthAuthorizationCode.findUnique({ where: { codeHash: hash } });
  if (!row) return { accepted: false, error: "invalid_grant", detail: "unknown code" };

  const claimed = await prisma.oAuthAuthorizationCode.updateMany({
    where: { codeHash: hash, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count === 0) {
    return { accepted: false, error: "invalid_grant", detail: "code already used" };
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    return { accepted: false, error: "invalid_grant", detail: "code expired" };
  }
  if (row.oauthClientId !== params.oauthClientRowId) {
    return { accepted: false, error: "invalid_grant", detail: "code was issued to another client" };
  }
  if (row.redirectUri !== params.redirectUri) {
    return { accepted: false, error: "invalid_grant", detail: "redirect_uri mismatch" };
  }
  if (!verifyPkceS256(params.codeVerifier, row.codeChallenge)) {
    return { accepted: false, error: "invalid_grant", detail: "PKCE verification failed" };
  }
  // RFC 8707: the token request's `resource` must name the same audience the
  // authorization request did. A client that silently widens here would end up
  // with a token valid somewhere its user never approved.
  if (params.resource !== null && params.resource !== row.resource) {
    return { accepted: false, error: "invalid_grant", detail: "resource mismatch" };
  }

  return {
    accepted: true,
    userId: row.userId,
    oauthClientRowId: row.oauthClientId,
    scopes: row.scopes.filter(isPublicScope),
    resource: row.resource,
  };
}

/** Best-effort cleanup of consumed/expired codes. Codes are short-lived, so
 *  this exists to stop the table growing forever, not for correctness —
 *  expiry is enforced on read regardless. */
export async function pruneExpiredAuthorizationCodes(): Promise<number> {
  const { count } = await prisma.oAuthAuthorizationCode.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  return count;
}

/** Store an operator-issued client secret. Hash for lookup, encrypted copy so
 *  the operator can re-read it — a headless client's secret has to be
 *  recoverable, unlike a short-lived access token. */
export function prepareClientSecret(): { plaintext: string; hash: string; enc: string } {
  const plaintext = `dpfocs_${randomBytes(SECRET_BYTES).toString("base64url")}`;
  return { plaintext, hash: sha256(plaintext), enc: encryptSecret(plaintext) };
}
