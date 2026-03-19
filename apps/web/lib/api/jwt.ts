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
};

const ACCESS_TOKEN_TTL = "15m";

/**
 * Sign a short-lived (15-minute) JWT access token.
 */
export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({
    email: payload.email,
    platformRole: payload.platformRole,
    isSuperuser: payload.isSuperuser,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getSecret());
}

/**
 * Verify a JWT access token and return the decoded payload.
 * Throws on invalid/expired tokens.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  return {
    sub: payload.sub ?? "",
    email: (payload.email as string) ?? "",
    platformRole: (payload.platformRole as string | null) ?? null,
    isSuperuser: (payload.isSuperuser as boolean) ?? false,
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
