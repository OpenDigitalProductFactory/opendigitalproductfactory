// GET /api/v1/portfolio/:id/products
//
// Returns paginated digital products for a given portfolio.
// Requires authentication via Bearer JWT or NextAuth session.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError, apiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination.js";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id } = await params;
    const { cursor, limit } = parsePagination(request.nextUrl.searchParams);

    // Verify portfolio exists
    const portfolio = await prisma.portfolio.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!portfolio) {
      throw apiError("NOT_FOUND", `Portfolio not found: ${id}`, 404);
    }

    // Fetch products with cursor-based pagination
    const where: Record<string, unknown> = { portfolioId: id };
    if (cursor) {
      where.id = { gt: cursor };
    }

    const products = await prisma.digitalProduct.findMany({
      where,
      select: {
        id: true,
        productId: true,
        name: true,
        description: true,
        lifecycleStage: true,
        lifecycleStatus: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { name: "asc" },
      take: limit + 1,
    });

    const result = buildPaginatedResponse(products, limit);

    return apiSuccess(result);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
