// GET   /api/v1/customer/sales-orders/:id — order detail
// PATCH /api/v1/customer/sales-orders/:id — update fulfilment status

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { updateSalesOrderSchema } from "@dpf/validators";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError, apiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";
import { logActivity } from "@/lib/actions/crm.js";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);
    const { id } = await params;

    const order = await prisma.salesOrder.findUnique({
      where: { id },
      include: {
        quote: {
          include: {
            lineItems: { orderBy: { sortOrder: "asc" } },
            opportunity: { select: { id: true, opportunityId: true, title: true } },
          },
        },
        account: true,
      },
    });

    if (!order) throw apiError("NOT_FOUND", "Sales order not found", 404);
    return apiSuccess(order);
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
    const { user } = await authenticateRequest(request);
    const { id } = await params;

    const body = await request.json();
    const parsed = updateSalesOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const existing = await prisma.salesOrder.findUnique({
      where: { id },
      select: { id: true, status: true, orderRef: true, accountId: true, quote: { select: { opportunityId: true } } },
    });
    if (!existing) throw apiError("NOT_FOUND", "Sales order not found", 404);

    const data: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.status === "fulfilled") data.fulfilledAt = new Date();
    if (parsed.data.status === "cancelled") data.cancelledAt = new Date();

    const updated = await prisma.salesOrder.update({
      where: { id },
      data,
      include: {
        quote: { select: { id: true, quoteId: true, quoteNumber: true, opportunityId: true } },
        account: { select: { id: true, accountId: true, name: true } },
      },
    });

    // Auto-log status change
    if (parsed.data.status && parsed.data.status !== existing.status) {
      await logActivity({
        type: "status_change",
        subject: `Sales Order ${existing.orderRef}: ${existing.status} → ${parsed.data.status}`,
        accountId: existing.accountId,
        opportunityId: existing.quote.opportunityId,
        createdById: user.id,
      });
    }

    return apiSuccess(updated);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
