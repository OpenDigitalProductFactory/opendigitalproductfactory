// GET /api/v1/compliance/audits/:id/findings — list findings for a specific audit

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError, apiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);
    const { id } = await params;

    // Verify audit exists
    const audit = await prisma.complianceAudit.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!audit) {
      throw apiError("NOT_FOUND", "Audit not found", 404);
    }

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);

    const where: Record<string, unknown> = { auditId: id };
    if (cursor) {
      where.id = { lt: cursor };
    }

    const findings = await prisma.auditFinding.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: {
        control: { select: { id: true, title: true, controlId: true } },
      },
    });

    return apiSuccess(buildPaginatedResponse(findings, limit));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
