/**
 * System-level SSE stream for platform events (BI-QUIESCE-006).
 *
 * Companion to /api/agent/stream — which is per-threadId for agent task
 * progress. This route subscribes only to the system channel (events
 * broadcast via agentEventBus.broadcastSystem) so clients that just need
 * to render the PlatformBanner don't need to make up a fake threadId.
 *
 * Currently emits system:quiescence (drain banner state) and
 * system:self-upgrade (durable run-state invalidation hints).
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
import { createSseResponse } from "@/lib/sse/sse-stream";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // This is the ALWAYS-ON stream (mounted via PlatformBanner in the shell
  // layout), so it is the connection most prone to becoming a zombie across a
  // portal rebuild. createSseResponse adds the liveness heartbeat the client
  // watchdog needs to reap it. See lib/sse/sse-stream.ts for the full rationale.
  return createSseResponse({
    signal: request.signal,
    start: (sse) =>
      agentEventBus.subscribeSystem((event) => {
        // Filter to system: events only — broadcastSystem also fans out to
        // per-thread subscribers, but the system stream should only carry
        // system-namespace events.
        if (!event.type.startsWith("system:")) return;
        sse.send(event);
      }),
  });
}
