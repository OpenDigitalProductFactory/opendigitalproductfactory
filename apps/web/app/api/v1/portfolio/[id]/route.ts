// GET /api/v1/portfolio/:id
//
// Returns a single portfolio by ID with products and epic associations.
// Requires authentication via Bearer JWT or NextAuth session.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);

    const { id } = await params;

    const portfolio = await prisma.portfolio.findUnique({
      where: { id },
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
            description: true,
            lifecycleStage: true,
            lifecycleStatus: true,
            version: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        epicPortfolios: {
          select: {
            epicId: true,
          },
        },
      },
    });

    if (!portfolio) {
      throw apiError("NOT_FOUND", `Portfolio not found: ${id}`, 404);
    }

    return apiSuccess(portfolio);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
