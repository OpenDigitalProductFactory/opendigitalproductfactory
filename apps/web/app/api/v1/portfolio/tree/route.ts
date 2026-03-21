// GET /api/v1/portfolio/tree
//
// Returns the portfolio hierarchy with taxonomy nodes and product counts.
// Requires authentication via Bearer JWT or NextAuth session.

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    // Fetch portfolios with products and epic associations
    const portfolios = await prisma.portfolio.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        budgetKUsd: true,
        createdAt: true,
        updatedAt: true,
        products: {
          select: {
            id: true,
            productId: true,
            name: true,
            lifecycleStage: true,
            lifecycleStatus: true,
          },
        },
        epicPortfolios: {
          select: {
            epicId: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return apiSuccess({ portfolios });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
