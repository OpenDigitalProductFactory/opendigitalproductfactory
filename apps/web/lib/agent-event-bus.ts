// apps/web/lib/agent-event-bus.ts
// Lightweight typed event emitter for real-time agent progress.
// Keyed by threadId. SSE endpoint subscribes, agentic loop emits.

export type AgentEvent =
  | { type: "tool:start"; tool: string; iteration: number }
  | { type: "tool:complete"; tool: string; success: boolean }
  | { type: "phase:change"; buildId: string; phase: string }
  | { type: "brief:update"; buildId: string }
  | { type: "evidence:update"; buildId: string; field: string }
  | { type: "iteration"; iteration: number; toolCount: number }
  | { type: "test:step"; stepIndex: number; description: string; screenshot?: string; passed: boolean }
  | { type: "done" };

type Handler = (event: AgentEvent) => void;

const subscribers = new Map<string, Set<Handler>>();

function subscribe(threadId: string, handler: Handler): () => void {
  if (!subscribers.has(threadId)) subscribers.set(threadId, new Set());
  subscribers.get(threadId)!.add(handler);
  return () => {
    subscribers.get(threadId)?.delete(handler);
    if (subscribers.get(threadId)?.size === 0) subscribers.delete(threadId);
  };
}

function emit(threadId: string, event: AgentEvent): void {
  subscribers.get(threadId)?.forEach((handler) => handler(event));
}

export const agentEventBus = { subscribe, emit };
