// GET /api/v1/finance/assets — paginated list with status/category filters
// POST /api/v1/finance/assets — create a new fixed asset

import { NextResponse } from "next/server";
import { createAssetSchema } from "@/lib/asset-validation";
import { createAsset, listAssets } from "@/lib/actions/assets";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const { limit } = parsePagination(url.searchParams);
    const statusFilter = url.searchParams.get("status") ?? undefined;
    const categoryFilter = url.searchParams.get("category") ?? undefined;

    const assets = await listAssets({ status: statusFilter, category: categoryFilter });

    // Apply manual pagination (listAssets returns all matching)
    const paginated = assets.slice(0, limit + 1);

    return apiSuccess(buildPaginatedResponse(paginated, limit));
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
    const parsed = createAssetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const asset = await createAsset(parsed.data);

    return apiSuccess(asset, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
