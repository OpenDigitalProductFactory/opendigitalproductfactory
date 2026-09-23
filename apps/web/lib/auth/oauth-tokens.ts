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

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { prisma, type Prisma } from "@dpf/db";
import { currentOAuthHuman, resolveOAuthConsent, OAUTH_SETUP_REQUIRED } from "./oauth-identity-binding";
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
  identitySetupRequired: boolean;
};

/** Shared by bearer resolution and server-owned work using an admitted actor. */
export function isCurrentOAuthAccessToken(row: {
  kind: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  oauthClient?: { revokedAt: Date | null } | null;
}, now = Date.now()): boolean {
  return row.kind === "oauth_access" && !row.revokedAt
    && (!row.expiresAt || row.expiresAt.getTime() > now)
    && Boolean(row.oauthClient) && !row.oauthClient?.revokedAt;
}

/** Fields required to revalidate a persisted OAuth actor before queued work. */
export const OAUTH_EXECUTION_AUTHORITY_SELECT = {
  kind: true, revokedAt: true, expiresAt: true, userId: true, agentId: true,
  authorityBindingId: true, oauthClientId: true, resource: true, publicScopes: true, oauthFamilyKey: true,
  oauthClient: { select: { revokedAt: true, registrationKind: true } },
} satisfies Prisma.McpApiTokenSelect;

type OAuthAuthorityRow = Omit<Prisma.McpApiTokenGetPayload<{ select: typeof OAUTH_EXECUTION_AUTHORITY_SELECT }>, "oauthFamilyKey">
  & { oauthFamilyKey?: string | null };

/** Admission does not preserve revoked consent while a request waits in a queue. */
export async function isCurrentOAuthExecutionAuthority(row: OAuthAuthorityRow,
  db: Pick<Prisma.TransactionClient, "user" | "agent" | "authorityBinding" | "mcpApiToken"> = prisma,
): Promise<boolean> {
  if (row.kind !== "oauth_access" || row.revokedAt || !row.oauthClient || row.oauthClient.revokedAt
    || !await currentOAuthHuman(row.userId, db)) return false;
  if (!isCurrentOAuthAccessToken(row)) {
    // This is queued-work continuity, never bearer authentication. A rotated
    // credential can sustain only the same human/client/consent/scope envelope.
    if (!row.oauthClientId || (!row.oauthFamilyKey && row.oauthClient.registrationKind !== "credentials")) return false;
    const successor = await db.mcpApiToken.findFirst({ where: {
      kind: "oauth_access", userId: row.userId, oauthClientId: row.oauthClientId,
      authorityBindingId: row.authorityBindingId, agentId: row.agentId, resource: row.resource,
      ...(row.oauthFamilyKey ? { oauthFamilyKey: row.oauthFamilyKey } : {}),
      revokedAt: null, expiresAt: { gt: new Date() }, publicScopes: { hasEvery: row.publicScopes },
      oauthClient: { revokedAt: null },
    }, select: OAUTH_EXECUTION_AUTHORITY_SELECT });
    if (!successor || !isCurrentOAuthAccessToken(successor)) return false;
  }
  if (!row.authorityBindingId) return row.oauthClient?.registrationKind === "credentials";
  if (!row.oauthClientId || !row.resource) return false;
  const consent = await resolveOAuthConsent({ bindingId: row.authorityBindingId,
    userId: row.userId, clientId: row.oauthClientId, resource: row.resource, scopes: row.publicScopes }, db);
  return Boolean(consent && consent.agentId === row.agentId);
}

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
    include: { oauthClient: { select: { id: true, oAuthClientId: true, revokedAt: true, registrationKind: true } } },
  });
  if (!row) return null;
  if (!isCurrentOAuthAccessToken(row)) return null;
  if (!row.resource || !resourceMatches(row.resource, origin)) return null;
  if (!await currentOAuthHuman(row.userId)) return null;
  if (row.authorityBindingId) {
    const consent = await resolveOAuthConsent({ bindingId: row.authorityBindingId,
      userId: row.userId, clientId: row.oauthClientId!, resource: row.resource, scopes: row.publicScopes });
    if (!consent || consent.agentId !== row.agentId) return null;
  }

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
      // Only reachable after resolveOAuthConsent above accepted the binding.
      authorityBindingId: row.authorityBindingId ?? null,
    },
    publicScopes,
    clientId: row.oauthClient?.oAuthClientId ?? null,
    identitySetupRequired: row.oauthClient?.registrationKind !== "credentials" && !row.authorityBindingId,
  };
}

export type IssueAccessTokenInput = {
  authorityBindingId?: string | null;
  oauthFamilyKey?: string | null;
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
export async function issueAccessToken(input: IssueAccessTokenInput, db: Prisma.TransactionClient = prisma): Promise<IssuedAccessToken> {
  const ttl = input.ttlSeconds ?? accessTokenTtlSeconds();
  const { plaintext, hash } = mint(ACCESS_TOKEN_PREFIX);
  const grants = grantsForPublicScopes(input.publicScopes);
  const scope = coarseScopeForPublicScopes(input.publicScopes);
  const expiresAt = new Date(Date.now() + ttl * 1000);

  await db.mcpApiToken.create({
    data: {
      authorityBindingId: input.authorityBindingId ?? null,
      oauthFamilyKey: input.oauthFamilyKey ?? null,
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
  authorityBindingId?: string | null;
  oauthFamilyKey?: string | null;
  userId: string;
  agentId?: string | null;
  /** OAuthClient ROW id — a real foreign key. */
  oauthClientRowId: string;
  publicScopes: PublicScope[];
  origin: string;
};

export async function issueRefreshToken(input: IssueRefreshTokenInput, db: Prisma.TransactionClient = prisma): Promise<string> {
  const { plaintext, hash } = mint(REFRESH_TOKEN_PREFIX);
  await db.oAuthRefreshToken.create({
    data: {
      authorityBindingId: input.authorityBindingId ?? null,
      oauthFamilyKey: input.oauthFamilyKey ?? null,
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

async function revokeOAuthFamily(db: Prisma.TransactionClient, oauthFamilyKey: string, reason: string) {
  const where = { oauthFamilyKey, revokedAt: null };
  const data = { revokedAt: new Date(), revokedReason: reason };
  await db.oAuthRefreshToken.updateMany({ where, data });
  await db.mcpApiToken.updateMany({ where, data });
}

/** New credential families revoke refresh and access tokens together. Old
 * unbound rows retain successor-chain revocation; they cannot refresh again. */
export async function revokeRefreshFamily(startId: string, reason: string): Promise<void> {
  const member = await prisma.oAuthRefreshToken.findUnique({ where: { id: startId } });
  if (!member) return;
  if (member.oauthFamilyKey) {
    await prisma.$transaction(async (db) => {
      await revokeOAuthFamily(db, member.oauthFamilyKey!, reason);
    });
    return;
  }
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
  authorityBindingId?: string | null;
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
  db: Prisma.TransactionClient = prisma,
): Promise<string> {
  const { plaintext, hash } = mint(AUTH_CODE_PREFIX);
  await db.oAuthAuthorizationCode.create({
    data: {
      authorityBindingId: input.authorityBindingId ?? null,
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
      authorityBindingId: string;
      agentId: string;
      agentRecordId: string;
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
  db: Prisma.TransactionClient = prisma,
): Promise<ConsumeAuthorizationCodeResult> {
  if (!plaintext.startsWith(AUTH_CODE_PREFIX)) {
    return { accepted: false, error: "invalid_grant", detail: "malformed code" };
  }
  const hash = sha256(plaintext);
  const row = await db.oAuthAuthorizationCode.findUnique({ where: { codeHash: hash } });
  if (!row) return { accepted: false, error: "invalid_grant", detail: "unknown code" };

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

  if (!row.authorityBindingId) return { accepted: false, error: "invalid_grant", detail: OAUTH_SETUP_REQUIRED };
  const consent = await resolveOAuthConsent({ bindingId: row.authorityBindingId,
    userId: row.userId, clientId: row.oauthClientId, resource: row.resource, scopes: row.scopes }, db);
  if (!consent) return { accepted: false, error: "invalid_grant", detail: OAUTH_SETUP_REQUIRED };

  const claimed = await db.oAuthAuthorizationCode.updateMany({
    where: { codeHash: hash, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count === 0) {
    return { accepted: false, error: "invalid_grant", detail: "code already used" };
  }

  return {
    accepted: true,
    authorityBindingId: row.authorityBindingId,
    agentId: consent.agentId,
    agentRecordId: consent.agentRecordId,
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

type ExchangeResult = { accepted: true; issued: IssuedAccessToken; refresh: string }
  | { accepted: false; error: "invalid_grant" | "invalid_scope"; detail: string };

async function issuePair(input: IssueAccessTokenInput & { agentRecordId: string }, db: Prisma.TransactionClient) {
  const issued = await issueAccessToken(input, db);
  const refresh = await issueRefreshToken({ ...input, agentId: input.agentRecordId }, db);
  return { accepted: true as const, issued, refresh };
}

export async function exchangeOAuthCode(input: {
  code: string; clientId: string; clientLabel: string; origin: string;
  redirectUri: string; codeVerifier: string; resource: string | null;
}): Promise<ExchangeResult> {
  return prisma.$transaction(async (db) => {
    const consumed = await consumeAuthorizationCode(input.code, {
      oauthClientRowId: input.clientId, redirectUri: input.redirectUri,
      codeVerifier: input.codeVerifier, resource: input.resource,
    }, db);
    if (!consumed.accepted) return consumed;
    return issuePair({ userId: consumed.userId, agentId: consumed.agentId, agentRecordId: consumed.agentRecordId,
      authorityBindingId: consumed.authorityBindingId, oauthFamilyKey: randomUUID(),
      oauthClientRowId: input.clientId, clientLabel: input.clientLabel,
      origin: input.origin, publicScopes: consumed.scopes }, db);
  });
}

export async function rotateOAuthRefreshToken(input: {
  token: string; clientId: string; clientLabel: string; origin: string;
  requestedScopes?: PublicScope[];
}): Promise<ExchangeResult> {
  return prisma.$transaction(async (db) => {
    const denied = (detail: string) => ({ accepted: false as const, error: "invalid_grant" as const, detail });
    const row = await db.oAuthRefreshToken.findUnique({ where: { tokenHash: sha256(input.token) } });
    if (!row || row.oauthClientId !== input.clientId || !resourceMatches(row.resource, input.origin))
      return denied("Refresh token does not match this connection.");
    if (row.oauthFamilyKey && (row.consumedAt || row.rotatedToId)) {
      await revokeOAuthFamily(db, row.oauthFamilyKey, "refresh_token_replayed");
      return denied("This connection was reused. Reconnect to continue.");
    }
    if (row.revokedAt || row.expiresAt.getTime() <= Date.now()) return denied("Reconnect to continue.");
    if (!row.authorityBindingId || !row.oauthFamilyKey) return denied(OAUTH_SETUP_REQUIRED);
    const consent = await resolveOAuthConsent({ bindingId: row.authorityBindingId,
      userId: row.userId, clientId: input.clientId, resource: row.resource, scopes: row.scopes }, db);
    if (!consent || consent.agentRecordId !== row.agentId) return denied(OAUTH_SETUP_REQUIRED);
    const requested = input.requestedScopes;
    if (requested && (!requested.length || requested.some((scope) => !row.scopes.includes(scope))))
      return { accepted: false as const, error: "invalid_scope" as const, detail: "Request only previously approved permissions." };
    const claimed = await db.oAuthRefreshToken.updateMany({ where: {
      id: row.id, consumedAt: null, rotatedToId: null, revokedAt: null,
    }, data: { consumedAt: new Date() } });
    if (claimed.count !== 1) {
      await revokeOAuthFamily(db, row.oauthFamilyKey, "refresh_token_replayed");
      return denied("This connection was reused. Reconnect to continue.");
    }
    const pair = await issuePair({ userId: row.userId, agentId: consent.agentId, agentRecordId: consent.agentRecordId,
      authorityBindingId: row.authorityBindingId, oauthFamilyKey: row.oauthFamilyKey,
      oauthClientRowId: input.clientId, clientLabel: input.clientLabel,
      origin: input.origin, publicScopes: requested ?? row.scopes.filter(isPublicScope) }, db);
    const successor = await db.oAuthRefreshToken.findUnique({ where: { tokenHash: sha256(pair.refresh) }, select: { id: true } });
    if (!successor) throw new Error("Refresh successor was not persisted.");
    await db.oAuthRefreshToken.update({ where: { id: row.id }, data: { rotatedToId: successor.id } });
    return pair;
  });
}

/** Store an operator-issued client secret. Hash for lookup, encrypted copy so
 *  the operator can re-read it — a headless client's secret has to be
 *  recoverable, unlike a short-lived access token. */
export function prepareClientSecret(): { plaintext: string; hash: string; enc: string } {
  const plaintext = `dpfocs_${randomBytes(SECRET_BYTES).toString("base64url")}`;
  return { plaintext, hash: sha256(plaintext), enc: encryptSecret(plaintext) };
}
