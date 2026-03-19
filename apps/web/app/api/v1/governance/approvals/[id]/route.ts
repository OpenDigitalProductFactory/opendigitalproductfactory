// POST /api/v1/governance/approvals/:id — approve or reject a proposal

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError, apiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await authenticateRequest(request);
    const { id } = await params;

    const body = await request.json();
    const { decision, rationale } = body as {
      decision?: string;
      rationale?: string;
    };

    if (!decision || !["approve", "reject"].includes(decision)) {
      return NextResponse.json(
        {
          code: "VALIDATION_ERROR",
          message: "decision must be 'approve' or 'reject'",
        },
        { status: 422 },
      );
    }

    // Fetch proposal and verify it belongs to the user's thread
    const proposal = await prisma.agentActionProposal.findUnique({
      where: { id },
      include: { thread: { select: { userId: true } } },
    });

    if (!proposal || proposal.thread.userId !== user.id) {
      throw apiError("NOT_FOUND", "Proposal not found", 404);
    }

    const updated = await prisma.agentActionProposal.update({
      where: { id },
      data: {
        status: decision,
        decidedById: user.id,
        decidedAt: new Date(),
        ...(rationale !== undefined && {
          parameters: {
            ...(typeof proposal.parameters === "object" &&
            proposal.parameters !== null
              ? proposal.parameters
              : {}),
            _rationale: rationale,
          },
        }),
      },
    });

    return apiSuccess(updated);
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
