// apps/web/lib/api/jwt.ts
//
// JWT access-token signing/verification using jose, and refresh-token
// management via the ApiToken Prisma model.

import { SignJWT, jwtVerify } from "jose";
import * as crypto from "crypto";
import { prisma } from "@dpf/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET environment variable is not set");
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// Access tokens (short-lived JWTs)
// ---------------------------------------------------------------------------

export type AccessTokenPayload = {
  sub: string;
  email: string;
  platformRole: string | null;
  isSuperuser: boolean;
  /** RFC 8176 authentication-method references asserted by the issuer. */
  amr?: string[];
  /** Authentication context class asserted by the issuer; never inferred locally. */
  acr?: string | null;
};

const ACCESS_TOKEN_TTL = "15m";

/**
 * Issuer and audience of mobile API access tokens (BI-7B4B5F5D).
 *
 * Several token kinds are HS256-signed with the same AUTH_SECRET: these access
 * tokens, MCP session tokens (lib/mcp/session-token.ts), automation sign-in
 * links (lib/govern/automation-sign-in.ts) and social-auth temp tokens
 * (lib/govern/social-auth.ts). The signature alone proves only that the portal
 * minted the token, not which surface it was minted for, so the verifier
 * requires this exact issuer and audience. A token without them is refused,
 * including an access token minted before this change: the mobile client
 * answers that 401 by refreshing (packages/api-client/src/client.ts), and the
 * refresh route mints a token that carries them.
 */
export const MOBILE_ACCESS_ISSUER = "dpf-portal";
export const MOBILE_ACCESS_AUDIENCE = "dpf-mobile-api";
/** RFC 9068 access-token media type. */
const MOBILE_ACCESS_TOKEN_TYPE = "at+jwt";

/**
 * Sign a short-lived (15-minute) JWT access token.
 */
export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({
    email: payload.email,
    platformRole: payload.platformRole,
    isSuperuser: payload.isSuperuser,
    ...(payload.amr ? { amr: payload.amr } : {}),
    ...(payload.acr ? { acr: payload.acr } : {}),
  })
    .setProtectedHeader({ alg: "HS256", typ: MOBILE_ACCESS_TOKEN_TYPE })
    .setSubject(payload.sub)
    .setIssuer(MOBILE_ACCESS_ISSUER)
    .setAudience(MOBILE_ACCESS_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getSecret());
}

/**
 * Verify a mobile API access token and return the decoded payload.
 * Throws on an invalid or expired token, and on any token minted for another
 * surface (wrong or missing issuer/audience/type, or no subject).
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: MOBILE_ACCESS_ISSUER,
    audience: MOBILE_ACCESS_AUDIENCE,
    typ: MOBILE_ACCESS_TOKEN_TYPE,
    algorithms: ["HS256"],
    requiredClaims: ["sub", "exp", "iat"],
  });
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("Access token has no subject");
  }
  return {
    sub: payload.sub,
    email: (payload.email as string) ?? "",
    platformRole: (payload.platformRole as string | null) ?? null,
    isSuperuser: (payload.isSuperuser as boolean) ?? false,
    amr: Array.isArray(payload.amr)
      ? payload.amr.filter((method): method is string => typeof method === "string")
      : undefined,
    acr: typeof payload.acr === "string" ? payload.acr : null,
  };
}

// ---------------------------------------------------------------------------
// Refresh tokens (long-lived, stored in DB as ApiToken)
// ---------------------------------------------------------------------------

const REFRESH_TOKEN_BYTES = 64; // 128 hex chars
const REFRESH_TOKEN_DAYS = 30;

/**
 * Create a new refresh token for the given user.
 * Stores it as an ApiToken record with name "mobile-refresh" and 30-day expiry.
 * Returns the raw token string (128-char hex).
 */
export async function createRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  await prisma.apiToken.create({
    data: {
      token,
      userId,
      name: "mobile-refresh",
      expiresAt,
    },
  });

  return token;
}

/**
 * Rotate a refresh token: validate and delete the old one, create a new one.
 * Returns the new token string.
 * Throws if old token is not found or is expired.
 */
export async function rotateRefreshToken(oldToken: string): Promise<string> {
  const existing = await prisma.apiToken.findUnique({ where: { token: oldToken } });

  if (!existing) {
    throw new Error("Refresh token not found");
  }

  if (existing.expiresAt && existing.expiresAt.getTime() < Date.now()) {
    throw new Error("Refresh token expired");
  }

  // Delete the old token
  await prisma.apiToken.delete({ where: { id: existing.id } });

  // Create a new one for the same user
  return createRefreshToken(existing.userId);
}

/**
 * Revoke (delete) a refresh token.
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.apiToken.delete({ where: { token } });
}
