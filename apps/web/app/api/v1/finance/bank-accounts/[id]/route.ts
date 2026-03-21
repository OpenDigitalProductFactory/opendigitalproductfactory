// GET /api/v1/finance/bank-accounts/:id — bank account detail

import { NextResponse } from "next/server";
import { getBankAccount } from "@/lib/actions/banking";
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

    const account = await getBankAccount(id);
    if (!account) {
      throw apiError("NOT_FOUND", "Bank account not found", 404);
    }

    return apiSuccess(account);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
