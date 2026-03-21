// GET /api/v1/ops/windows — get available deployment windows
// POST /api/v1/ops/windows — create a deployment window

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import {
  getAvailableWindows,
  createDeploymentWindow,
} from "@/lib/actions/deployment-windows";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const rfcType = url.searchParams.get("rfcType") ?? "normal";
    const riskLevel = url.searchParams.get("riskLevel") ?? "low";

    const windows = await getAvailableWindows(rfcType, riskLevel);

    return apiSuccess({ data: windows });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await authenticateRequest(request);

    const body = await request.json();

    if (!body.businessProfileId?.trim()) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "businessProfileId is required" },
        { status: 422 },
      );
    }
    if (!body.windowKey?.trim()) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "windowKey is required" },
        { status: 422 },
      );
    }
    if (!body.name?.trim()) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "name is required" },
        { status: 422 },
      );
    }
    if (!body.startTime || !body.endTime) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "startTime and endTime are required" },
        { status: 422 },
      );
    }
    if (!Array.isArray(body.dayOfWeek) || body.dayOfWeek.length === 0) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "dayOfWeek must be a non-empty array" },
        { status: 422 },
      );
    }

    const window = await createDeploymentWindow({
      businessProfileId: body.businessProfileId,
      windowKey: body.windowKey,
      name: body.name,
      description: body.description,
      dayOfWeek: body.dayOfWeek,
      startTime: body.startTime,
      endTime: body.endTime,
      maxConcurrentChanges: body.maxConcurrentChanges,
      allowedChangeTypes: body.allowedChangeTypes,
      allowedRiskLevels: body.allowedRiskLevels,
      enforcement: body.enforcement,
    });

    return apiSuccess(window, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
