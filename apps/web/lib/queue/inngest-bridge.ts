// Inngest <-> AgentEventBus bridge.
// The event bus stays for real-time SSE (low latency, in-memory).
// This bridge provides a helper to emit queue progress events to the event bus
// from inside Inngest step functions, so the browser gets real-time updates
// while the durable execution handles retries and timeouts.

import { agentEventBus, type AgentEvent } from "@/lib/tak/agent-event-bus";

/**
 * Emit a real-time SSE event from inside an Inngest step function.
 * Call this within step.run() to push progress to the browser.
 */
export function emitQueueProgress(threadId: string, event: AgentEvent): void {
  agentEventBus.emit(threadId, event);
}
