// GET /api/v1/customer/invoices — the signed-in customer's own invoices.
//
// Customer-scoped view of the finance.invoices list: returns ONLY rows whose
// CustomerAccount.accountId matches the authenticated user's session
// accountId. The portal-side admin list at /api/v1/finance/invoices is
// unchanged (workforce-scoped); this route is the customer half of the
// generic mobile app's "My invoices" surface.
//
// Auth: requireCustomerAuth — a workforce/admin user hitting this returns
// 403 by design (they use /api/v1/finance/invoices).

import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@dpf/db";
import { requireCustomerAuth } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user } = await requireCustomerAuth(request);

    if (!user.accountId) {
      return apiSuccess(buildPaginatedResponse([], 10));
    }

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const statusFilter = url.searchParams.get("status");

    const where: Prisma.InvoiceWhereInput = {
      account: { is: { accountId: user.accountId } },
    };
    if (cursor) {
      where.id = { lt: cursor };
    }
    if (statusFilter) {
      where.status = statusFilter;
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
