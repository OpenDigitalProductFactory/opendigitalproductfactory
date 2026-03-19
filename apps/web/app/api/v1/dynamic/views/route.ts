// GET /api/v1/dynamic/views — list dynamic views (stub)

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
    return apiSuccess({ data: [], nextCursor: null });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
