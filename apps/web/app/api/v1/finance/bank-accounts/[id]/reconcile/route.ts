// POST /api/v1/finance/bank-accounts/:id/reconcile — reconciliation actions
//
// Actions:
//   { action: "match",   transactionId, paymentId }  — match a transaction to a payment
//   { action: "unmatch", transactionId }              — remove an existing match
//   { action: "suggest", transactionId }              — get match candidates for a transaction

import { NextResponse } from "next/server";
import { matchTransaction, unmatchTransaction, suggestMatches } from "@/lib/actions/banking";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";

export async function POST(
  request: Request,
  { params: _params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const body = await request.json();
    const { action, transactionId, paymentId } = body as {
      action: string;
      transactionId?: string;
      paymentId?: string;
    };

    if (!action || !transactionId) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "action and transactionId are required" },
        { status: 422 },
      );
    }

    if (action === "match") {
      if (!paymentId) {
        return NextResponse.json(
          { code: "VALIDATION_ERROR", message: "paymentId is required for match action" },
          { status: 422 },
        );
      }
      await matchTransaction(transactionId, paymentId);
      return apiSuccess({ matched: true });
    }

    if (action === "unmatch") {
      await unmatchTransaction(transactionId);
      return apiSuccess({ unmatched: true });
    }

    if (action === "suggest") {
      const candidates = await suggestMatches(transactionId);
      return apiSuccess({ candidates });
    }

    return NextResponse.json(
      { code: "VALIDATION_ERROR", message: `Unknown action: ${action}. Valid actions: match, unmatch, suggest` },
      { status: 422 },
    );
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    if (e instanceof Error && e.message === "Transaction not found") {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "Transaction not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
