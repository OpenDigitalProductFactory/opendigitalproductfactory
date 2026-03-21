// GET /api/v1/governance/approvals — list pending action proposals for the user

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";
import { parsePagination, buildPaginatedResponse } from "@/lib/api/pagination";

export async function GET(request: Request) {
  try {
    const { user } = await authenticateRequest(request);

    const url = new URL(request.url);
    const { cursor, limit } = parsePagination(url.searchParams);

    // Find all threads belonging to the current user
    const threads = await prisma.agentThread.findMany({
      where: { userId: user.id },
      select: { id: true },
    });

    if (threads.length === 0) {
      return apiSuccess({ data: [], nextCursor: null });
    }

    const threadIds = threads.map((t) => t.id);

    const where: Record<string, unknown> = {
      status: "proposed",
      threadId: { in: threadIds },
    };
    if (cursor) {
      where.id = { lt: cursor };
    }

    const proposals = await prisma.agentActionProposal.findMany({
      where,
      orderBy: { proposedAt: "desc" },
      take: limit + 1,
      include: {
        message: {
          select: {
            id: true,
            role: true,
            content: true,
            agentId: true,
            createdAt: true,
          },
        },
      },
    });

    return apiSuccess(buildPaginatedResponse(proposals, limit));
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
