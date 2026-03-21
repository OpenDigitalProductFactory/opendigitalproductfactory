// GET   /api/v1/customer/engagements/:id — engagement detail
// PATCH /api/v1/customer/engagements/:id — update or qualify engagement

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { updateEngagementSchema } from "@dpf/validators";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError, apiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";
import { qualifyEngagement } from "@/lib/actions/crm.js";

const engagementInclude = () => ({
  contact: true,
  account: true,
  assignedTo: { select: { id: true, email: true } },
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await authenticateRequest(request);
    const { id } = await params;

    const engagement = await prisma.engagement.findUnique({
      where: { id },
      include: engagementInclude(),
    });

    if (!engagement) throw apiError("NOT_FOUND", "Engagement not found", 404);
    return apiSuccess(engagement);
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

    // Special action: qualify → convert to opportunity
    if (body.action === "qualify") {
      const opportunity = await qualifyEngagement(id, {
        opportunityTitle: body.opportunityTitle,
        expectedValue: body.expectedValue,
        expectedClose: body.expectedClose,
        userId: user.id,
      });
      return apiSuccess({ engagement: { status: "converted" }, opportunity });
    }

    // Standard update
    const parsed = updateEngagementSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Invalid input", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    const existing = await prisma.engagement.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw apiError("NOT_FOUND", "Engagement not found", 404);

    const updated = await prisma.engagement.update({
      where: { id },
      data: parsed.data,
      include: engagementInclude(),
    });

    return apiSuccess(updated);
  } catch (e) {
    if (e instanceof Error && e.message.includes("not found")) {
      return NextResponse.json({ code: "NOT_FOUND", message: e.message }, { status: 404 });
    }
    if (e instanceof Error && e.message.includes("already converted")) {
      return NextResponse.json({ code: "CONFLICT", message: e.message }, { status: 409 });
    }
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
