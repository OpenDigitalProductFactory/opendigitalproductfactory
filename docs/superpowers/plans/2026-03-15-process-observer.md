# EP-PROCESS-001: Process Improvement AI Observer — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A silent observer that detects friction, failures, and improvement opportunities in agent conversations and automatically files backlog items with correct product/owner accountability.

**Architecture:** Deterministic signal detection rules in a pure function (`analyzeConversation`), triage/routing/dedup in a separate module (`triageAndFile`), async fire-and-forget hook in `sendMessage`. Configurable observation mode per product (realtime/sampled/batch). Uses existing `BacklogItem` model with new `source`, `occurrenceCount`, `lastSeenAt` fields.

**Tech Stack:** TypeScript, Prisma 5, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-03-15-process-observer-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/process-observer.ts` | `analyzeConversation()` — signal detection rules |
| `apps/web/lib/process-observer.test.ts` | Tests for signal detection |
| `apps/web/lib/process-observer-triage.ts` | `triageAndFile()` — route, deduplicate, file backlog items |
| `apps/web/lib/process-observer-triage.test.ts` | Tests for triage routing and dedup |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `source`, `occurrenceCount`, `lastSeenAt` to `BacklogItem`; add `observationConfig` to `DigitalProduct` |
| `apps/web/lib/actions/agent-coworker.ts` | Add async observer hook after `sendMessage` |

---

## Chunk 1: Schema + Types

### Task 1: Schema Migration

**Files:** `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add fields to BacklogItem**

Find the `BacklogItem` model. Add after `epicId`:

```prisma
  source          String?   // "manual" | "ai_assisted" | "process_observer" | "build_studio"
  occurrenceCount Int       @default(1)
  lastSeenAt      DateTime?
```

- [ ] **Step 2: Add observationConfig to DigitalProduct**

Find the `DigitalProduct` model. Add after `version`:

```prisma
  observationConfig Json?   // { mode, sampleRate, batchSchedule, enabled }
```

- [ ] **Step 3: Create and apply migration**

```bash
mkdir -p packages/db/prisma/migrations/20260315220000_add_observer_fields
cat > packages/db/prisma/migrations/20260315220000_add_observer_fields/migration.sql << 'SQLEOF'
-- AlterTable BacklogItem
ALTER TABLE "BacklogItem" ADD COLUMN "source" TEXT;
ALTER TABLE "BacklogItem" ADD COLUMN "occurrenceCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "BacklogItem" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

-- AlterTable DigitalProduct
ALTER TABLE "DigitalProduct" ADD COLUMN "observationConfig" JSONB;
SQLEOF
cd packages/db && npx prisma migrate deploy && npx prisma generate
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/
git commit -m "feat(schema): add observer fields to BacklogItem and DigitalProduct"
```

---

## Chunk 2: Conversation Analyzer (TDD)

### Task 2: Signal Detection Rules

**Files:**
- Create: `apps/web/lib/process-observer.ts`
- Create: `apps/web/lib/process-observer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/process-observer.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { analyzeConversation, type ConversationMessage, type ObservationFinding } from "./process-observer";

const msg = (role: "user" | "assistant" | "system", content: string, id = "m1"): ConversationMessage => ({
  id, role, content, agentId: "build-specialist", routeContext: "/build",
});

describe("analyzeConversation", () => {
  it("detects tool failure in system messages", () => {
    const messages = [
      msg("user", "help me build something"),
      msg("system", "Tool update_feature_brief failed: Build not found"),
    ];
    const findings = analyzeConversation(messages);
    expect(findings.some((f) => f.type === "tool_failure")).toBe(true);
  });

  it("detects canned response (no provider)", () => {
    const messages = [
      msg("user", "hello"),
      msg("system", "AI providers are currently unavailable. Showing a pre-configured response."),
      msg("assistant", "Welcome to the Build Studio!"),
    ];
    const findings = analyzeConversation(messages);
    expect(findings.some((f) => f.type === "config_gap")).toBe(true);
  });

  it("detects agent reasoning dump", () => {
    const longReasoning = "We need to handle the user's request. The user first gave details. We have data needs. But the instructions say we should not ask for internal IDs. So we assume buildId is known but not shown. We can still use a placeholder.";
    const messages = [
      msg("user", "what next?"),
      msg("assistant", longReasoning),
    ];
    const findings = analyzeConversation(messages);
    expect(findings.some((f) => f.type === "agent_quality")).toBe(true);
  });

  it("detects user repeating themselves", () => {
    const messages = [
      msg("user", "what do I do next?", "m1"),
      msg("assistant", "Let me check.", "m2"),
      msg("user", "what do I do next?", "m3"),
    ];
    const findings = analyzeConversation(messages);
    expect(findings.some((f) => f.type === "user_friction")).toBe(true);
  });

  it("detects user asking what's next", () => {
    const messages = [
      msg("user", "ok, what is next?"),
    ];
    const findings = analyzeConversation(messages);
    expect(findings.some((f) => f.type === "user_friction")).toBe(true);
  });

  it("detects external access not configured", () => {
    const messages = [
      msg("system", "Web Search (Brave) is not configured. An admin needs to configure the Brave Search API key"),
    ];
    const findings = analyzeConversation(messages);
    expect(findings.some((f) => f.type === "config_gap")).toBe(true);
  });

  it("detects provider downgrade", () => {
    const messages = [
      msg("system", "OpenAI hit its usage quota and has been temporarily disabled. It will be re-enabled in about 1 hour."),
    ];
    const findings = analyzeConversation(messages);
    expect(findings.some((f) => f.type === "tool_failure")).toBe(true);
  });

  it("returns empty for clean conversation", () => {
    const messages = [
      msg("user", "I want to build a contact form"),
      msg("assistant", "What fields do you need?"),
      msg("user", "Name, email, and message"),
      msg("assistant", "Got it. Simple form with 3 fields."),
    ];
    const findings = analyzeConversation(messages);
    expect(findings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/process-observer.test.ts
```

- [ ] **Step 3: Implement process-observer.ts**

Create `apps/web/lib/process-observer.ts`:

```typescript
// apps/web/lib/process-observer.ts
// Deterministic signal detection for conversation quality.

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentId: string | null;
  routeContext: string | null;
};

export type ObservationFinding = {
  type: "tool_failure" | "agent_quality" | "user_friction" | "missing_capability" | "config_gap";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  rootCause: string | null;
  sentiment: "positive" | "neutral" | "frustrated" | "confused";
  sourceMessageIds: string[];
  suggestedAction: string;
};

// ─── Detection Rules ──────────────────────────────────────────────────────────

const REASONING_PATTERNS = [
  /\bwe need to\b/i,
  /\bthe instruction says\b/i,
  /\bthe user (?:didn't|hasn't|first gave)\b/i,
  /\bbut we (?:can't|cannot|should|must)\b/i,
  /\bwe (?:assume|can still|don't have)\b/i,
  /\blet's (?:just |do |use |choose )/i,
  /\bwe can(?:not|'t)? (?:ask|proceed|include)\b/i,
];

const WHATS_NEXT_PATTERNS = [
  /\bwhat(?:'s| is) next\b/i,
  /\bwhat do i do\b/i,
  /\bwhat should i do\b/i,
  /\bnow what\b/i,
];

function detectToolFailures(messages: ConversationMessage[]): ObservationFinding[] {
  const findings: ObservationFinding[] = [];
  for (const m of messages) {
    if (m.role !== "system") continue;
    if (/\bfailed\b/i.test(m.content) && /\btool\b|update_feature_brief|register_digital|create_build/i.test(m.content)) {
      findings.push({
        type: "tool_failure",
        severity: "high",
        title: "MCP tool execution failed",
        description: m.content.slice(0, 200),
        rootCause: null,
        sentiment: "neutral",
        sourceMessageIds: [m.id],
        suggestedAction: "Investigate tool failure and add error handling or fix the underlying issue.",
      });
    }
    if (/quota.*disabled|temporarily disabled/i.test(m.content)) {
      findings.push({
        type: "tool_failure",
        severity: "medium",
        title: "Provider quota hit during conversation",
        description: m.content.slice(0, 200),
        rootCause: "AI provider usage quota exceeded",
        sentiment: "neutral",
        sourceMessageIds: [m.id],
        suggestedAction: "Review provider quota limits and consider adding backup providers.",
      });
    }
  }
  return findings;
}

function detectConfigGaps(messages: ConversationMessage[]): ObservationFinding[] {
  const findings: ObservationFinding[] = [];
  for (const m of messages) {
    if (m.role !== "system") continue;
    if (/not configured|unavailable.*pre-configured/i.test(m.content)) {
      findings.push({
        type: "config_gap",
        severity: "high",
        title: "Service not configured — agent fell back to canned response",
        description: m.content.slice(0, 200),
        rootCause: "Required service API key or provider not configured",
        sentiment: "neutral",
        sourceMessageIds: [m.id],
        suggestedAction: "Configure the missing service in Platform > Admin or AI Providers.",
      });
    }
  }
  return findings;
}

function detectAgentQuality(messages: ConversationMessage[]): ObservationFinding[] {
  const findings: ObservationFinding[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    if (m.content.length < 200) continue;

    const reasoningMatches = REASONING_PATTERNS.filter((p) => p.test(m.content));
    if (reasoningMatches.length >= 2) {
      findings.push({
        type: "agent_quality",
        severity: "medium",
        title: "Agent dumped internal reasoning to user",
        description: `Agent response contained ${reasoningMatches.length} reasoning patterns in ${m.content.length} chars.`,
        rootCause: "LLM not following system prompt discipline — may need a more capable model",
        sentiment: "confused",
        sourceMessageIds: [m.id],
        suggestedAction: "Review model qualification for this agent. Consider routing to a model with better instruction-following.",
      });
    }
  }
  return findings;
}

function detectUserFriction(messages: ConversationMessage[]): ObservationFinding[] {
  const findings: ObservationFinding[] = [];
  const userMessages = messages.filter((m) => m.role === "user");

  // Detect "what's next?" — user shouldn't have to ask
  for (const m of userMessages) {
    if (WHATS_NEXT_PATTERNS.some((p) => p.test(m.content))) {
      findings.push({
        type: "user_friction",
        severity: "medium",
        title: "User had to ask what to do next",
        description: "The agent should proactively lead the user to the next step.",
        rootCause: "Agent prompt does not instruct proactive next-step guidance",
        sentiment: "confused",
        sourceMessageIds: [m.id],
        suggestedAction: "Update agent prompt to always end with a clear next action or question.",
      });
    }
  }

  // Detect repeated questions
  for (let i = 1; i < userMessages.length; i++) {
    const prev = userMessages[i - 1]!.content.toLowerCase().trim();
    const curr = userMessages[i]!.content.toLowerCase().trim();
    if (prev.length > 10 && curr.length > 10 && (prev === curr || prev.includes(curr) || curr.includes(prev))) {
      findings.push({
        type: "user_friction",
        severity: "medium",
        title: "User repeated themselves",
        description: "User sent a similar message twice — the agent may not have addressed their question.",
        rootCause: "Agent response did not resolve the user's question",
        sentiment: "frustrated",
        sourceMessageIds: [userMessages[i - 1]!.id, userMessages[i]!.id],
        suggestedAction: "Review conversation flow — agent may need better context retention or clearer responses.",
      });
      break; // One finding per conversation for repeated questions
    }
  }

  return findings;
}

// ─── Main Analyzer ────────────────────────────────────────────────────────────

export function analyzeConversation(messages: ConversationMessage[]): ObservationFinding[] {
  return [
    ...detectToolFailures(messages),
    ...detectConfigGaps(messages),
    ...detectAgentQuality(messages),
    ...detectUserFriction(messages),
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/process-observer.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/process-observer.ts apps/web/lib/process-observer.test.ts
git commit -m "feat: conversation analyzer with deterministic signal detection rules"
```

---

## Chunk 3: Triage + Backlog Filing (TDD)

### Task 3: Triage and File

**Files:**
- Create: `apps/web/lib/process-observer-triage.ts`
- Create: `apps/web/lib/process-observer-triage.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/process-observer-triage.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  resolveBacklogTarget,
  buildBacklogItemData,
  severityToPriority,
  isDuplicate,
} from "./process-observer-triage";
import type { ObservationFinding } from "./process-observer";

const finding: ObservationFinding = {
  type: "tool_failure",
  severity: "high",
  title: "MCP tool execution failed",
  description: "Tool update_feature_brief failed",
  rootCause: null,
  sentiment: "neutral",
  sourceMessageIds: ["m1"],
  suggestedAction: "Fix the tool",
};

describe("severityToPriority", () => {
  it("maps critical to 1", () => expect(severityToPriority("critical")).toBe(1));
  it("maps high to 2", () => expect(severityToPriority("high")).toBe(2));
  it("maps medium to 3", () => expect(severityToPriority("medium")).toBe(3));
  it("maps low to 4", () => expect(severityToPriority("low")).toBe(4));
});

describe("resolveBacklogTarget", () => {
  it("returns product context when available", () => {
    const result = resolveBacklogTarget({ digitalProductId: "prod-1", routeContext: "/build" });
    expect(result.digitalProductId).toBe("prod-1");
  });
  it("returns null product for unknown routes", () => {
    const result = resolveBacklogTarget({ digitalProductId: null, routeContext: "/unknown" });
    expect(result.digitalProductId).toBeNull();
  });
});

describe("buildBacklogItemData", () => {
  it("creates a backlog item with observer source", () => {
    const data = buildBacklogItemData(finding, "thread-1", "prod-1");
    expect(data.source).toBe("process_observer");
    expect(data.title).toBe("MCP tool execution failed");
    expect(data.itemId).toMatch(/^BI-OBS-/);
    expect(data.priority).toBe(2);
  });
});

describe("isDuplicate", () => {
  it("matches exact title", () => {
    expect(isDuplicate("MCP tool execution failed", ["MCP tool execution failed"])).toBe(true);
  });
  it("matches substring", () => {
    expect(isDuplicate("MCP tool execution failed", ["MCP tool execution failed in conversation"])).toBe(true);
  });
  it("rejects unrelated titles", () => {
    expect(isDuplicate("MCP tool execution failed", ["Provider quota exceeded"])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/process-observer-triage.test.ts
```

- [ ] **Step 3: Implement process-observer-triage.ts**

Create `apps/web/lib/process-observer-triage.ts`:

```typescript
import * as crypto from "crypto";
import { prisma } from "@dpf/db";
import type { ObservationFinding } from "./process-observer";

// ─── Pure Helpers ─────────────────────────────────────────────────────────────

export function severityToPriority(severity: string): number {
  const map: Record<string, number> = { critical: 1, high: 2, medium: 3, low: 4 };
  return map[severity] ?? 3;
}

export function resolveBacklogTarget(context: {
  digitalProductId: string | null;
  routeContext: string | null;
}): { digitalProductId: string | null } {
  if (context.digitalProductId) return { digitalProductId: context.digitalProductId };
  return { digitalProductId: null };
}

export function buildBacklogItemData(
  finding: ObservationFinding,
  threadId: string,
  digitalProductId: string | null,
) {
  return {
    itemId: `BI-OBS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    title: finding.title,
    type: "product" as const,
    status: "open" as const,
    source: "process_observer" as const,
    priority: severityToPriority(finding.severity),
    body: [
      `**Detected by:** Process Observer`,
      `**Severity:** ${finding.severity}`,
      `**Type:** ${finding.type}`,
      finding.rootCause ? `**Root cause:** ${finding.rootCause}` : null,
      `**Suggested action:** ${finding.suggestedAction}`,
      `**Sentiment:** ${finding.sentiment}`,
      `**Source thread:** ${threadId}`,
      `**Description:** ${finding.description}`,
    ].filter(Boolean).join("\n"),
    digitalProductId,
  };
}

export function isDuplicate(title: string, existingTitles: string[]): boolean {
  const lower = title.toLowerCase();
  return existingTitles.some((t) => {
    const tLower = t.toLowerCase();
    return tLower === lower || tLower.includes(lower) || lower.includes(tLower);
  });
}

// ─── Triage + File ────────────────────────────────────────────────────────────

export async function triageAndFile(
  findings: ObservationFinding[],
  threadId: string,
  context: { digitalProductId: string | null; routeContext: string | null },
): Promise<{ filed: number; deduplicated: number }> {
  if (findings.length === 0) return { filed: 0, deduplicated: 0 };

  const target = resolveBacklogTarget(context);

  // Get existing observer items for dedup
  const existingItems = await prisma.backlogItem.findMany({
    where: { source: "process_observer", status: { in: ["open", "in-progress"] } },
    select: { id: true, title: true, occurrenceCount: true },
  });
  const existingTitles = existingItems.map((i) => i.title);

  let filed = 0;
  let deduplicated = 0;

  for (const finding of findings) {
    if (isDuplicate(finding.title, existingTitles)) {
      // Increment occurrence count on the existing item
      const match = existingItems.find((i) =>
        i.title.toLowerCase().includes(finding.title.toLowerCase()) ||
        finding.title.toLowerCase().includes(i.title.toLowerCase()),
      );
      if (match) {
        await prisma.backlogItem.update({
          where: { id: match.id },
          data: {
            occurrenceCount: match.occurrenceCount + 1,
            lastSeenAt: new Date(),
          },
        });
        deduplicated++;
      }
      continue;
    }

    const data = buildBacklogItemData(finding, threadId, target.digitalProductId);
    await prisma.backlogItem.create({
      data: {
        itemId: data.itemId,
        title: data.title,
        type: data.type,
        status: data.status,
        source: data.source,
        priority: data.priority,
        body: data.body,
        lastSeenAt: new Date(),
        ...(data.digitalProductId ? { digitalProductId: data.digitalProductId } : {}),
      },
    });
    filed++;
  }

  return { filed, deduplicated };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/process-observer-triage.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/process-observer-triage.ts apps/web/lib/process-observer-triage.test.ts
git commit -m "feat: observer triage — route findings to correct backlog with dedup"
```

---

## Chunk 4: Hook into sendMessage + Configuration

### Task 4: Wire Observer into sendMessage

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts`

- [ ] **Step 1: Add the async observer call**

At the very end of the `sendMessage` function (just before the final `return` statement that returns `userMessage` + `agentMessage`), add:

```typescript
  // Fire-and-forget: process observer analyzes this conversation
  observeConversation(input.threadId, input.routeContext).catch((err) =>
    console.error("[process-observer]", err),
  );
```

Add this import at the top of the file:

```typescript
import { observeConversation } from "@/lib/process-observer-hook";
```

- [ ] **Step 2: Create the observer hook**

Create `apps/web/lib/process-observer-hook.ts`:

```typescript
import { prisma } from "@dpf/db";
import { analyzeConversation, type ConversationMessage } from "./process-observer";
import { triageAndFile } from "./process-observer-triage";

// Default observation config
const DEFAULT_MODE = "sampled";
const DEFAULT_SAMPLE_RATE = 5;

// Simple counter per thread (in-memory, resets on server restart — good enough for sampling)
const threadCounter = new Map<string, number>();

export async function observeConversation(
  threadId: string,
  routeContext: string,
): Promise<void> {
  // Determine observation mode
  const mode = routeContext.startsWith("/build") ? "realtime" : DEFAULT_MODE;

  if (mode === "sampled") {
    const count = (threadCounter.get(threadId) ?? 0) + 1;
    threadCounter.set(threadId, count);
    if (count % DEFAULT_SAMPLE_RATE !== 0) return; // Skip this conversation
  }

  // Fetch recent messages for analysis
  const messages = await prisma.agentMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, role: true, content: true, agentId: true, routeContext: true },
  });

  const transcript: ConversationMessage[] = messages.reverse().map((m) => ({
    id: m.id,
    role: m.role as ConversationMessage["role"],
    content: m.content,
    agentId: m.agentId,
    routeContext: m.routeContext,
  }));

  const findings = analyzeConversation(transcript);
  if (findings.length === 0) return;

  // Resolve product context from build if on /build route
  let digitalProductId: string | null = null;
  if (routeContext.startsWith("/build")) {
    const thread = await prisma.agentThread.findUnique({
      where: { id: threadId },
      select: { userId: true },
    });
    if (thread) {
      const build = await prisma.featureBuild.findFirst({
        where: { createdById: thread.userId, phase: { notIn: ["complete", "failed"] } },
        orderBy: { updatedAt: "desc" },
        select: { digitalProductId: true },
      });
      digitalProductId = build?.digitalProductId ?? null;
    }
  }

  await triageAndFile(findings, threadId, { digitalProductId, routeContext });
}
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 4: Run all tests**

```bash
cd apps/web && npx vitest run lib/process-observer.test.ts lib/process-observer-triage.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/process-observer-hook.ts apps/web/lib/actions/agent-coworker.ts
git commit -m "feat: wire process observer into sendMessage — async fire-and-forget"
```

---

### Task 5: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

- [ ] **Step 2: Smoke test**

1. Go to `/build`, create a feature, send a message
2. If the agent gives a canned response or reasoning dump, check `/ops` — an observer backlog item should appear with `source: "process_observer"`
3. Trigger the same issue again — the existing item's `occurrenceCount` should increment (not a duplicate)

- [ ] **Step 3: Final commit**

```bash
git add -A && git commit -m "chore: final adjustments for EP-PROCESS-001"
```
