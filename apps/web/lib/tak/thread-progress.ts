import { prisma } from "@dpf/db";
import { agentEventBus } from "@/lib/tak/agent-event-bus";
import type { AgentEvent } from "@/lib/tak/agent-event-bus";

/**
 * Persist a progress event to TaskRun.progressPayload AND best-effort
 * emit it on the in-process agent event bus. Use this from any context
 * (HTTP server OR Inngest worker) that wants to surface progress to the
 * coworker panel.
 *
 * - In-process callers: the bus emit reaches live SSE subscribers.
 * - Cross-process callers (Inngest workers in a separate container):
 *   the bus emit is a no-op locally; the SSE route replays
 *   progressPayload on next subscriber connect so the latest state is
 *   visible to the panel.
 *
 * Errors are swallowed — progress surface must never break the task
 * that's producing it.
 */
export async function pushThreadProgress(
  threadId: string | null,
  taskRunId: string,
  event: AgentEvent,
): Promise<void> {
  try {
    await prisma.taskRun.update({
      where: { taskRunId },
      data: {
        // Event is a tagged union, safe to persist as JSON
        progressPayload: JSON.parse(JSON.stringify(event)),
        updatedAt: new Date(),
      },
    });
  } catch {
    // Best-effort; progress writes must not break the producer.
  }

  if (threadId) {
    try {
      if (agentEventBus.isActive(threadId)) {
        agentEventBus.emit(threadId, event);
      }
    } catch {
      // Best-effort.
    }
  }
}
