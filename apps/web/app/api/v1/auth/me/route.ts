// GET /api/v1/auth/me
//
// Returns the authenticated user's profile and capabilities.
// Requires authentication via Bearer JWT or NextAuth session.

import { NextResponse } from "next/server";
import type { MeResponse } from "@dpf/types";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    // 1. Authenticate the request
    const { user, capabilities } = await authenticateRequest(request);

    // 2. Return user profile with capabilities
    return apiSuccess({
      id: user.id,
      email: user.email,
      platformRole: user.platformRole,
      isSuperuser: user.isSuperuser,
      capabilities,
    } satisfies MeResponse);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
