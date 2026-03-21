// GET /api/v1/customer/sales-orders — paginated list of sales orders

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination.js";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const status = url.searchParams.get("status");
    const accountId = url.searchParams.get("accountId");

    const where: Record<string, unknown> = {};
    if (cursor) where.id = { lt: cursor };
    if (status) where.status = status;
    if (accountId) where.accountId = accountId;

    const orders = await prisma.salesOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: {
        quote: { select: { id: true, quoteId: true, quoteNumber: true } },
        account: { select: { id: true, accountId: true, name: true } },
      },
    });

    return apiSuccess(buildPaginatedResponse(orders, limit));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
