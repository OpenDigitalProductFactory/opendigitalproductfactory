// apps/web/app/api/agent/stream/route.ts
// SSE endpoint for real-time agent progress. Subscribes to the agent event bus
// and streams events to the browser as Server-Sent Events. On connect,
// replays the latest TaskRun.progressPayload for any active task on this
// thread so cross-process workers (e.g. Inngest) stay visible.

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { agentEventBus } from "@/lib/agent-event-bus";
import { projectPersistedTaskProgressEvents } from "@/lib/tak/task-stream-projection";
import { prisma } from "@dpf/db";

export const dynamic = "force-dynamic";

/**
 * Window during which terminal-status TaskRuns are still replayed.
 * Short-lived async jobs (e.g. brand extract completes in ~7s) finish
 * before the browser's EventSource connects. If we only replay
 * status="active", the subscriber misses the terminal event entirely
 * and the panel sits on "Working on it..." until the user refreshes
 * and the server-rendered state takes over.
 *
 * Including recently-completed/failed runs in replay gives the panel a
 * last-write-wins view of the latest progress event, regardless of
 * whether the producer outraced the subscriber.
 */
const TERMINAL_REPLAY_WINDOW_MS = 5 * 60 * 1000;

async function loadReplayEvents(
  threadId: string,
): Promise<Array<Record<string, unknown>>> {
  try {
    const terminalFloor = new Date(Date.now() - TERMINAL_REPLAY_WINDOW_MS);
    const runs = await prisma.taskRun.findMany({
      where: {
        threadId,
        progressPayload: { not: null as never },
        OR: [
          { status: "active" },
          {
            status: { in: ["completed", "failed"] },
            updatedAt: { gte: terminalFloor },
          },
        ],
      },
      select: {
        taskRunId: true,
        contextId: true,
        progressPayload: true,
        updatedAt: true,
        artifacts: {
          select: {
            artifactId: true,
            name: true,
            description: true,
            parts: true,
          },
          orderBy: { createdAt: "desc" },
          take: 3,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
    });
    return runs.flatMap((run) => {
      const replayed: Array<Record<string, unknown>> = [];
      replayed.push(
        ...projectPersistedTaskProgressEvents(run.progressPayload, {
          contextId: run.contextId ?? threadId,
        }),
      );
      for (const artifact of run.artifacts) {
        const parts = Array.isArray(artifact.parts) ? artifact.parts as Array<Record<string, unknown>> : [];
        const firstPart = parts[0] ?? {};
        replayed.push({
          type: "task:artifact",
          taskId: run.taskRunId,
          contextId: run.contextId ?? threadId,
          artifactId: artifact.artifactId,
          name: artifact.name,
          artifactType: typeof firstPart.type === "string" ? firstPart.type : "artifact",
          message: artifact.description ?? undefined,
        });
      }
      return replayed;
    });
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
