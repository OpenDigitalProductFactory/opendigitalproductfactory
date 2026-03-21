// GET /api/v1/ops/business-profile — get the active business profile
// PUT /api/v1/ops/business-profile — create or update business profile

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import {
  getBusinessProfile,
  createBusinessProfile,
} from "@/lib/actions/deployment-windows";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const profile = await getBusinessProfile();

    if (!profile) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "No active business profile found" },
        { status: 404 },
      );
    }

    return apiSuccess(profile);
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

    if (!body.profileKey?.trim()) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "profileKey is required" },
        { status: 422 },
      );
    }
    if (!body.name?.trim()) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "name is required" },
        { status: 422 },
      );
    }
    if (!body.businessHours || typeof body.businessHours !== "object") {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "businessHours is required and must be an object" },
        { status: 422 },
      );
    }

    const profile = await createBusinessProfile({
      profileKey: body.profileKey,
      name: body.name,
      description: body.description,
      businessHours: body.businessHours,
      timezone: body.timezone,
      hasStorefront: body.hasStorefront,
      lowTrafficWindows: body.lowTrafficWindows,
    });

    return apiSuccess(profile, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
