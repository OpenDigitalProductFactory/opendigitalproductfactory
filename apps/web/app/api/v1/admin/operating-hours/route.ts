// GET /api/v1/admin/operating-hours — get current hours or defaults
// PUT /api/v1/admin/operating-hours — save operating hours

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { getOperatingHours, saveOperatingHours } from "@/lib/actions/operating-hours";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
    const result = await getOperatingHours();
    return apiSuccess(result);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    await authenticateRequest(request);
    const body = await request.json();

    if (!body.schedule) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "schedule is required" },
        { status: 422 },
      );
    }

    await saveOperatingHours({
      schedule: body.schedule,
      timezone: body.timezone,
      hasStorefront: body.hasStorefront,
    });

    return apiSuccess({ success: true });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    const message = e instanceof Error ? e.message : "An unexpected error occurred";
    return NextResponse.json(
      { code: "VALIDATION_ERROR", message },
      { status: 422 },
    );
  }
}
