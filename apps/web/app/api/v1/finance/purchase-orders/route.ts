// GET /api/v1/finance/purchase-orders — paginated list of purchase orders with filters
// POST /api/v1/finance/purchase-orders — create a new purchase order

import { NextResponse } from "next/server";
import { createPOSchema } from "@/lib/ap-validation";
import { createPurchaseOrder, listPurchaseOrders } from "@/lib/actions/ap";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination.js";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const { limit } = parsePagination(url.searchParams);
    const statusFilter = url.searchParams.get("status") ?? undefined;

    const orders = await listPurchaseOrders({ status: statusFilter });

    return apiSuccess(buildPaginatedResponse(orders, limit));
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
    const parsed = createPOSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const po = await createPurchaseOrder(parsed.data);

    return apiSuccess(po, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
