// GET /api/v1/compliance/incidents — paginated list of compliance incidents

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);

    const where: Record<string, unknown> = {};
    if (cursor) {
      where.id = { lt: cursor };
    }

    const incidents = await prisma.complianceIncident.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      take: limit + 1,
      include: {
        reportedBy: { select: { id: true, displayName: true } },
      },
    });

    return apiSuccess(buildPaginatedResponse(incidents, limit));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
