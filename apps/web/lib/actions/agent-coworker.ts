"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { validateMessageInput } from "@/lib/agent-coworker-types";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";
import { resolveAgentForRoute, generateCannedResponse } from "@/lib/agent-routing";
import { serializeMessage } from "@/lib/agent-coworker-data";
import { callWithFailover, NoProvidersAvailableError } from "@/lib/ai-provider-priority";
import { logTokenUsage } from "@/lib/ai-inference";
import type { ChatMessage } from "@/lib/ai-inference";
import { buildCoworkerContextKey } from "@/lib/agent-coworker-context";

// ─── Auth helper ────────────────────────────────────────────────────────────

async function requireAuthUser() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new Error("Unauthorized");
  return user;
}

// ─── Server Actions ─────────────────────────────────────────────────────────

export async function getOrCreateThreadSnapshot(input: {
  routeContext: string;
}): Promise<{ threadId: string; messages: AgentMessageRow[] } | null> {
  const user = await requireAuthUser();

  // Verify user exists in DB (JWT may reference a stale user after re-seed)
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true },
  });
  if (!dbUser) return null;

  const contextKey = buildCoworkerContextKey(input.routeContext);

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

  return {
    threadId: thread.id,
    messages: messages.reverse().map(serializeMessage),
  };
}

export async function getOrCreateThread(input?: {
  routeContext?: string;
}): Promise<{ threadId: string } | null> {
  const snapshot = await getOrCreateThreadSnapshot({
    routeContext: input?.routeContext ?? "/workspace",
  });
  return snapshot ? { threadId: snapshot.threadId } : null;
}

export async function sendMessage(input: {
  threadId: string;
  content: string;
  routeContext: string;
}): Promise<
  | { userMessage: AgentMessageRow; agentMessage: AgentMessageRow; systemMessage?: AgentMessageRow }
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

  // Resolve agent
  const agent = resolveAgentForRoute(input.routeContext, {
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  });

  // Build inference context
  const recentMessages = await prisma.agentMessage.findMany({
    where: { threadId: input.threadId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { role: true, content: true },
  });
  const chatHistory: ChatMessage[] = recentMessages.reverse().map((m) => ({
    role: m.role as ChatMessage["role"],
    content: m.content,
  }));

  // Inject route context and user role into system prompt
  const populatedPrompt = `${agent.systemPrompt}\n\nCurrent context:\n- Route: ${input.routeContext}\n- User role: ${user.platformRole ?? "none"}`;

  let responseContent: string;
  let responseProviderId: string | null = null;
  let systemMessage: AgentMessageRow | undefined;

  try {
    const result = await callWithFailover(chatHistory, populatedPrompt, agent.sensitivity);
    responseContent = result.content;
    responseProviderId = result.providerId;

    // Log token usage (fire-and-forget with error logging)
    logTokenUsage({
      agentId: agent.agentId,
      providerId: result.providerId,
      contextKey: "coworker",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      inferenceMs: result.inferenceMs,
    }).catch((err) => console.error("[logTokenUsage]", err));

    // Downgrade notification
    if (result.downgraded && result.downgradeMessage) {
      const sysMsg = await prisma.agentMessage.create({
        data: {
          threadId: input.threadId,
          role: "system",
          content: result.downgradeMessage,
          agentId: agent.agentId,
          routeContext: input.routeContext,
        },
        select: { id: true, role: true, content: true, agentId: true, routeContext: true, createdAt: true },
      });
      systemMessage = serializeMessage(sysMsg);
    }
  } catch (e) {
    if (e instanceof NoProvidersAvailableError) {
      // Fall back to canned response
      responseContent = generateCannedResponse(agent.agentId, input.routeContext, user.platformRole);

      const sysMsg = await prisma.agentMessage.create({
        data: {
          threadId: input.threadId,
          role: "system",
          content: "AI providers are currently unavailable. Showing a pre-configured response.",
          agentId: agent.agentId,
          routeContext: input.routeContext,
        },
        select: { id: true, role: true, content: true, agentId: true, routeContext: true, createdAt: true },
      });
      systemMessage = serializeMessage(sysMsg);
    } else {
      throw e;
    }
  }

  // Persist agent response
  const agentMsg = await prisma.agentMessage.create({
    data: {
      threadId: input.threadId,
      role: "assistant",
      content: responseContent,
      agentId: agent.agentId,
      routeContext: input.routeContext,
      providerId: responseProviderId,
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
    ...(systemMessage !== undefined && { systemMessage }),
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

export async function clearConversation(input: {
  threadId: string;
}): Promise<{ ok: true } | { error: string }> {
  const user = await requireAuthUser();

  const thread = await prisma.agentThread.findUnique({
    where: { id: input.threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== user.id) {
    return { error: "Unauthorized" };
  }

  await prisma.agentMessage.deleteMany({
    where: { threadId: input.threadId },
  });

  return { ok: true };
}
