// GET /api/v1/finance/invoices/:id — invoice detail
// PATCH /api/v1/finance/invoices/:id — update invoice status

import { NextResponse } from "next/server";
import { updateInvoiceSchema } from "@/lib/finance-validation";
import { getInvoice, updateInvoiceStatus } from "@/lib/actions/finance";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id } = await params;

    const invoice = await getInvoice(id);
    if (!invoice) {
      throw apiError("NOT_FOUND", "Invoice not found", 404);
    }

    return apiSuccess(invoice);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id } = await params;

    const body = await request.json();
    const parsed = updateInvoiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const existing = await getInvoice(id);
    if (!existing) {
      throw apiError("NOT_FOUND", "Invoice not found", 404);
    }

    if (parsed.data.status) {
      await updateInvoiceStatus(id, parsed.data.status);
    }

    const updated = await getInvoice(id);

    return apiSuccess(updated);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
