// GET /api/v1/finance/bank-accounts — list bank accounts
// POST /api/v1/finance/bank-accounts — create a bank account

import { NextResponse } from "next/server";
import { createBankAccountSchema } from "@/lib/banking-validation";
import { createBankAccount, listBankAccounts } from "@/lib/actions/banking";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination.js";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const { limit } = parsePagination(url.searchParams);

    const accounts = await listBankAccounts();

    return apiSuccess(buildPaginatedResponse(accounts, limit));
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
    const parsed = createBankAccountSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const account = await createBankAccount(parsed.data);

    return apiSuccess(account, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
