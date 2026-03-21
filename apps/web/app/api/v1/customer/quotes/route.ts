// GET  /api/v1/customer/quotes — paginated list
// POST /api/v1/customer/quotes — create quote with line items

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { createQuoteSchema } from "@dpf/validators";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";
import { createQuote } from "@/lib/actions/crm";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const status = url.searchParams.get("status");
    const opportunityId = url.searchParams.get("opportunityId");
    const accountId = url.searchParams.get("accountId");

    const where: Record<string, unknown> = {};
    if (cursor) where.id = { lt: cursor };
    if (status) where.status = status;
    if (opportunityId) where.opportunityId = opportunityId;
    if (accountId) where.accountId = accountId;

    const quotes = await prisma.quote.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: {
        lineItems: { orderBy: { sortOrder: "asc" } },
        opportunity: { select: { id: true, opportunityId: true, title: true } },
        account: { select: { id: true, accountId: true, name: true } },
        createdBy: { select: { id: true, email: true } },
      },
    });

    return apiSuccess(buildPaginatedResponse(quotes, limit));
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
    const { user } = await authenticateRequest(request);

    const body = await request.json();
    const parsed = createQuoteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const quote = await createQuote({ ...parsed.data, userId: user.id });
    return apiSuccess(quote, 201);
  } catch (e) {
    if (e instanceof Error && e.message.includes("not found")) {
      return NextResponse.json({ code: "NOT_FOUND", message: e.message }, { status: 404 });
    }
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
