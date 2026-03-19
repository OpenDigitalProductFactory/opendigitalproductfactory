// POST /api/v1/notifications/register-device — register a push device

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";

export async function POST(request: Request) {
  try {
    const { user } = await authenticateRequest(request);

    const body = await request.json();
    const { token, platform } = body as {
      token?: string;
      platform?: string;
    };

    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "token is required" },
        { status: 422 },
      );
    }

    if (!platform || !["ios", "android"].includes(platform)) {
      return NextResponse.json(
        {
          code: "VALIDATION_ERROR",
          message: "platform must be 'ios' or 'android'",
        },
        { status: 422 },
      );
    }

    const registration = await prisma.pushDeviceRegistration.upsert({
      where: {
        userId_platform: { userId: user.id, platform },
      },
      update: { token },
      create: {
        userId: user.id,
        token,
        platform,
      },
    });

    return apiSuccess(registration, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
