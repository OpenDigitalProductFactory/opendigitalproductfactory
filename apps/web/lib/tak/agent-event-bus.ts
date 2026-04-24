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
  | { type: "done"; agentMessageId?: string; systemMessageId?: string; formAssistUpdate?: Record<string, unknown>; providerInfo?: { providerId: string; modelId: string }; error?: string }
  // EP-ASYNC-COWORKER-001: error event for background execution failures
  | { type: "error"; message: string }
  // Sandbox lifecycle events
  | { type: "sandbox:ready"; buildId: string; port: number }
  // Robust coding events — emitted during sandbox code generation
  | { type: "coding:file_written"; buildId: string; path: string; action: "create" | "modify" }
  | { type: "coding:context_gathered"; buildId: string; filesRead: number }
  | { type: "coding:test_fix_attempt"; buildId: string; attempt: number; maxAttempts: number }
  | { type: "coding:build_check"; buildId: string; passed: boolean; errorCount?: number }
  // EP-INF-009d: Async inference events
  | { type: "async:started"; operationId: string; providerId: string; modelId: string }
  | { type: "async:progress"; operationId: string; progressPct: number; message: string }
  | { type: "async:complete"; operationId: string }
  | { type: "async:failed"; operationId: string; error: string }
  | { type: "async:expired"; operationId: string }
  // EP-BUILD-ORCHESTRATOR: orchestrator progress events
  | { type: "orchestrator:build_started"; buildId: string; taskCount: number; specialists: string[] }
  | { type: "orchestrator:task_dispatched"; buildId: string; taskTitle: string; specialist: string }
  | { type: "orchestrator:task_progress"; buildId: string; taskTitle: string; message: string }
  | { type: "orchestrator:task_complete"; buildId: string; taskTitle: string; specialist: string; outcome: string; status?: string }
  | { type: "orchestrator:phase_summary"; buildId: string; completed: number; total: number; summary: string }
  | { type: "orchestrator:specialist_retry"; buildId: string; specialist: string; reason: string; attempt: number }
  | { type: "orchestrator:task_gate_failed"; buildId: string; taskTitle: string; specialist: string; typecheckPassed: boolean; buildPassed: boolean }
  | { type: "orchestrator:warning"; buildId: string; message: string }
  // EP-CWQ-001: Collaborative work queue events
  | { type: "queue:item_created"; workItemId: string; sourceType: string; urgency: string }
  | { type: "queue:item_assigned"; workItemId: string; workerType: string; workerId: string }
  | { type: "queue:item_claimed"; workItemId: string; workerType: string; workerId: string }
  | { type: "queue:item_status_changed"; workItemId: string; fromStatus: string; toStatus: string }
  | { type: "queue:item_completed"; workItemId: string; outcome: "success" | "failed" | "cancelled" }
  | { type: "queue:escalation"; workItemId: string; fromWorker: string; toWorker: string; reason: string }
  | { type: "queue:sla_warning"; workItemId: string; minutesRemaining: number }
  | { type: "queue:message"; workItemId: string; messageType: string; senderId: string }
  // Brand extraction events (long-running background job routed through coworker panel)
  | { type: "brand:extract.progress"; taskRunId: string; stage: string; message: string; percent: number }
  | { type: "brand:extract.complete"; taskRunId: string; summary: string }
  | { type: "brand:extract.failed"; taskRunId: string; error: string }
  // UX verification (Inngest build/review.verify) events — surfaced in
  // ReviewPanel and the coworker panel so the user sees verification running
  // without having to poll the build record.
  | { type: "verification:started"; buildId: string; testCount: number }
  | { type: "verification:step"; buildId: string; stepIndex: number; description: string; passed: boolean }
  | { type: "verification:complete"; buildId: string; passed: number; total: number; status: "complete" | "failed" | "skipped" }
  // Deliberation (Task 6) — emitted by queue/functions/deliberation-run.ts
  // so the coworker panel + Build Studio can show when a pattern is running,
  // which branches dispatched, and whether diversity degraded.
  | { type: "deliberation:queued"; deliberationRunId: string; patternSlug: string }
  | { type: "deliberation:branch_dispatched"; deliberationRunId: string; branchNodeId: string; role: string }
  | { type: "deliberation:branch_completed"; deliberationRunId: string; branchNodeId: string; role: string; success: boolean }
  | { type: "deliberation:degraded_diversity"; deliberationRunId: string; from: string; to: string; reason: string }
  | { type: "deliberation:completed"; deliberationRunId: string; consensusState: string };

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

// EP-ASYNC-COWORKER-001: Track which threads have active background executions.
// Used by the client to resume the SSE listener + thinking indicator when
// navigating back to a page with a running agent task.
const activeThreads = new Set<string>();

function markActive(threadId: string): void {
  activeThreads.add(threadId);
}

function markIdle(threadId: string): void {
  activeThreads.delete(threadId);
}

function isActive(threadId: string): boolean {
  return activeThreads.has(threadId);
}

// EP-ASYNC-COWORKER-001: In-memory cancellation set.
// Checked by agentic-loop at each iteration boundary.
const cancelledThreads = new Set<string>();

function requestCancel(threadId: string): void {
  cancelledThreads.add(threadId);
}

function isCancelled(threadId: string): boolean {
  return cancelledThreads.has(threadId);
}

function clearCancel(threadId: string): void {
  cancelledThreads.delete(threadId);
}

export const agentEventBus = { subscribe, emit, requestCancel, isCancelled, clearCancel, markActive, markIdle, isActive };
