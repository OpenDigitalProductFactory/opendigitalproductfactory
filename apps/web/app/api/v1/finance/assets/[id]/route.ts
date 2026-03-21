// GET /api/v1/finance/assets/:id — asset detail with depreciation schedule
// PATCH /api/v1/finance/assets/:id — dispose asset

import { NextResponse } from "next/server";
import { disposeAssetSchema } from "@/lib/asset-validation";
import { getAsset, disposeAsset } from "@/lib/actions/assets";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError, apiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id } = await params;

    const asset = await getAsset(id);
    if (!asset) {
      throw apiError("NOT_FOUND", "Asset not found", 404);
    }

    return apiSuccess(asset);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id } = await params;

    const body = await request.json();
    const parsed = disposeAssetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const existing = await getAsset(id);
    if (!existing) {
      throw apiError("NOT_FOUND", "Asset not found", 404);
    }

    const result = await disposeAsset(id, parsed.data);

    return apiSuccess({ ...result, id });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
