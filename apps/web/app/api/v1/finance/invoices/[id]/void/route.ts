// POST /api/v1/finance/invoices/:id/void — neutralise an invoice's economics
// while keeping it on record. Unwinds payment allocations (keeping the Payment),
// reverses ledger postings via storno, and re-bills any linked time.

import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { voidInvoice } from "@/lib/actions/finance";

const voidInvoiceSchema = z.object({
  // Required: a void without a stated reason is an unexplained hole in the ledger.
  reason: z.string().trim().min(3, "Give a reason so the void is explainable later.").max(500),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const parsed = voidInvoiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const result = await voidInvoice(id, parsed.data.reason);
    if (!result.ok) {
      throw apiError(
        result.error === "not_found" ? "NOT_FOUND" : "ILLEGAL_TRANSITION",
        result.message,
        result.error === "not_found" ? 404 : 422,
      );
    }

    return apiSuccess({ id, voided: true, reversedJournalEntries: result.reversedJournalEntries });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
