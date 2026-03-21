// POST /api/v1/ops/changes/:id/execute — execute change items in the RFC

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { executeChangeItems } from "@/lib/change-executor";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id: rfcId } = await params;

    const result = await executeChangeItems(rfcId);

    return apiSuccess(result);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    const message = e instanceof Error ? e.message : "An unexpected error occurred";
    if (message.includes("not found")) {
      return NextResponse.json(
        { code: "NOT_FOUND", message },
        { status: 404 },
      );
    }
    if (message.includes("must be in")) {
      return NextResponse.json(
        { code: "INVALID_STATE", message },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
