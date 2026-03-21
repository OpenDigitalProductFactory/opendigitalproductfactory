// GET /api/v1/ops/changes — list RFCs with optional filters
// POST /api/v1/ops/changes — create a new RFC

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { listRFCs, createRFC } from "@/lib/actions/change-management";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    const type = url.searchParams.get("type") ?? undefined;
    const scope = url.searchParams.get("scope") ?? undefined;

    const rfcs = await listRFCs({ status, type, scope });

    return apiSuccess({ data: rfcs });
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

    if (!body.title?.trim()) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Title is required" },
        { status: 422 },
      );
    }
    if (!body.description?.trim()) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Description is required" },
        { status: 422 },
      );
    }

    const result = await createRFC({
      title: body.title,
      description: body.description,
      type: body.type,
      scope: body.scope,
      riskLevel: body.riskLevel,
    });

    return apiSuccess(result, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
