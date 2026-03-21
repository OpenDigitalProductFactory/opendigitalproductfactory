// GET /api/v1/finance/expense-claims/[id] — fetch a single expense claim
// PATCH /api/v1/finance/expense-claims/[id] — update status (with transition handling)

import { NextResponse } from "next/server";
import { updateExpenseClaimSchema } from "@/lib/expense-validation";
import { getExpenseClaim } from "@/lib/actions/expenses";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    await authenticateRequest(request);

    const { id } = await params;
    const claim = await getExpenseClaim(id);
    if (!claim) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "Expense claim not found" },
        { status: 404 },
      );
    }

    return apiSuccess(claim);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await authenticateRequest(request);

    const { id } = await params;
    const body = await request.json();
    const parsed = updateExpenseClaimSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    // Handle status transitions with appropriate timestamps
    const updateData: Record<string, unknown> = { ...parsed.data };

    if (parsed.data.status === "submitted") {
      updateData.submittedAt = new Date();
    } else if (parsed.data.status === "approved") {
      updateData.approvedAt = new Date();
    } else if (parsed.data.status === "paid") {
      updateData.paidAt = new Date();
    }

    const claim = await prisma.expenseClaim.update({
      where: { id },
      data: updateData,
    });

    return apiSuccess(claim);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
