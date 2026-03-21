# EP-INF-009d: Async/Long-Running Inference Adapter

**Date:** 2026-03-21
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (COO/design partner)
**Epic:** EP-INF-009d
**Prerequisites:** EP-INF-008a (Execution Adapter Framework), EP-INF-009c (Alternate Endpoint Adapters)
**Related:** EP-ASYNC-001 (general async agent ops), EP-INF-008d (original umbrella scope)

---

## Problem Statement

Some AI models take minutes, not seconds. Google's Deep Research via the Interactions API runs multi-step investigations that can take 2–10 minutes. OpenAI's potential future long-running endpoints follow similar patterns. The execution adapter framework handles synchronous request→response perfectly, but has no way to:

1. Start a long-running operation and return an operation ID
2. Poll for completion
3. Store and retrieve results when they arrive
4. Notify the caller when done
5. Handle timeout/cancellation

The platform already has async infrastructure (event bus + SSE, ScheduledJob, McpCatalogSync tracking pattern) — but no adapter that bridges these to the inference pipeline.

---

## Design

### 1. New Schema: `AsyncInferenceOp`

Tracks the lifecycle of a long-running inference operation. Follows the `McpCatalogSync` pattern.

```prisma
model AsyncInferenceOp {
  id              String    @id @default(cuid())
  providerId      String
  modelId         String
  operationId     String?   // Provider's operation/interaction ID (e.g., Google operation name)
  contractFamily  String
  requestContext  Json      // Serialized request params (messages, systemPrompt, plan)

  status          String    @default("pending")  // pending | running | completed | failed | cancelled | expired

  resultText      String?   @db.Text             // Final text result (if any)
  resultData      Json?                           // Full structured result (raw response)
  errorMessage    String?   @db.Text

  // Progress tracking
  progressPct     Int?                            // 0-100 estimated progress
  progressMessage String?                         // Human-readable status ("Searching sources...", "Compiling report...")

  // Lifecycle timestamps
  createdAt       DateTime  @default(now())
  startedAt       DateTime?                       // When provider acknowledged the operation
  completedAt     DateTime?
  expiresAt       DateTime                        // Hard deadline — cancel if not done by this time

  // Caller context — for notification routing
  threadId        String?                         // Agent event bus key (for SSE progress)
  callerContext   Json?                           // Opaque context the caller can use on completion

  @@index([status])
  @@index([providerId, status])
  @@index([threadId])
}
```

**Status transitions:**
```
pending → running → completed
                  → failed
                  → expired (if expiresAt passes while running)
pending → cancelled (by caller)
running → cancelled (by caller)
```

### 2. Async Execution Adapter

A new adapter type `"async"` that implements `ExecutionAdapterHandler` differently:

```typescript
interface AsyncAdapterResult extends AdapterResult {
  /** The operation ID for polling. When present, result is not yet available. */
  operationId: string;
  /** Status: "accepted" means the operation was submitted but not yet complete. */
  asyncStatus: "accepted";
}
```

The adapter's `execute()` method **starts** the operation and returns immediately with an operation ID. It does NOT wait for completion. The `text` field is empty and `asyncStatus` indicates the result is pending.

#### Google Interactions API Branch

```typescript
// Start a deep research interaction
POST {baseUrl}/models/{modelId}:startInteraction
{
  contents: [{ role: "user", parts: [{ text: prompt }] }],
  config: {
    responseModalities: ["TEXT"],
    // Deep Research specific settings from plan.providerSettings
  }
}

// Response:
{
  name: "operations/{operationId}",  // Google LRO pattern
  done: false,
  metadata: { ... }
}
```

#### Polling

```typescript
// Check operation status
GET {baseUrl}/operations/{operationId}

// Response (in progress):
{ name: "operations/{operationId}", done: false, metadata: { progress: 45 } }

// Response (complete):
{
  name: "operations/{operationId}",
  done: true,
  response: {
    candidates: [{ content: { parts: [{ text: "Full research report..." }] } }],
    usageMetadata: { ... }
  }
}
```

### 3. Async Operation Lifecycle

#### 3a. Start (Caller initiates)

`routeAndCall()` detects `interactionMode: "background"` on the contract and:
1. Routes through V2 pipeline normally (selects endpoint + recipe)
2. Calls the async adapter's `execute()` — gets back `operationId`
3. Creates an `AsyncInferenceOp` record with status `"running"`
4. Returns a `RoutedInferenceResult` with `asyncOperationId` set

The caller can then subscribe to the event bus for progress, or poll the operation directly.

#### 3b. Poll (Background loop)

A polling function `pollAsyncOperation(opId)` that:
1. Reads the `AsyncInferenceOp` record
2. Calls the provider's status endpoint
3. Updates `progressPct` and `progressMessage`
4. Emits progress via `agentEventBus.emit(threadId, { type: "async:progress", ... })`
5. If done: updates status to `"completed"`, stores result, emits `"async:complete"`
6. If error: updates status to `"failed"`, stores error

Polling is driven by the caller (not a global cron). The agentic loop or calling code calls `pollAsyncOperation()` periodically while waiting. This avoids the need for a background polling daemon.

#### 3c. Expiry

If `expiresAt` passes and the operation is still `"running"`:
- Next poll attempt marks it `"expired"`
- Provider cancellation is attempted (best-effort)
- Event bus emits `"async:expired"`

Default expiry: 15 minutes from creation (configurable via `plan.providerSettings.maxDurationMs`).

### 4. `routeAndCall()` Extension

```typescript
export interface RouteAndCallOptions {
  // ... existing fields ...
  /** When "background", starts async operation and returns immediately. */
  interactionMode?: "sync" | "background";
}

export interface RoutedInferenceResult {
  // ... existing fields ...
  /** Set when interactionMode is "background". Poll via pollAsyncOperation(). */
  asyncOperationId?: string;
}
```

When `interactionMode === "background"`:
- `inferContract()` already sets `interactionMode: "background"` which disables streaming
- The routing pipeline selects models that support the required capability
- The async adapter starts the operation
- `routeAndCall()` returns immediately with `asyncOperationId`

### 5. Result Retrieval

```typescript
/** Get the result of a completed async operation. */
export async function getAsyncOperationResult(
  opId: string,
): Promise<RoutedInferenceResult | null> {
  const op = await prisma.asyncInferenceOp.findUnique({ where: { id: opId } });
  if (!op || op.status !== "completed") return null;

  return {
    providerId: op.providerId,
    modelId: op.modelId,
    content: op.resultText ?? "",
    toolCalls: [],
    inputTokens: (op.resultData as any)?.usage?.inputTokens ?? 0,
    outputTokens: (op.resultData as any)?.usage?.outputTokens ?? 0,
    downgraded: false,
    downgradeMessage: null,
    routeDecision: null as any, // Not available for async results
  };
}
```

### 6. New Event Types

Extend `AgentEvent` in `agent-event-bus.ts`:

```typescript
| { type: "async:started"; operationId: string; providerId: string; modelId: string }
| { type: "async:progress"; operationId: string; progressPct: number; message: string }
| { type: "async:complete"; operationId: string }
| { type: "async:failed"; operationId: string; error: string }
| { type: "async:expired"; operationId: string }
```

---

## Implementation Order

1. **Schema** — Add `AsyncInferenceOp` to Prisma schema
2. **Async adapter** — `apps/web/lib/routing/async-adapter.ts` (Google Interactions API)
3. **Polling function** — `apps/web/lib/async-inference.ts` (poll + completion logic)
4. **Event bus extension** — Add async event types
5. **routeAndCall extension** — background interactionMode support
6. **Tests** — Adapter mock tests, polling state machine, expiry handling

---

## Files to Create

| File | Purpose |
|------|---------|
| `apps/web/lib/routing/async-adapter.ts` | Async execution adapter (Google Interactions API) |
| `apps/web/lib/async-inference.ts` | Polling, completion, expiry, result retrieval |
| Prisma migration | `AsyncInferenceOp` model |

## Files to Modify

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `AsyncInferenceOp` model |
| `apps/web/lib/agent-event-bus.ts` | Add async event types |
| `apps/web/lib/routed-inference.ts` | `interactionMode` option, `asyncOperationId` on result |
| `apps/web/lib/routing/request-contract.ts` | Background mode already supported — no changes needed |
| `apps/web/lib/ai-inference.ts` | Import async adapter for registration |

## Tests

| Test | Coverage |
|------|----------|
| `async-adapter.test.ts` | Start operation, operation ID extraction, error handling |
| `async-inference.test.ts` | Poll state machine, completion flow, expiry, result retrieval |

---

## What Is NOT In Scope

- **UI for async results** — "Research in progress" component, result display. Separate UX epic.
- **WebSocket/Realtime** — OpenAI realtime API is bidirectional streaming, fundamentally different pattern. Future adapter.
- **Global polling daemon** — Polling is caller-driven, not a background service. Simpler, no extra process.
- **Operation cancellation API** — Best-effort on expiry. Explicit cancel endpoint deferred.
- **Multi-turn interactions** — Deep Research is single-prompt → report. Multi-turn async conversations deferred.
- **Cost tracking for async ops** — Usage data arrives on completion, integrated via existing token logging.
