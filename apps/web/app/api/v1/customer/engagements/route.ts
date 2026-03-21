// GET  /api/v1/customer/engagements — paginated list
// POST /api/v1/customer/engagements — create engagement

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { createEngagementSchema } from "@dpf/validators";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";
import { createEngagement } from "@/lib/actions/crm";

const engagementInclude = () => ({
  contact: { select: { id: true, email: true, firstName: true, lastName: true } },
  account: { select: { id: true, accountId: true, name: true } },
  assignedTo: { select: { id: true, email: true } },
});

export async function GET(request: Request) {
  try {
    const { user } = await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const status = url.searchParams.get("status");
    const assignedToId = url.searchParams.get("assignedToId");

    const where: Record<string, unknown> = {};
    if (cursor) where.id = { lt: cursor };
    if (status) where.status = status;
    if (assignedToId) where.assignedToId = assignedToId;

    const engagements = await prisma.engagement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: engagementInclude(),
    });

    return apiSuccess(buildPaginatedResponse(engagements, limit));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await authenticateRequest(request);

    const body = await request.json();
    const parsed = createEngagementSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const engagement = await createEngagement({
      ...parsed.data,
      userId: user.id,
    });

    return apiSuccess(engagement, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
