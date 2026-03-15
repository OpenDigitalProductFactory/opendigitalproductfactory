# EP-PROCESS-001: Process Improvement AI Observer — Design Spec

**Date:** 2026-03-15
**Goal:** A silent AI observer that watches all human/agent conversations, detects friction, failures, and improvement opportunities, then automatically files backlog items in the correct product backlog with proper accountability. Core MVP capability for iterative platform improvement.

**Target user:** No direct user — the observer runs invisibly. Its output is backlog items visible to portfolio owners on `/ops`.

---

## 1. Conversation Analyzer

A pure function that takes a conversation transcript and produces findings:

```typescript
type ObservationFinding = {
  type: "tool_failure" | "agent_quality" | "user_friction" | "missing_capability" | "config_gap";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  rootCause: string | null;
  sentiment: "positive" | "neutral" | "frustrated" | "confused";
  sourceMessageIds: string[];
  suggestedAction: string;
};
```

**Signal detection rules (deterministic, no LLM needed):**

| Signal | Detection | Severity |
|--------|-----------|----------|
| Tool returned `success: false` | Check tool result in message | high |
| Canned response served | Content matches `CANNED_RESPONSES` patterns | high |
| Provider downgrade/disable system message | System role + content pattern | medium |
| Agent reasoning dump (> 500 chars with "We need to...", "The instruction says...") | Content regex | medium |
| User repeats a question | Compare consecutive user messages (substring match) | medium |
| User asks "what do I do next?" / "what's next?" | Content pattern match | medium |
| External Access on but tool fails with "not configured" | Error message pattern | high |
| Provider active but not in priority list | Cross-reference DB state | medium |

**Sentiment analysis** — uses a cheap LLM call ONLY when friction signals are detected (not on every message). Detects tone shift from engaged to frustrated within a 3-message window.

**Root cause inference** — when friction is detected, the analyzer checks: is this a missing capability (no tool exists), a configuration gap (tool exists but not configured), an agent quality issue (tool works but agent misuses it), or a UX gap (user doesn't know how to proceed)?

---

## 2. Observation Trigger + Configuration

Three modes, configurable per digital product or per route:

| Mode | When it runs | Best for |
|------|-------------|----------|
| `realtime` | After every `sendMessage` call (async, no latency) | New features, active development |
| `sampled` | Every Nth conversation (configurable) | Maturing features |
| `batch` | Scheduled job, hourly or daily | Stable features, trend analysis |

**Configuration:**

```typescript
type ObservationConfig = {
  mode: "realtime" | "sampled" | "batch";
  sampleRate?: number;           // for sampled: 1 in N conversations
  batchSchedule?: string;        // for batch: "hourly" | "daily"
  enabled: boolean;
};
```

**Defaults:**
- `/build` route: `realtime` (new features being designed)
- All other routes: `sampled` at 1-in-5
- Admin can override per product

**Hook points:**
- `realtime` + `sampled`: fire-and-forget async call at the end of `sendMessage`, after response is persisted. Does NOT add latency.
- `batch`: `ScheduledJob` (`process-observer-batch`) queries conversations updated since last run.

---

## 3. Auto-Triage + Backlog Filing

**Routing logic (determines which backlog):**
1. Conversation has linked `FeatureBuild` → file against that build's `DigitalProduct`
2. No build → map route to portfolio owner (e.g., `/platform` → HR-000/200/300)
3. Platform-wide issue (provider failure, missing config) → DPF Portal product under EP-REFACTOR-001
4. Can't determine product → catch-all "Platform Observations" with no product link

**Deduplication:**
Before creating an item, search open items with `source: "process_observer"` for similar titles. If match exists, increment `occurrenceCount` and update `lastSeenAt` instead of creating a duplicate. Recurring issues bubble up in priority naturally.

**Backlog item shape:**
```
itemId: "BI-OBS-{uuid}"
title: finding.title
type: "product"
status: "open"
source: "process_observer"
body: "Detected by: Process Observer\nSeverity: {severity}\nRoot cause: {rootCause}\nSuggested action: {suggestedAction}\nSentiment: {sentiment}\nSource conversation: {threadId}"
priority: severity mapped (critical=1, high=2, medium=3, low=4)
digitalProductId: resolved from context
```

**Accountability:**
The portfolio owner role for the digital product (already defined via `Portfolio.ownerRoleId`) is accountable. Items appear on `/ops` alongside manual items. Filter by `source: "process_observer"` to see all AI-detected issues.

**Observable metrics (queryable from existing BacklogItem):**
- Count of observer-filed items by product, severity, week
- Mean time from detection to resolution
- Recurring issues (items with high `occurrenceCount`)
- Improvement velocity: observer items resolved per sprint

---

## 4. Schema Changes

### BacklogItem — add observer fields

```prisma
  source          String?   // "manual" | "ai_assisted" | "process_observer" | "build_studio"
  occurrenceCount Int       @default(1)
  lastSeenAt      DateTime?
```

### DigitalProduct — add observation config

```prisma
  observationConfig Json?   // ObservationConfig structure
```

No new models. Uses existing `BacklogItem`, `Epic`, `DigitalProduct`, `PlatformConfig`, `ScheduledJob`.

---

## 5. Files Affected

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/process-observer.ts` | `analyzeConversation()` — deterministic signal detection rules |
| `apps/web/lib/process-observer.test.ts` | Tests for each signal detection rule |
| `apps/web/lib/process-observer-triage.ts` | `triageAndFile()` — route to correct backlog, deduplicate, file |
| `apps/web/lib/process-observer-triage.test.ts` | Tests for routing, dedup, priority mapping |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `source`, `occurrenceCount`, `lastSeenAt` to `BacklogItem`; add `observationConfig` to `DigitalProduct` |
| `apps/web/lib/actions/agent-coworker.ts` | Add async fire-and-forget observer call after `sendMessage` response |
| `apps/web/lib/agent-coworker-data.ts` | Export `getConversationTranscript()` for batch mode |

---

## 6. Testing Strategy

- **Unit tests for signal detection**: one test per rule — tool failure, canned response, reasoning dump regex, repeated question, config gap, sentiment pattern
- **Unit tests for triage**: product routing from build context, portfolio fallback, dedup logic, priority mapping, occurrence counting
- **Integration test**: mock conversation with known friction → verify correct backlog item in correct product backlog with correct owner context

---

## 7. Not in Scope

- **Observer dashboard** — findings surface through existing `/ops` backlog, no new UI
- **Real-time user notification** — observer files items silently, doesn't interrupt the conversation
- **Cross-conversation pattern analysis** — batch mode reviews individual conversations, not patterns across users (deferred to EP-DEDUP-001)
- **Automated fix application** — observer suggests actions, humans execute them
- **Custom detection rules** — fixed rule set in v1, extensible later
