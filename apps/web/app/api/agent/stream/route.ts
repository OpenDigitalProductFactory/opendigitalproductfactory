// apps/web/app/api/agent/stream/route.ts
// SSE endpoint for real-time agent progress. Subscribes to the agent event bus
// and streams events to the browser as Server-Sent Events.

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { agentEventBus } from "@/lib/agent-event-bus";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const threadId = request.nextUrl.searchParams.get("threadId");
  if (!threadId) {
    return new Response("threadId required", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const unsub = agentEventBus.subscribe(threadId, (event) => {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // Stream already closed — unsubscribe
          unsub();
        }
        if (event.type === "done") {
          unsub();
          try { controller.close(); } catch { /* already closed */ }
        }
      });

      // Clean up on client disconnect
      request.signal.addEventListener("abort", () => {
        unsub();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
