// GET /api/v1/business-models
//
// Returns all business models with role counts and product assignment counts.
// Filterable by ?isBuiltIn=true|false and ?status=active|deprecated|retired

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";

export async function GET(request: NextRequest) {
  try {
    await authenticateRequest(request);

    const { searchParams } = request.nextUrl;
    const isBuiltInParam = searchParams.get("isBuiltIn");
    const statusParam = searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (isBuiltInParam !== null) {
      where.isBuiltIn = isBuiltInParam === "true";
    }
    if (statusParam) {
      where.status = statusParam;
    } else {
      where.status = "active";
    }

    const models = await prisma.businessModel.findMany({
      where,
      include: {
        _count: {
          select: {
            roles: { where: { status: "active" } },
            products: true,
          },
        },
      },
      orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }],
    });

    return apiSuccess(
      models.map((m) => ({
        id: m.id,
        modelId: m.modelId,
        name: m.name,
        description: m.description,
        isBuiltIn: m.isBuiltIn,
        status: m.status,
        roleCount: m._count.roles,
        productCount: m._count.products,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })),
    );
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    if (e instanceof Error && e.message === "Unauthorized") {
      return apiError("FORBIDDEN", "Authentication required", 401).toResponse();
    }
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "An unexpected error occurred" }, { status: 500 });
  }
}
