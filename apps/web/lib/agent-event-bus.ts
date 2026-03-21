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
  | { type: "sync:progress"; totalFetched: number; totalUpserted: number; totalNew: number }
  | { type: "done" }
  // EP-INF-009d: Async inference events
  | { type: "async:started"; operationId: string; providerId: string; modelId: string }
  | { type: "async:progress"; operationId: string; progressPct: number; message: string }
  | { type: "async:complete"; operationId: string }
  | { type: "async:failed"; operationId: string; error: string }
  | { type: "async:expired"; operationId: string };

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
