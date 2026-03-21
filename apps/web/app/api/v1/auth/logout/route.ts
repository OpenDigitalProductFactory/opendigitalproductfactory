// POST /api/v1/auth/logout
//
// Revokes a refresh token (or all mobile-refresh tokens for the user).
// Requires authentication via Bearer JWT.

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { revokeRefreshToken } from "@/lib/api/jwt";
import { ApiError } from "@/lib/api/error";

export async function POST(request: Request) {
  try {
    // 1. Verify caller is authenticated
    const { user } = await authenticateRequest(request);

    // 2. Try to get refresh token from request body
    let refreshToken: string | undefined;
    try {
      const body = await request.json();
      if (body && typeof body.refreshToken === "string" && body.refreshToken.length > 0) {
        refreshToken = body.refreshToken;
      }
    } catch {
      // No body or invalid JSON — that's fine, we'll revoke all
    }

    // 3. Revoke specific token or all mobile-refresh tokens for the user
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    } else {
      await prisma.apiToken.deleteMany({
        where: { userId: user.id, name: "mobile-refresh" },
      });
    }

    // 4. Return 204 No Content
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
