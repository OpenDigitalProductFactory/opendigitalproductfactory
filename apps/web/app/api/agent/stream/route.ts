// apps/web/app/api/agent/stream/route.ts
// SSE endpoint for real-time agent progress. Subscribes to the agent event bus
// and streams events to the browser as Server-Sent Events. On connect,
// replays the latest TaskRun.progressPayload for any active task on this
// thread so cross-process workers (e.g. Inngest) stay visible.

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { agentEventBus } from "@/lib/agent-event-bus";
import { prisma } from "@dpf/db";

export const dynamic = "force-dynamic";

async function loadReplayEvents(
  threadId: string,
): Promise<Array<Record<string, unknown>>> {
  try {
    const activeRuns = await prisma.taskRun.findMany({
      where: { threadId, status: "active", progressPayload: { not: null as never } },
      select: { progressPayload: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 5,
    });
    return activeRuns
      .map((r) => r.progressPayload as Record<string, unknown> | null)
      .filter((p): p is Record<string, unknown> => p !== null);
  } catch {
    return [];
  }
}

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
    async start(controller) {
      // Replay latest progress from active TaskRuns so cross-process
      // workers (Inngest) are visible on reconnect.
      const replayEvents = await loadReplayEvents(threadId);
      for (const event of replayEvents) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream closed before we finished replay
          return;
        }
      }

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
