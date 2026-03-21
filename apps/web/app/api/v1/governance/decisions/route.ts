// GET /api/v1/governance/decisions — paginated audit log of authorization decisions

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";

export async function GET(request: Request) {
  try {
    const { user } = await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);

    const where: Record<string, unknown> = {
      actorRef: user.id,
    };
    if (cursor) {
      where.id = { lt: cursor };
    }

    const decisions = await prisma.authorizationDecisionLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });

    return apiSuccess(buildPaginatedResponse(decisions, limit));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
