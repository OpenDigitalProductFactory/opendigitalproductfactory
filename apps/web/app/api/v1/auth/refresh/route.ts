// POST /api/v1/auth/refresh
//
// Rotates a refresh token and issues a new JWT access token.
// The old refresh token is invalidated and a new one is returned.

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { refreshSchema } from "@dpf/validators";
import { rotateRefreshToken, signAccessToken } from "@/lib/api/jwt";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";

export async function POST(request: Request) {
  try {
    // 1. Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw apiError("INVALID_BODY", "Request body must be valid JSON", 400);
    }

    const parsed = refreshSchema.safeParse(body);
    if (!parsed.success) {
      throw apiError("VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    }

    const { refreshToken: oldToken } = parsed.data;

    // 2. Rotate the refresh token (validates old, deletes it, creates new)
    let newToken: string;
    try {
      newToken = await rotateRefreshToken(oldToken);
    } catch {
      throw apiError("INVALID_TOKEN", "Invalid or expired refresh token", 401);
    }

    // 3. Look up the new token to get the userId
    const tokenRecord = await prisma.apiToken.findUnique({
      where: { token: newToken },
    });

    if (!tokenRecord) {
      throw apiError("INTERNAL_ERROR", "Failed to create refresh token", 500);
    }

    // 4. Look up the user to get current profile for the access token
    const user = await prisma.user.findUnique({
      where: { id: tokenRecord.userId },
      include: { groups: { include: { platformRole: true } } },
    });

    if (!user || !user.isActive) {
      throw apiError("USER_INACTIVE", "User account is inactive or not found", 401);
    }

    // 5. Issue new JWT access token
    const platformRole = user.groups[0]?.platformRole.roleId ?? null;
    const accessToken = await signAccessToken({
      sub: user.id,
      email: user.email,
      platformRole,
      isSuperuser: user.isSuperuser,
    });

    // 6. Return new tokens
    return apiSuccess({
      accessToken,
      refreshToken: newToken,
      expiresIn: 900,
    });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
