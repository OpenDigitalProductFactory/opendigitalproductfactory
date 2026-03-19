// POST /api/v1/agent/message — send a message to the coworker agent

import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { authenticateRequest } from "@/lib/api/auth-middleware.js";
import { ApiError } from "@/lib/api/error.js";
import { apiSuccess } from "@/lib/api/response.js";

export async function POST(request: Request) {
  try {
    const { user } = await authenticateRequest(request);

    const body = await request.json();
    const { content, agentId, routeContext } = body as {
      content?: string;
      agentId?: string;
      routeContext?: string;
    };

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "content is required and must be a non-empty string" },
        { status: 422 },
      );
    }

    const contextKey = "coworker";

    // Find or create thread for this user
    const thread = await prisma.agentThread.upsert({
      where: { userId_contextKey: { userId: user.id, contextKey } },
      update: {},
      create: { userId: user.id, contextKey },
      select: { id: true },
    });

    // Create the user message
    const message = await prisma.agentMessage.create({
      data: {
        threadId: thread.id,
        role: "user",
        content: content.trim(),
        agentId: agentId ?? null,
        routeContext: routeContext ?? "/workspace",
      },
      select: {
        id: true,
        role: true,
        content: true,
        agentId: true,
        routeContext: true,
        createdAt: true,
      },
    });

    return apiSuccess(
      {
        ...message,
        createdAt: message.createdAt.toISOString(),
        threadId: thread.id,
      },
      201,
    );
  } catch (e) {
    if (e instanceof ApiError) return e.toResponse();
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
