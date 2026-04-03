# Async Coworker Messaging — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | EP-ASYNC-COWORKER-001 |
| **IT4IT Alignment** | Cross-cutting; supports all value streams by unblocking the human operator |
| **Status** | Design |
| **Created** | 2026-04-03 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |
| **Dependencies** | EP-TAK-PATTERNS (agentic architecture), EP-BUILD-ORCHESTRATOR (specialist agents) |
| **Supersedes** | EP-ASYNC-001 Layer 1 (in-panel sync indicator) — this spec replaces the blocking interaction model |
| **Design Motto** | "Do what Claude Code does" — fire-and-forget submission, streaming progress, non-blocking UI |

---

## 1. Problem Statement

The AI Coworker panel uses `useTransition` + a synchronous server action (`sendMessage`) for all agent interactions. This creates three critical UX failures:

### 1.1 Page Lock-up During Agent Execution

`useTransition` in Next.js blocks client-side navigation while the server action HTTP request is in-flight. When the COO orchestrator or any agent takes 60-250+ seconds, the **entire page is frozen** — no scrolling content, no clicking tiles, no navigating to other routes. The user is held hostage by their own coworker.

**Root cause:** `AgentCoworkerPanel.tsx:229` — `startTransition(async () => { await sendMessage(...) })`.

### 1.2 False "Not Sent" / Contradictory Delivery State

A client-side `Promise.race` timeout (60s for non-build routes, 600s for build routes) fires before the server action completes. This marks the message as `deliveryState: "failed"` with "Not sent" text and a Retry button — **while the SSE stream simultaneously shows "COO is still working (100s)"**. The message was sent and is being processed; the UI lies.

**Root cause:** `AgentCoworkerPanel.tsx:244-248` — timeout + `failOptimisticMessage` while `isPending` from `useTransition` remains `true`.

### 1.3 No Cancellation

When an agent has been working for minutes, the user has no way to stop it. The only escape is closing the browser tab.

### Observed Scenario (2026-04-03)

On the workspace page, user sent a message to the COO agent. The agent executed for ~250 seconds. At 60s the message showed "Not sent" + Retry. The thinking indicator continued to count ("COO is still working (100s)"). The page was completely unresponsive — no tile clicks, no sidebar navigation. The timer finally stopped at ~250s when the server action returned.

---

## 2. Architecture

### 2.1 Current Flow (Blocking)

```
Browser                          Server (Node.js)
  │                                │
  ├─ startTransition ──────────────┤
  │   sendMessage(input)           │ persist user msg
  │   (Next.js holds router)       │ build prompt
  │                                │ runAgenticLoop / runBuildOrchestrator
  │   ◄──── SSE events ───────────│   emit tool:start, tool:complete, ...
  │   (progress visible but        │   (runs 60-600+ seconds)
  │    page frozen, input locked)  │
  │                                │ persist agent msg
  │   Promise.race(send, timeout)  │
  │   timeout fires at 60s ────►   │ (server still running)
  │   "Not sent" shown             │
  │   ...                          │
  │   ◄──── response ──────────────┤ (returns at 250s)
  │   isPending=false              │
  │   page unfreezes               │
  └────────────────────────────────┘
```

### 2.2 Proposed Flow (Non-Blocking)

```
Browser                          Server (Node.js)
  │                                │
  ├─ fetch POST /api/agent/send ──►│ persist user msg
  │   ◄── 200 { ack } ────────────┤ return userMessageId immediately
  │   isBusy=true (local state)   │
  │   (page responsive,            │ fire-and-forget:
  │    navigation works)           │   runAgenticLoop / runBuildOrchestrator
  │                                │   emit SSE events
  │   ◄──── SSE events ───────────│   tool:start, orchestrator:*, ...
  │   (progress updates rendered)  │
  │                                │ persist agent msg
  │   ◄──── SSE "done" ───────────┤ emit enriched done event
  │   {agentMessageId,             │
  │    formAssistUpdate?,          │
  │    providerInfo?,              │
  │    systemMessageId?}           │
  │                                │
  │   fetch latest messages ──────►│ getOrCreateThreadSnapshot
  │   ◄── messages ────────────────┤
  │   reconcile + render           │
  │   isBusy=false                 │
  └────────────────────────────────┘
```

Key differences:
- **No `useTransition`** — the Next.js router is never aware of the server work
- **No `Promise.race` timeout** — SSE is the source of truth for completion
- **`isBusy` is local `useState`** — decoupled from router, only controls input disable
- **Navigation always works** — user can leave and return; messages are in DB

---

## 3. Detailed Design

### 3.1 New API Route: `POST /api/agent/send`

**File:** `apps/web/app/api/agent/send/route.ts`

This route replaces the direct server action call from the client. It:

1. Validates auth + thread ownership (same as current `sendMessage` preamble)
2. Persists the user message to the database
3. Returns `{ userMessageId, status: "processing" }` immediately (< 100ms)
4. Kicks off agent execution as a **detached promise** (not awaited)
5. The detached promise runs `sendMessage`-equivalent logic and emits the enriched `done` event on completion

```typescript
// Pseudocode — apps/web/app/api/agent/send/route.ts
export async function POST(req: Request) {
  const user = await requireAuthUser();
  const input = await req.json();
  
  // Validate + persist user message (fast path)
  const userMsg = await persistUserMessage(input);
  
  // Fire-and-forget: agent execution runs in background
  executeAgentInBackground(input, userMsg.id, user).catch((err) => {
    console.error("[agent/send] background execution failed:", err);
    agentEventBus.emit(input.threadId, {
      type: "error",
      message: err.message ?? "Agent execution failed",
    });
    agentEventBus.emit(input.threadId, { type: "done" });
  });
  
  return NextResponse.json({ userMessageId: userMsg.id, status: "processing" });
}
```

**Why a new route instead of modifying the server action?**
- Server actions called via `useTransition` block the Next.js router — no workaround
- Server actions called via plain `await` still occupy the server action queue
- A regular `fetch()` to an API route is completely decoupled from the router
- The existing `sendMessage` server action can remain for backward compatibility / testing

### 3.2 Enrich the `done` Event

**File:** `apps/web/lib/tak/agent-event-bus.ts`

Current `done` event: `{ type: "done" }` — bare signal.

New `done` event:

```typescript
| { 
    type: "done";
    agentMessageId?: string;
    systemMessageId?: string;
    formAssistUpdate?: Record<string, unknown>;
    providerInfo?: { providerId: string; modelId: string };
    error?: string;
  }
```

This carries the ephemeral data (`formAssistUpdate`, `providerInfo`) that isn't DB-persisted, plus IDs for the persisted messages so the client can choose to fetch them directly or use the snapshot endpoint.

### 3.3 New `error` Event

Add a new event type for unrecoverable failures during background execution:

```typescript
| { type: "error"; message: string }
```

Emitted before `done` when the background execution throws. The client shows the error in the chat as a system message.

### 3.4 Refactor AgentCoworkerPanel

**File:** `apps/web/components/agent/AgentCoworkerPanel.tsx`

#### Remove
- `useTransition` for message sending (keep `startClearing` for clear conversation)
- `Promise.race` with timeout
- `failOptimisticMessage` on timeout

#### Add
- `const [isBusy, setIsBusy] = useState(false)` — replaces `isPending` for message-related UI
- `fetch('/api/agent/send', { method: 'POST', body: JSON.stringify(input) })` — returns immediately
- SSE `done` handler that:
  1. Applies `formAssistUpdate` if present
  2. Saves `providerInfo` if present
  3. Calls `getOrCreateThreadSnapshot` to fetch the latest messages from DB
  4. Reconciles optimistic message with the real `userMessage` from the snapshot
  5. Appends `agentMessage` and `systemMessage` from the snapshot
  6. Sets `isBusy = false`
- SSE `error` handler that shows the error as a local system message

#### Input disable logic

```typescript
// Before: disabled={isPending || isClearing || !threadId}
// After:  disabled={isBusy || isClearing || !threadId}
```

`isBusy` is a plain `useState` — it does not interact with the Next.js router and does not block navigation.

#### Thinking indicator

```typescript
// Before: driven by isPending
// After:  driven by isBusy
```

Same visual behavior, but the timer and progress text are tied to `isBusy` instead of `useTransition`'s `isPending`.

### 3.5 Message Reconciliation via DB Snapshot

When `done` fires, the client calls `getOrCreateThreadSnapshot` to reload the latest 50 messages from the database. This is the source of truth — it catches:

- The reconciled user message (with real DB id)
- The agent response message
- Any system messages (downgrade warnings, provider errors)

The client diffs against its local optimistic state:

```typescript
function handleDone(event: DoneEvent) {
  // Apply ephemeral data from the done event
  if (event.formAssistUpdate && activeFormAssist) {
    activeFormAssist.applyFieldUpdates(event.formAssistUpdate);
  }
  if (event.providerInfo) {
    setLastProviderInfo(event.providerInfo);
  }
  
  // Refresh messages from DB — authoritative source
  const snapshot = await getOrCreateThreadSnapshot({ routeContext: pathname });
  if (snapshot) {
    setMessages(filterMessages(snapshot.messages));
  }
  
  setIsBusy(false);
}
```

### 3.6 Cancel Support

**New API route:** `POST /api/agent/cancel`

```typescript
// apps/web/app/api/agent/cancel/route.ts
export async function POST(req: Request) {
  const user = await requireAuthUser();
  const { threadId } = await req.json();
  // Verify ownership
  cancelledThreads.add(threadId);
  return NextResponse.json({ ok: true });
}
```

**Cancellation flag:** An in-memory `Set<string>` of cancelled thread IDs, checked by the agentic loop at each iteration boundary. When the loop detects cancellation, it emits `done` and exits early.

**Integration point:** `agentic-loop.ts` already checks duration limits per iteration. Add:

```typescript
if (isCancelled(threadId)) {
  agentEventBus.emit(threadId, { type: "done", error: "Cancelled by user" });
  break;
}
```

**UI:** Show a cancel button in the thinking indicator after 15 seconds:

```tsx
{isBusy && thinkingSeconds >= 15 && (
  <button onClick={handleCancel}>Cancel</button>
)}
```

### 3.7 SSE Reconnection

If the EventSource connection drops (network blip, browser throttling), the client should:

1. Attempt reconnection (EventSource does this automatically)
2. If reconnection fails after 3 attempts, show "Connection lost — waiting for response" instead of "Not sent"
3. On reconnection, if `isBusy` is still true but the server has already emitted `done`, the client calls `getOrCreateThreadSnapshot` to catch up

The SSE endpoint already uses `force-dynamic` and runs on Node.js runtime. No changes needed server-side.

---

## 4. Files Changed

| File | Change | Risk |
|------|--------|------|
| `apps/web/app/api/agent/send/route.ts` | **New** — async submission endpoint with active-thread tracking | Low — new file, no existing code affected |
| `apps/web/app/api/agent/cancel/route.ts` | **New** — cancellation endpoint | Low — new file |
| `apps/web/app/api/agent/status/route.ts` | **New** — thread active-execution probe for re-entrant support | Low — new file |
| `apps/web/lib/tak/agent-event-bus.ts` | Enrich `done` event type, add `error` event, add active-thread tracking + cancellation | Low — additive |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | Replace `useTransition` + `Promise.race` with `fetch` + SSE-driven completion; add thread-switch probe for re-entrant support | **High** — core interaction loop rewritten |
| `apps/web/lib/actions/agent-coworker.ts` | Remove bare `done` emissions (moved to API route, fires after persistence) | Low — two lines removed |
| `apps/web/lib/tak/agentic-loop.ts` | Add cancellation check at iteration boundary | Low — single conditional added |

### Files NOT Changed

- `AgentCoworkerShell.tsx` — panel lifecycle unchanged
- `AgentMessageBubble.tsx` — delivery state rendering unchanged (same states, different triggers)
- `agent-message-state.ts` — optimistic message helpers unchanged
- `AgentMessageInput.tsx` — disabled prop interface unchanged
- `/api/agent/stream/route.ts` — SSE endpoint unchanged (event bus handles new event types automatically)
- Workspace page (`page.tsx`) — server component, no relation to coworker panel blocking

---

## 5. Migration & Backward Compatibility

- The existing `sendMessage` server action is **not deleted** — it continues to work for:
  - Test harness (`agent-coworker-external.test.ts`)
  - Any future use cases that want synchronous semantics
- The `AgentCoworkerPanel` client switches entirely to the new `fetch` + SSE pattern
- No database schema changes required
- No migration needed — messages are already persisted in the same `AgentMessage` table

---

## 6. Edge Cases

### 6.1 User Navigates Away and Returns (Re-Entrant)

The `isBusy` state is per-Panel but the Panel handles multiple threads (one per route). Without explicit handling, `isBusy` would bleed across threads — disabling input on unrelated pages.

**Solution:** Server-side active-thread tracking + client-side probe on thread switch.

- `agentEventBus` tracks `activeThreads: Set<string>` — set when `/api/agent/send` starts, cleared on completion
- `GET /api/agent/status?threadId=X` returns `{ active: boolean }`
- When `threadId` changes (navigation), the Panel resets `isBusy=false` and probes `/api/agent/status`
- If the thread is still active → `isBusy=true` → SSE reconnects → thinking indicator resumes
- If the thread is idle → stays `isBusy=false` → snapshot from DB has the completed response

**Full scenario: /workspace (COO 5min) → /employee (HR task) → /workspace:**

1. User sends on /workspace → `isBusy=true`, `markActive(threadId-A)`, SSE on threadId-A
2. User navigates to /employee → thread-change effect resets `isBusy=false`, probes threadId-B → not active → input enabled
3. User sends on /employee → independent `isBusy=true` on threadId-B
4. Meanwhile threadId-A finishes → `markIdle(threadId-A)`, `done` emitted (nobody listening) → message in DB
5. User returns to /workspace → thread-change effect probes threadId-A → not active → messages load from snapshot including the completed response
6. (Alternative) User returns while COO still running → probe returns `active: true` → `isBusy=true` → SSE resumes → thinking indicator shows → `done` arrives → response appears

### 6.2 User Sends Multiple Messages Rapidly

- Each `POST /api/agent/send` is independent
- The agentic loop processes one message at a time per thread (DB-level ordering)
- Second message queues behind the first in the server action
- Client shows both optimistic messages with "Sending..." state
- SSE events arrive for each in sequence

### 6.3 Proposal Flow (Approval Cards)

- Proposals are currently returned in the `sendMessage` response and rendered as approval cards
- In the async model: proposals are persisted to DB by the agent execution, and the `done` event carries the proposal metadata
- The DB snapshot refresh picks up the proposal-bearing message
- `handleApprove` follow-up messages use the same `fetch` path

### 6.4 formAssistUpdate Timing

- Currently applied immediately when `sendMessage` returns
- In async model: applied when `done` fires via SSE
- Slight delay (< 1s after agent completes) — acceptable since user is watching the thinking indicator
- If user has already submitted the form before `done` arrives, the update is silently dropped (same as current behavior when timeout fires)

### 6.5 Server Crash During Execution

- Background promise dies with the process
- SSE stream also dies (EventSource `onerror` fires)
- Client shows "Connection lost" after reconnection fails
- User message is already persisted in DB (persisted before ack)
- On page refresh, user sees their message but no response — they can retry

---

## 7. Acceptance Criteria

1. **No navigation blocking:** User can click sidebar links, workspace tiles, and browser back/forward while the coworker is processing a message
2. **No false "Not sent":** Message delivery state shows "Sending..." until the agent completes, then transitions to "Sent" — never "Not sent" for a message that is actively being processed
3. **Accurate progress:** SSE-driven thinking indicator shows tool usage and orchestrator status as today, but without contradicting the delivery state
4. **Cancel support:** After 15 seconds, a cancel button appears that stops the agent within one iteration
5. **Resilient to navigation:** If user navigates away and returns, the agent response is visible in chat (loaded from DB)
6. **formAssistUpdate applied:** Form field auto-fill works via the enriched `done` event
7. **Proposal cards render:** Approval/reject cards appear after async completion, same as today
8. **No duplicate messages:** Retry button only appears for genuinely failed sends (network error on the initial `POST /api/agent/send`), not for slow execution

---

## 8. Implementation Order

| Phase | Tasks | Estimated Scope |
|-------|-------|-----------------|
| **Phase 1: Core async path** | New API route, extract `persistUserMessage`, background execution, enriched `done` event | ~200 lines new, ~100 lines refactored |
| **Phase 2: Panel refactor** | Replace `useTransition` with `fetch` + SSE `done` handler, `isBusy` state, DB snapshot reconciliation | ~150 lines changed in AgentCoworkerPanel |
| **Phase 3: Cancel support** | Cancel API route, cancellation flag in agentic loop + orchestrator, cancel button in UI | ~80 lines new |
| **Phase 4: Resilience** | SSE reconnection handling, "connection lost" state, page-return snapshot refresh | ~50 lines new |

Phases 1-2 are the critical fix. Phases 3-4 are quality-of-life improvements that can follow immediately or in a subsequent session.

---

## 9. Relationship to EP-ASYNC-001

This spec implements **Layer 1 (in-panel)** from the earlier EP-ASYNC-001 design notes, but with a fundamentally different approach:

- EP-ASYNC-001 assumed the panel interaction stays synchronous and adds notification layers on top
- This spec makes the panel interaction **natively asynchronous** — fixing the root cause rather than papering over it
- EP-ASYNC-001 Layers 2 (cross-page banner) and 3 (FAB badge + workspace dashboard) remain future work that builds naturally on this foundation — the `done` event and DB-persisted messages provide all the hooks needed
