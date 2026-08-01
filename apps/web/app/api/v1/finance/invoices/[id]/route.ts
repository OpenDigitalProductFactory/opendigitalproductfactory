// GET /api/v1/finance/invoices/:id — invoice detail
// PATCH /api/v1/finance/invoices/:id — update invoice content and/or status
// DELETE /api/v1/finance/invoices/:id — delete a draft invoice that never became a record

import { NextResponse } from "next/server";
import { updateInvoiceSchema } from "@/lib/finance-validation";
import { getInvoice, updateInvoice, updateInvoiceStatus, deleteInvoice } from "@/lib/actions/finance";
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

    // Content first, then status. Applying content to the invoice's CURRENT status
    // is what the edit-scope rule is written against; doing it after a status move
    // would evaluate the scope against a status the caller never saw.
    const { status, ...content } = parsed.data;

    if (Object.values(content).some((v) => v !== undefined)) {
      const result = await updateInvoice(id, content);
      if (!result.ok) {
        throw apiError(
          result.error === "not_found" ? "NOT_FOUND" : "NOT_EDITABLE",
          result.message,
          result.error === "not_found" ? 404 : 409,
        );
      }
    }

    if (status) {
      const result = await updateInvoiceStatus(id, status);
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
