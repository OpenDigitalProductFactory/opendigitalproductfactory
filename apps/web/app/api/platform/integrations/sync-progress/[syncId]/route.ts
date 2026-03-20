// apps/web/app/api/platform/integrations/sync-progress/[syncId]/route.ts
// SSE endpoint for real-time MCP catalog sync progress. Subscribes to the
// agent event bus keyed by syncId and streams events to the browser.

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { agentEventBus } from "@/lib/agent-event-bus";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ syncId: string }> },
): Promise<Response> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { syncId } = await params;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const unsub = agentEventBus.subscribe(syncId, (event) => {
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
