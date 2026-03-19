// GET /api/v1/compliance/corrective-actions — paginated list of pending/overdue corrective actions

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

    const where: Record<string, unknown> = {};
    if (cursor) {
      where.id = { lt: cursor };
    }
    if (status) {
      where.status = status;
    } else {
      where.status = { in: ["open", "in-progress"] };
    }

    const actions = await prisma.correctiveAction.findMany({
      where,
      orderBy: { dueDate: "asc" },
      take: limit + 1,
      include: {
        owner: { select: { id: true, displayName: true } },
        incident: { select: { id: true, title: true, incidentId: true } },
        auditFinding: { select: { id: true, title: true, findingId: true } },
      },
    });

    return apiSuccess(buildPaginatedResponse(actions, limit));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
