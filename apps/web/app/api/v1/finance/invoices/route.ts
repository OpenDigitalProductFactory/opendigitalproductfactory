// GET /api/v1/finance/invoices — paginated list of invoices with filters
// POST /api/v1/finance/invoices — create a new invoice

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { createInvoiceSchema } from "@/lib/finance-validation";
import { createInvoice } from "@/lib/actions/finance";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const statusFilter = url.searchParams.get("status");
    const accountIdFilter = url.searchParams.get("accountId");

    const where: Record<string, unknown> = {};
    if (cursor) {
      where.id = { lt: cursor };
    }
    if (statusFilter) {
      where.status = statusFilter;
    }
    if (accountIdFilter) {
      where.accountId = accountIdFilter;
    }

    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      select: {
        id: true,
        invoiceRef: true,
        type: true,
        status: true,
        currency: true,
        subtotal: true,
        taxAmount: true,
        discountAmount: true,
        totalAmount: true,
        amountPaid: true,
        amountDue: true,
        dueDate: true,
        sentAt: true,
        paidAt: true,
        createdAt: true,
        updatedAt: true,
        account: { select: { id: true, name: true } },
      },
    });

    return apiSuccess(buildPaginatedResponse(invoices, limit));
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
    const parsed = createInvoiceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const invoice = await createInvoice(parsed.data);

    return apiSuccess(invoice, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
