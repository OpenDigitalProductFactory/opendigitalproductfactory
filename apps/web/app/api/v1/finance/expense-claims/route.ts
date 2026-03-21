// GET /api/v1/finance/expense-claims — paginated list with status + employeeOnly filters
// POST /api/v1/finance/expense-claims — create a new expense claim

import { NextResponse } from "next/server";
import { createExpenseClaimSchema } from "@/lib/expense-validation";
import { createExpenseClaim, listExpenseClaims } from "@/lib/actions/expenses";
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
    const employeeOnly = url.searchParams.get("employeeOnly") === "true";

    const claims = await listExpenseClaims({
      status: statusFilter,
      employeeOnly,
    });

    return apiSuccess(buildPaginatedResponse(claims, limit));
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
    const parsed = createExpenseClaimSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const claim = await createExpenseClaim(parsed.data);

    return apiSuccess(claim, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
