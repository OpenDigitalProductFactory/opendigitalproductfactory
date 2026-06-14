// GET /api/v1/work-items — the signed-in field worker's assigned jobs.
// Paginated; optional ?status= filter. Authenticated.

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";
import { toWorkItemSummary, isWorkItemStatus } from "@/lib/api/work-items";

const LIST_SELECT = {
  id: true,
  itemId: true,
  title: true,
  status: true,
  urgency: true,
  effortClass: true,
  dueAt: true,
  queueId: true,
  teamId: true,
  createdAt: true,
} as const;

export async function GET(request: Request) {
  try {
    const { user } = await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const statusFilter = url.searchParams.get("status");

    const where: Record<string, unknown> = { assignedToUserId: user.id };
    if (cursor) where.id = { lt: cursor };
    if (statusFilter && isWorkItemStatus(statusFilter)) {
      where.status = statusFilter;
    }

    const rows = await prisma.workItem.findMany({
      where,
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: limit + 1,
      select: LIST_SELECT,
    });

    const page = buildPaginatedResponse(rows, limit);
    return apiSuccess({
      data: page.data.map(toWorkItemSummary),
      nextCursor: page.nextCursor,
    });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
