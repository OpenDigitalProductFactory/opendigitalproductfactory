// GET /api/v1/agent/thread — return the user's agent thread with messages

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware";
import { ApiError } from "@/lib/api/error";
import { apiSuccess } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const { user } = await authenticateRequest(request);

    const contextKey = "coworker";

    // Upsert: return existing or create new thread
    const thread = await prisma.agentThread.upsert({
      where: { userId_contextKey: { userId: user.id, contextKey } },
      update: {},
      create: { userId: user.id, contextKey },
      select: { id: true },
    });

    const messages = await prisma.agentMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        role: true,
        content: true,
        agentId: true,
        routeContext: true,
        createdAt: true,
      },
    });

    return apiSuccess({
      threadId: thread.id,
      messages: messages.reverse().map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
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
