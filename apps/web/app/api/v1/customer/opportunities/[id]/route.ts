// GET   /api/v1/customer/opportunities/:id — opportunity detail with timeline
// PATCH /api/v1/customer/opportunities/:id — update, advance stage, close

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { updateOpportunitySchema } from "@dpf/validators";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError, apiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";
import { advanceOpportunityStage, closeOpportunity } from "@/lib/actions/crm.js";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);
    const { id } = await params;

    const opportunity = await prisma.opportunity.findUnique({
      where: { id },
      include: {
        account: true,
        contact: true,
        assignedTo: { select: { id: true, email: true } },
        activities: {
          orderBy: { createdAt: "desc" },
          include: {
            createdBy: { select: { id: true, email: true } },
          },
        },
      },
    });

    if (!opportunity) throw apiError("NOT_FOUND", "Opportunity not found", 404);
    return apiSuccess(opportunity);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await authenticateRequest(request);
    const { id } = await params;
    const body = await request.json();

    // Special action: advance stage
    if (body.action === "advance_stage" && body.stage) {
      const result = await advanceOpportunityStage(id, body.stage, {
        probability: body.probability,
        userId: user.id,
      });
      return apiSuccess(result);
    }

    // Special action: close
    if (body.action === "close" && typeof body.won === "boolean") {
      const result = await closeOpportunity(id, body.won, {
        lostReason: body.lostReason,
        userId: user.id,
      });
      return apiSuccess(result);
    }

    // Standard update
    const parsed = updateOpportunitySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const existing = await prisma.opportunity.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw apiError("NOT_FOUND", "Opportunity not found", 404);

    const { expectedClose, expectedValue, ...rest } = parsed.data;

    const updated = await prisma.opportunity.update({
      where: { id },
      data: {
        ...rest,
        ...(expectedClose !== undefined && {
          expectedClose: expectedClose ? new Date(expectedClose) : null,
        }),
        ...(expectedValue !== undefined && { expectedValue }),
      },
      include: {
        account: true,
        contact: true,
        assignedTo: { select: { id: true, email: true } },
        activities: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });

    return apiSuccess(updated);
  } catch (e) {
    if (e instanceof Error && e.message.includes("not found")) {
      return NextResponse.json({ code: "NOT_FOUND", message: e.message }, { status: 404 });
    }
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
