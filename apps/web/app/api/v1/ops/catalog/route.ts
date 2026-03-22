// GET /api/v1/ops/catalog — list standard change catalog entries
// POST /api/v1/ops/catalog — create a new catalog entry

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import {
  listCatalogEntries,
  createCatalogEntry,
} from "@/lib/actions/standard-change-catalog";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const category = url.searchParams.get("category") ?? undefined;

    const entries = await listCatalogEntries({ category });
    return apiSuccess({ data: entries });
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

    if (!body.catalogKey?.trim()) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "catalogKey is required" },
        { status: 422 },
      );
    }
    if (!body.title?.trim()) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Title is required" },
        { status: 422 },
      );
    }
    if (!body.templateItems?.length) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "At least one template item is required" },
        { status: 422 },
      );
    }

    const result = await createCatalogEntry({
      catalogKey: body.catalogKey,
      title: body.title,
      description: body.description ?? "",
      category: body.category ?? "maintenance",
      preAssessedRisk: body.preAssessedRisk ?? "low",
      templateItems: body.templateItems,
      approvalPolicy: body.approvalPolicy,
      validUntil: body.validUntil,
    });

    return apiSuccess(result, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    const message = e instanceof Error ? e.message : "An unexpected error occurred";
    if (message.includes("Unique constraint")) {
      return NextResponse.json(
        { code: "CONFLICT", message: "A catalog entry with this key already exists" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message },
      { status: 500 },
    );
  }
}
