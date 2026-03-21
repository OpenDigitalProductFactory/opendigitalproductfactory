// GET /api/v1/finance/recurring — paginated list of recurring schedules with optional status filter
// POST /api/v1/finance/recurring — create a new recurring schedule

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { createRecurringScheduleSchema } from "@/lib/recurring-validation";
import { createRecurringSchedule } from "@/lib/actions/recurring";
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

    const where: Record<string, unknown> = {};
    if (cursor) {
      where.id = { lt: cursor };
    }
    if (statusFilter) {
      where.status = statusFilter;
    }

    const schedules = await prisma.recurringSchedule.findMany({
      where,
      orderBy: { nextInvoiceDate: "asc" },
      take: limit + 1,
      select: {
        id: true,
        scheduleId: true,
        name: true,
        frequency: true,
        amount: true,
        currency: true,
        status: true,
        startDate: true,
        endDate: true,
        nextInvoiceDate: true,
        lastInvoicedAt: true,
        autoSend: true,
        createdAt: true,
        updatedAt: true,
        account: { select: { id: true, accountId: true, name: true } },
      },
    });

    return apiSuccess(buildPaginatedResponse(schedules, limit));
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
    const parsed = createRecurringScheduleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const schedule = await createRecurringSchedule(parsed.data);

    return apiSuccess(schedule, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
