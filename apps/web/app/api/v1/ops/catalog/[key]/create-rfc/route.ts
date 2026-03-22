// POST /api/v1/ops/catalog/:key/create-rfc — create RFC from catalog template

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { createRFCFromCatalog } from "@/lib/actions/standard-change-catalog";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    await authenticateRequest(request);

    const { key: catalogKey } = await params;
    const body = await request.json().catch(() => ({}));

    const result = await createRFCFromCatalog(catalogKey, {
      title: body.title,
      description: body.description,
      plannedStartAt: body.plannedStartAt,
      plannedEndAt: body.plannedEndAt,
      deploymentWindowId: body.deploymentWindowId,
    });

    return apiSuccess(result, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    const message = e instanceof Error ? e.message : "An unexpected error occurred";
    if (message.includes("not found")) {
      return NextResponse.json(
        { code: "NOT_FOUND", message },
        { status: 404 },
      );
    }
    if (message.includes("expired")) {
      return NextResponse.json(
        { code: "EXPIRED", message },
        { status: 410 },
      );
    }
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message },
      { status: 500 },
    );
  }
}
