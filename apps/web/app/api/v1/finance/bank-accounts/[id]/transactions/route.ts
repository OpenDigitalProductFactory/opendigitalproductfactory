// GET /api/v1/finance/bank-accounts/:id/transactions — paginated transactions with optional matchStatus filter
// POST /api/v1/finance/bank-accounts/:id/transactions — import transactions from CSV body

import { NextResponse } from "next/server";
import { getTransactions, importTransactions } from "@/lib/actions/banking";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id } = await params;
    const url = new URL(request.url);
    const { limit } = parsePagination(url.searchParams);
    const matchStatusFilter = url.searchParams.get("matchStatus") ?? undefined;

    const transactions = await getTransactions(id, { matchStatus: matchStatusFilter });

    return apiSuccess(buildPaginatedResponse(transactions, limit));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id } = await params;
    const csvContent = await request.text();

    if (!csvContent || csvContent.trim().length === 0) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Request body must contain CSV content" },
        { status: 422 },
      );
    }

    const result = await importTransactions(id, csvContent);

    return apiSuccess(
      { imported: result.imported, errors: result.errors, batchId: result.batchId },
      201,
    );
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
