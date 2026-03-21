// GET /api/v1/finance/bills — paginated list of bills with filters
// POST /api/v1/finance/bills — create a new bill

import { NextResponse } from "next/server";
import { createBillSchema } from "@/lib/ap-validation";
import { createBill, listBills } from "@/lib/actions/ap";
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
    const supplierIdFilter = url.searchParams.get("supplierId") ?? undefined;

    const bills = await listBills({ status: statusFilter, supplierId: supplierIdFilter });

    return apiSuccess(buildPaginatedResponse(bills, limit));
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
    const parsed = createBillSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const bill = await createBill(parsed.data);

    return apiSuccess(bill, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
