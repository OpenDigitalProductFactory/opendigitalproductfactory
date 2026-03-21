// GET /api/v1/agent/proposals — return pending action proposals for the user's thread

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const { user } = await authenticateRequest(request);

    const contextKey = "coworker";

    // Find the user's thread (don't create if it doesn't exist — no proposals without a thread)
    const thread = await prisma.agentThread.findUnique({
      where: { userId_contextKey: { userId: user.id, contextKey } },
      select: { id: true },
    });

    if (!thread) {
      return apiSuccess({ proposals: [] });
    }

    const proposals = await prisma.agentActionProposal.findMany({
      where: {
        threadId: thread.id,
        status: "proposed",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        proposalId: true,
        actionType: true,
        parameters: true,
        status: true,
        createdAt: true,
        message: {
          select: {
            id: true,
            role: true,
            content: true,
            agentId: true,
            routeContext: true,
            createdAt: true,
          },
        },
      },
    });

    return apiSuccess({
      proposals: proposals.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        message: p.message
          ? {
              ...p.message,
              createdAt: p.message.createdAt.toISOString(),
            }
          : null,
      })),
    });
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
