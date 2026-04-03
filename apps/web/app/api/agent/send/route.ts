// EP-ASYNC-COWORKER-001: Non-blocking message submission endpoint.
// Accepts the message, returns immediately, runs agent execution in background.
// The SSE stream (/api/agent/stream) delivers progress + enriched "done" event.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendMessage } from "@/lib/actions/agent-coworker";
import { agentEventBus } from "@/lib/agent-event-bus";
import type { AgentFormAssistContext } from "@/lib/agent-form-assist";

export const dynamic = "force-dynamic";

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
      agentEventBus.emit(input.threadId, {
        type: "error",
        message: err instanceof Error ? err.message : "Agent execution failed",
      });
      agentEventBus.emit(input.threadId, { type: "done", error: "Agent execution failed" });
    }
  })();

  return response;
}
