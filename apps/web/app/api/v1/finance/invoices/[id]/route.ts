// GET /api/v1/finance/invoices/:id — invoice detail
// PATCH /api/v1/finance/invoices/:id — update invoice status
// DELETE /api/v1/finance/invoices/:id — delete a draft invoice that never became a record

import { NextResponse } from "next/server";
import { updateInvoiceSchema } from "@/lib/finance-validation";
import { getInvoice, updateInvoiceStatus, deleteInvoice } from "@/lib/actions/finance";
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
      const result = await updateInvoiceStatus(id, parsed.data.status);
      if (!result.ok) {
        throw apiError(
          result.error === "not_found" ? "NOT_FOUND" : "ILLEGAL_TRANSITION",
          result.message,
          result.error === "not_found" ? 404 : 422,
        );
      }
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id } = await params;

    const result = await deleteInvoice(id);
    if (!result.ok) {
      // 409 rather than 422: the request is well-formed, the invoice's state is
      // what forbids it — and the message names the alternative (void).
      throw apiError(
        result.error === "not_found" ? "NOT_FOUND" : "NOT_DELETABLE",
        result.message,
        result.error === "not_found" ? 404 : 409,
      );
    }

    return apiSuccess({ id, deleted: true });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
