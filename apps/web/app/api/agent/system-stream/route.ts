/**
 * System-level SSE stream for platform events (BI-QUIESCE-006).
 *
 * Companion to /api/agent/stream — which is per-threadId for agent task
 * progress. This route subscribes only to the system channel (events
 * broadcast via agentEventBus.broadcastSystem) so clients that just need
 * to render the PlatformBanner don't need to make up a fake threadId.
 *
 * Currently emits: system:quiescence (drain banner state).
 * Future system events (system:maintenance, system:announcement, etc.)
 * land on the same stream.
 *
 * Auth: requires an authenticated session (any user) — banner is shown
 * inside the shell layout which is itself auth-gated. The stream itself
 * leaks no sensitive data (event payloads carry runId + level only).
 *
 * Spec: docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md §7.1
 */
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { agentEventBus } from "@/lib/agent-event-bus";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Initial heartbeat so the client EventSource confirms connection.
      try {
        controller.enqueue(encoder.encode(`: connected\n\n`));
      } catch {
        return;
      }

      const unsub = agentEventBus.subscribeSystem((event) => {
        // Filter to system: events only — broadcastSystem also fans out
        // to per-thread subscribers, but the system stream should only
        // carry system-namespace events.
        if (!event.type.startsWith("system:")) return;
        const data = `data: ${JSON.stringify(event)}\n\n`;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          unsub();
        }
      });

      // Clean up on client disconnect.
      request.signal.addEventListener("abort", () => {
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
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
