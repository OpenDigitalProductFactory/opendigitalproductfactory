// EP-ASYNC-COWORKER-001: Non-blocking message submission endpoint.
// Accepts the message, returns immediately, runs agent execution in background.
// The SSE stream (/api/agent/stream) delivers progress + enriched "done" event.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendMessage } from "@/lib/actions/agent-coworker";
import { agentEventBus } from "@/lib/agent-event-bus";
import type { AgentFormAssistContext } from "@/lib/agent-form-assist";
import { resolveAgentForRoute } from "@/lib/agent-routing";
// Note: this route uses the sync version since it only needs agentId for message logging
import { prisma } from "@dpf/db";

export const dynamic = "force-dynamic";

async function persistBackgroundFailureMessage(input: {
  threadId: string;
  routeContext: string;
  message: string;
  sessionUser: { id: string; platformRole?: string | null; isSuperuser?: boolean | null };
}): Promise<string | null> {
  try {
    const agent = resolveAgentForRoute(input.routeContext, {
      userId: input.sessionUser.id,
      platformRole: input.sessionUser.platformRole ?? null,
      isSuperuser: input.sessionUser.isSuperuser ?? false,
    });
    const sysMsg = await prisma.agentMessage.create({
      data: {
        threadId: input.threadId,
        role: "system",
        content: input.message,
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
    return sysMsg.id;
  } catch (persistErr) {
    console.error("[api/agent/send] failed to persist background error message:", persistErr);
    return null;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let input: {
    threadId: string;
    content: string;
    routeContext: string;
    coworkerMode?: "advise" | "act";
    externalAccessEnabled?: boolean;
    elevatedFormFillEnabled?: boolean;
    formAssistContext?: AgentFormAssistContext;
    buildId?: string;
    attachmentId?: string;
  };

  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!input.threadId || !input.content || !input.routeContext) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Clear any stale cancellation for this thread
  agentEventBus.clearCancel(input.threadId);

  // Track this thread as actively executing
  agentEventBus.markActive(input.threadId);

  // Return immediately — agent execution runs in background
  const response = NextResponse.json({ status: "processing" });

  // Fire-and-forget: run sendMessage in background and emit enriched "done" on completion
  (async () => {
    try {
      const result = await sendMessage(input);

      agentEventBus.markIdle(input.threadId);

      if ("error" in result) {
        agentEventBus.emit(input.threadId, {
          type: "error",
          message: result.error,
        });
        agentEventBus.emit(input.threadId, { type: "done", error: result.error });
        return;
      }

      // Emit enriched done with all data the client needs
      agentEventBus.emit(input.threadId, {
        type: "done",
        agentMessageId: result.agentMessage.id,
        ...(result.systemMessage ? { systemMessageId: result.systemMessage.id } : {}),
        ...(result.formAssistUpdate ? { formAssistUpdate: result.formAssistUpdate } : {}),
        ...("providerInfo" in result && result.providerInfo
          ? { providerInfo: result.providerInfo as { providerId: string; modelId: string } }
          : {}),
      });
    } catch (err) {
      agentEventBus.markIdle(input.threadId);
      console.error("[api/agent/send] background execution failed:", err);
      const errorMessage = err instanceof Error ? err.message : "Agent execution failed";
      const systemMessageId = await persistBackgroundFailureMessage({
        threadId: input.threadId,
        routeContext: input.routeContext,
        message: `The AI coworker hit a background error and could not finish this request: ${errorMessage}`,
        sessionUser: {
          id: session.user.id,
          platformRole: session.user.platformRole ?? null,
          isSuperuser: session.user.isSuperuser ?? false,
        },
      });
      agentEventBus.emit(input.threadId, {
        type: "error",
        message: errorMessage,
      });
      agentEventBus.emit(input.threadId, {
        type: "done",
        ...(systemMessageId ? { systemMessageId } : {}),
        error: "Agent execution failed",
      });
    }
  })();

  return response;
}
