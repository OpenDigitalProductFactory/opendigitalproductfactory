// GET  /api/v1/customer/opportunities — paginated list
// POST /api/v1/customer/opportunities — create opportunity

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { createOpportunitySchema } from "@dpf/validators";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";
import { createOpportunity } from "@/lib/actions/crm";

const opportunityInclude = () => ({
  account: { select: { id: true, accountId: true, name: true } },
  contact: { select: { id: true, email: true, firstName: true, lastName: true } },
  assignedTo: { select: { id: true, email: true } },
});

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);
    const stage = url.searchParams.get("stage");
    const assignedToId = url.searchParams.get("assignedToId");
    const isDormant = url.searchParams.get("isDormant");
    const accountId = url.searchParams.get("accountId");

    const where: Record<string, unknown> = {};
    if (cursor) where.id = { lt: cursor };
    if (stage) where.stage = stage;
    if (assignedToId) where.assignedToId = assignedToId;
    if (isDormant === "true") where.isDormant = true;
    if (isDormant === "false") where.isDormant = false;
    if (accountId) where.accountId = accountId;

    const opportunities = await prisma.opportunity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: opportunityInclude(),
    });

    return apiSuccess(buildPaginatedResponse(opportunities, limit));
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
    const parsed = createOpportunitySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const opportunity = await createOpportunity({
      ...parsed.data,
      userId: user.id,
    });

    return apiSuccess(opportunity, 201);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
