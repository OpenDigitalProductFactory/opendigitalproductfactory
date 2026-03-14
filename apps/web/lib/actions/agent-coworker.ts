"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { validateMessageInput } from "@/lib/agent-coworker-types";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";
import { resolveAgentForRoute, generateCannedResponse } from "@/lib/agent-routing";
import { serializeMessage } from "@/lib/agent-coworker-data";

// ─── Auth helper ────────────────────────────────────────────────────────────

async function requireAuthUser() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new Error("Unauthorized");
  return user;
}

// ─── Server Actions ─────────────────────────────────────────────────────────

export async function getOrCreateThread(): Promise<{ threadId: string }> {
  const user = await requireAuthUser();

  const existing = await prisma.agentThread.findUnique({
    where: { userId_contextKey: { userId: user.id, contextKey: "coworker" } },
    select: { id: true },
  });

  if (existing) return { threadId: existing.id };

  const created = await prisma.agentThread.create({
    data: { userId: user.id, contextKey: "coworker" },
    select: { id: true },
  });

  return { threadId: created.id };
}

export async function sendMessage(input: {
  threadId: string;
  content: string;
  routeContext: string;
}): Promise<
  | { userMessage: AgentMessageRow; agentMessage: AgentMessageRow }
  | { error: string }
> {
  const user = await requireAuthUser();

  // Verify thread ownership
  const thread = await prisma.agentThread.findUnique({
    where: { id: input.threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== user.id) {
    return { error: "Unauthorized" };
  }

  // Validate input
  const validationError = validateMessageInput(input);
  if (validationError) return { error: validationError };

  const trimmedContent = input.content.trim();

  // Persist user message
  const userMsg = await prisma.agentMessage.create({
    data: {
      threadId: input.threadId,
      role: "user",
      content: trimmedContent,
      routeContext: input.routeContext,
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

  // Resolve agent and generate canned response
  const agent = resolveAgentForRoute(input.routeContext, {
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  });

  const responseContent = generateCannedResponse(
    agent.agentId,
    input.routeContext,
    user.platformRole,
  );

  // Persist agent response
  const agentMsg = await prisma.agentMessage.create({
    data: {
      threadId: input.threadId,
      role: "assistant",
      content: responseContent,
      agentId: agent.agentId,
      routeContext: input.routeContext,
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

  return {
    userMessage: serializeMessage(userMsg),
    agentMessage: serializeMessage(agentMsg),
  };
}

export async function loadEarlierMessages(input: {
  threadId: string;
  before: string;
  limit?: number;
}): Promise<{ messages: AgentMessageRow[]; hasMore: boolean } | { error: string }> {
  const user = await requireAuthUser();

  const thread = await prisma.agentThread.findUnique({
    where: { id: input.threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== user.id) {
    return { error: "Unauthorized" };
  }

  const limit = input.limit ?? 20;

  const messages = await prisma.agentMessage.findMany({
    where: { threadId: input.threadId },
    orderBy: { createdAt: "desc" },
    cursor: { id: input.before },
    skip: 1, // skip the cursor itself
    take: limit + 1, // fetch one extra to check hasMore
    select: {
      id: true,
      role: true,
      content: true,
      agentId: true,
      routeContext: true,
      createdAt: true,
    },
  });

  const hasMore = messages.length > limit;
  const slice = hasMore ? messages.slice(0, limit) : messages;

  return {
    messages: slice.reverse().map(serializeMessage),
    hasMore,
  };
}

export async function recordAgentTransition(input: {
  threadId: string;
  agentId: string;
  agentName: string;
  routeContext: string;
}): Promise<{ message: AgentMessageRow } | { error: string }> {
  const user = await requireAuthUser();

  const thread = await prisma.agentThread.findUnique({
    where: { id: input.threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== user.id) {
    return { error: "Unauthorized" };
  }

  const msg = await prisma.agentMessage.create({
    data: {
      threadId: input.threadId,
      role: "system",
      content: `${input.agentName} has joined the conversation`,
      agentId: input.agentId,
      routeContext: input.routeContext,
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

  return { message: serializeMessage(msg) };
}
