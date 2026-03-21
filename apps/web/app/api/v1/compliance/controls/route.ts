// GET /api/v1/compliance/controls — paginated list of controls with status summary

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

    const where: Record<string, unknown> = {
      status: "active",
    };
    if (cursor) {
      where.id = { lt: cursor };
    }

    const controls = await prisma.control.findMany({
      where,
      orderBy: { title: "asc" },
      take: limit + 1,
      include: {
        ownerEmployee: { select: { id: true, displayName: true } },
        _count: { select: { obligations: true } },
      },
    });

    return apiSuccess(buildPaginatedResponse(controls, limit));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
