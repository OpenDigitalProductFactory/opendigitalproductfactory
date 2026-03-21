// GET /api/v1/compliance/alerts — paginated list of regulatory alerts

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
    const status = url.searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (cursor) {
      where.id = { lt: cursor };
    }
    if (status) {
      where.status = status;
    } else {
      where.status = { in: ["pending", "active"] };
    }

    const alerts = await prisma.regulatoryAlert.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });

    return apiSuccess(buildPaginatedResponse(alerts, limit));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
