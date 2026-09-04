// apps/web/lib/agent-event-bus.ts
// Lightweight typed event emitter for real-time agent progress.
// Keyed by threadId. SSE endpoint subscribes, agentic loop emits.

import type { TaskState } from "@/lib/tak/task-states";
import type { SelfUpgradeRunStatus } from "@/lib/self-upgrade/run-types";

export type SystemQuiescenceEvent = {
  type: "system:quiescence";
  level: "draining" | "swapping" | "cleared";
  runId: string;
  swapEtaSeconds: number | null;
  deferReason: string | null;
  deferSurface: string | null;
  outcome: "draining" | "swapping" | "succeeded" | "deferred" | "aborted" | "failed";
};

export type SystemSelfUpgradeEvent = {
  /** Durable state changed; consumers must rehydrate their read model. */
  type: "system:self-upgrade";
  runId: string;
  status: SelfUpgradeRunStatus;
  observedAt: string;
};

export type SystemLocalModelEvent = {
  type: "system:local-model";
  operationId: string;
  modelReference: string;
  status: "running" | "completed" | "failed";
  observedAt: string;
};

export type AgentEvent =
  // Attention Surface (EP-ATTENTION-SURFACE, BI-094A124F): a new pending-human
  // item appeared. Broadcast system-wide so the "Needs you" inbox refreshes live.
  | { type: "attention:created"; source: string; itemKey: string; userId: string; title: string; deepLink: string; riskClass?: string }
  | { type: "task:status"; taskId: string; contextId: string | null; state: TaskState; sourceEvent?: string; message?: string; progress?: { stage?: string; percent?: number } }
  | { type: "task:artifact"; taskId: string; contextId: string | null; artifactId: string; name: string; artifactType: string; sourceEvent?: string; message?: string }
  | { type: "tool:start"; tool: string; iteration: number }
  | { type: "tool:complete"; tool: string; success: boolean }
  | { type: "phase:change"; buildId: string; phase: string }
  | { type: "brief:update"; buildId: string }
  | { type: "evidence:update"; buildId: string; field: string }
  | { type: "iteration"; iteration: number; toolCount: number }
  // BI-95C0835E: the agentic loop's execution plan changed (recorded or a step
  // updated). Streamed so the UI can show the plan executing step-by-step —
  // the perceived-progress + trust mechanism (Perplexity's streamed Pro plan).
  | { type: "plan:update"; goal: string; steps: Array<{ id: string; description: string; status: string }>; done: number; total: number }
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
  | { type: "async:cancelled"; operationId: string }
  | { type: "async:failed"; operationId: string; error: string }
  | { type: "async:expired"; operationId: string }
  // EP-BUILD-ORCHESTRATOR: orchestrator progress events
  | { type: "orchestrator:build_started"; buildId: string; taskCount: number; specialists: string[] }
  | { type: "orchestrator:task_dispatched"; buildId: string; taskTitle: string; specialist: string }
  | { type: "orchestrator:task_progress"; buildId: string; taskTitle: string; message: string }
  | { type: "orchestrator:task_complete"; buildId: string; taskTitle: string; specialist: string; outcome: string; status?: string }
  | { type: "orchestrator:phase_summary"; buildId: string; completed: number; total: number; summary: string }
  | { type: "orchestrator:specialist_retry"; buildId: string; specialist: string; reason: string; attempt: number }
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
  | { type: "deliberation:completed"; deliberationRunId: string; consensusState: string }
  // EP-A2A multi-agent collaboration (2026-06-04 spec) — surfaced in the
  // coworker panel so the user SEES when one coworker hands off to, summons,
  // or returns control from another. Correlated across parent/child threads by
  // parentThreadId. `enteredVia` distinguishes the collaboration trigger.
  | {
      type: "collaboration:handoff";
      parentThreadId: string;
      childThreadId: string;
      fromAgentId: string;
      toAgentId: string;
      taskRunId: string | null;
      tier: 2 | 3;
      enteredVia: "handoff" | "escalation" | "spawn";
      questionPacketSummary?: string;
    }
  | {
      type: "collaboration:summon";
      parentThreadId: string;
      childThreadId: string | null;
      /** The active coworker who brought the peer in (the summon is coworker-
       *  initiated; the human never tasks peers). */
      fromAgentId?: string;
      summonedAgentId: string;
      tier: 2 | 3;
      byUserId?: string;
    }
  | {
      type: "collaboration:return";
      parentThreadId: string;
      childThreadId: string;
      fromAgentId: string;
      toAgentId: string;
      taskRunId: string | null;
      outcome: "completed" | "failed" | "canceled";
      /** Server-validated, persisted primary-coworker response for specialized governed returns. */
      ownerMessage?: string;
    }
  // BI-4ab6be39 stall detection — emitted by ops/taskrun-watchdog when a
  // working TaskRun is transitioned to "stalled". Operator UIs subscribe to
  // refresh without polling.
  | { type: "taskrun:stalled"; taskRunId: string; buildId: string | null; phase: string | null; reason: string }
  // BI-QUIESCE-006 Activity Quiescence Protocol — coordinator broadcasts
  // these to ALL subscribers (broadcastSystem below) so every open SSE
  // stream renders the banner state. The "cleared" level fires on every
  // terminal transition (success | deferred | aborted | failed — outcome
  // distinguishes them) and is also consumed by suspended Inngest
  // functions waiting on platform.quiescence-cleared. Spec §7.1.
  | SystemQuiescenceEvent
  | SystemSelfUpgradeEvent
  | SystemLocalModelEvent;

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
  subscribers.get(threadId)?.forEach((handler) => deliver(handler, event));
}

// BI-QUIESCE-006 — system-namespace event registry separate from threadId
// keying. Used by `broadcastSystem` to fan out platform-level events (e.g.,
// system:quiescence) to every open client without requiring per-thread
// subscription. The agent-stream SSE handler subscribes to both its own
// threadId (existing pattern) AND "*" (new system channel) so clients see
// both their own task events and platform events on the same stream.
const SYSTEM_CHANNEL = "__dpf_system__";

function subscribeSystem(handler: Handler): () => void {
  if (!subscribers.has(SYSTEM_CHANNEL)) subscribers.set(SYSTEM_CHANNEL, new Set());
  subscribers.get(SYSTEM_CHANNEL)!.add(handler);
  return () => {
    subscribers.get(SYSTEM_CHANNEL)?.delete(handler);
    if (subscribers.get(SYSTEM_CHANNEL)?.size === 0) subscribers.delete(SYSTEM_CHANNEL);
  };
}

function broadcastSystem(event: AgentEvent): void {
  // Fan out to system-channel subscribers AND every per-thread subscriber —
  // the latter ensures that legacy consumers subscribed only to specific
  // threadIds still receive system events without code changes. Cheap
  // forEach across the subscriber Map; in practice a single portal has
  // O(open-tabs) subscribers.
  for (const [, handlers] of subscribers) {
    handlers.forEach((handler) => deliver(handler, event));
  }
}

function deliver(handler: Handler, event: AgentEvent): void {
  try {
    handler(event);
  } catch (error) {
    // Event delivery is advisory. A broken observer must not prevent durable
    // work or starve other subscribers of the same lifecycle notification.
    console.error("[agent-event-bus] subscriber failed", error);
  }
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

export const agentEventBus = {
  subscribe,
  emit,
  subscribeSystem,
  broadcastSystem,
  requestCancel,
  isCancelled,
  clearCancel,
  markActive,
  markIdle,
  isActive,
};
