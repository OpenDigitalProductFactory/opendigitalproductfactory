// GET  /api/v1/customer/activities — paginated timeline
// POST /api/v1/customer/activities — log activity

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { createActivitySchema } from "@dpf/validators";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";
import { logActivity } from "@/lib/actions/crm";

const activityInclude = () => ({
  account: { select: { id: true, accountId: true, name: true } },
  contact: { select: { id: true, email: true, firstName: true, lastName: true } },
  opportunity: { select: { id: true, opportunityId: true, title: true } },
  createdBy: { select: { id: true, email: true } },
});

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const accountId = url.searchParams.get("accountId");
    const contactId = url.searchParams.get("contactId");
    const opportunityId = url.searchParams.get("opportunityId");
    const type = url.searchParams.get("type");

    const where: Record<string, unknown> = {};
    if (cursor) where.id = { lt: cursor };
    if (accountId) where.accountId = accountId;
    if (contactId) where.contactId = contactId;
    if (opportunityId) where.opportunityId = opportunityId;
    if (type) where.type = type;

    const activities = await prisma.activity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: activityInclude(),
    });

    return apiSuccess(buildPaginatedResponse(activities, limit));
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
    const parsed = createActivitySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const activity = await logActivity({
      ...parsed.data,
      createdById: user.id,
    });

    // Re-fetch with relations
    const full = await prisma.activity.findUniqueOrThrow({
      where: { id: activity.id },
      include: activityInclude(),
    });

    return apiSuccess(full, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
