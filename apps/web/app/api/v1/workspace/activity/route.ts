// GET /api/v1/workspace/activity
//
// Returns a paginated activity feed based on recently updated backlog items.
// Requires authentication via Bearer JWT or NextAuth session.

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import type { ActivityItem, PaginatedResponse } from "@dpf/types";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);

    // Query recent backlog items as activity proxy
    const where: Record<string, unknown> = {};
    if (cursor) {
      where.id = { lt: cursor };
    }

    const items = await prisma.backlogItem.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        type: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: limit + 1,
    });

    const activityItems = items.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      type: item.type,
      updatedAt: item.updatedAt.toISOString(),
    }) satisfies ActivityItem);

    return apiSuccess(buildPaginatedResponse(activityItems, limit) satisfies PaginatedResponse<ActivityItem>);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
