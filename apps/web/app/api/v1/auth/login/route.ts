// POST /api/v1/auth/login
//
// Authenticates a workforce user with email + password.
// Returns JWT access token and refresh token for mobile/API clients.

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@dpf/db";
import { loginSchema } from "@dpf/validators";
import { signAccessToken, createRefreshToken } from "@/lib/api/jwt";
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

    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw apiError("VALIDATION_ERROR", "Invalid request body", 400, parsed.error.flatten());
    }

    const { email, password } = parsed.data;

    // 2. Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      include: { groups: { include: { platformRole: true } } },
    });

    if (!user) {
      throw apiError("INVALID_CREDENTIALS", "Invalid email or password", 401);
    }

    // 3. Verify password
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      throw apiError("INVALID_CREDENTIALS", "Invalid email or password", 401);
    }

    // 4. Check user is active
    if (!user.isActive) {
      throw apiError("ACCOUNT_INACTIVE", "User account is inactive", 403);
    }

    // 5. Check user has at least one UserGroup (workforce users only)
    if (user.groups.length === 0) {
      throw apiError("NO_WORKFORCE_GROUP", "User has no workforce group assignment", 403);
    }

    // 6. Issue JWT access token
    const platformRole = user.groups[0]?.platformRole.roleId ?? null;
    const accessToken = await signAccessToken({
      sub: user.id,
      email: user.email,
      platformRole,
      isSuperuser: user.isSuperuser,
    });

    // 7. Create refresh token
    const refreshToken = await createRefreshToken(user.id);

    // 8. Return tokens
    return apiSuccess({
      accessToken,
      refreshToken,
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
