// GET /api/v1/finance/payments — paginated list of payments with filters
// POST /api/v1/finance/payments — record a new payment

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { recordPaymentSchema } from "@/lib/finance-validation";
import { recordPayment } from "@/lib/actions/finance";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination.js";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const directionFilter = url.searchParams.get("direction");

    const where: Record<string, unknown> = {};
    if (cursor) {
      where.id = { lt: cursor };
    }
    if (directionFilter) {
      where.direction = directionFilter;
    }

    const payments = await prisma.payment.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: limit + 1,
      select: {
        id: true,
        paymentRef: true,
        direction: true,
        method: true,
        status: true,
        amount: true,
        currency: true,
        reference: true,
        notes: true,
        receivedAt: true,
        createdAt: true,
        updatedAt: true,
        allocations: {
          include: {
            invoice: { select: { id: true, invoiceRef: true } },
          },
        },
      },
    });

    return apiSuccess(buildPaginatedResponse(payments, limit));
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
    const parsed = recordPaymentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const payment = await recordPayment(parsed.data);

    return apiSuccess(payment, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
