// GET /api/v1/business-models/:modelId
//
// Returns a single business model with its full role list.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> },
) {
  try {
    await authenticateRequest(request);

    const { modelId } = await params;

    const model = await prisma.businessModel.findUnique({
      where: { modelId },
      include: {
        roles: {
          where: { status: "active" },
          orderBy: { roleId: "asc" },
        },
        _count: { select: { products: true } },
      },
    });

    if (!model) {
      return apiError("NOT_FOUND", `Business model not found: ${modelId}`, 404).toResponse();
    }

    return apiSuccess({
      id: model.id,
      modelId: model.modelId,
      name: model.name,
      description: model.description,
      isBuiltIn: model.isBuiltIn,
      status: model.status,
      productCount: model._count.products,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
      roles: model.roles.map((r) => ({
        id: r.id,
        roleId: r.roleId,
        name: r.name,
        authorityDomain: r.authorityDomain,
        it4itAlignment: r.it4itAlignment,
        hitlTierDefault: r.hitlTierDefault,
        escalatesTo: r.escalatesTo,
        isBuiltIn: r.isBuiltIn,
        status: r.status,
      })),
    });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    if (e instanceof Error && e.message === "Unauthorized") {
      return apiError("FORBIDDEN", "Authentication required", 401).toResponse();
    }
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "An unexpected error occurred" }, { status: 500 });
  }
}
