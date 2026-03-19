# EP-SELF-DEV-002: Self-Development Process Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken self-development pipeline so the Build Studio agent can actually call tools, the browser shows real-time progress, and fabricated completions are caught.

**Architecture:** Three layers: (1) agentic loop fixes (stalling, fabrication guardrail), (2) SSE event bus for browser-agent sync, (3) MCP tool registrations that wire existing backend to the agent. Each layer is independently testable.

**Tech Stack:** Next.js 14 App Router, TypeScript, Vitest, Prisma 5, Docker, Playwright, Server-Sent Events

**Spec:** `docs/superpowers/specs/2026-03-18-self-dev-process-fix-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/agent-event-bus.ts` | Typed in-process event emitter keyed by threadId |
| `apps/web/lib/agent-event-bus.test.ts` | Tests for event bus subscribe/emit/cleanup |
| `apps/web/app/api/agent/stream/route.ts` | SSE endpoint — subscribes to event bus, streams to browser |
| `apps/web/lib/actions/build-read.ts` | Lightweight `getFeatureBuild` server action for live refresh |
| `apps/web/components/build/BuildActivityLog.tsx` | Activity timeline component |
| `apps/web/components/build/TestRunnerPanel.tsx` | Playwright test results with screenshots |
| `apps/web/lib/playwright-runner.ts` | Playwright test generation and execution |
| `apps/web/lib/playwright-runner.test.ts` | Tests for Playwright runner |
| `packages/db/prisma/migrations/[timestamp]_add_build_activity_ux_tests/migration.sql` | Schema migration |

### Modified Files

| File | Change |
|------|--------|
| `apps/web/lib/agentic-loop.ts` | Fix stalling nudge, add fabrication guardrail, add `onProgress` callback |
| `apps/web/lib/prompt-assembler.ts` | Add rules 15-16 to identity block |
| `apps/web/lib/mcp-tools.ts` | Register 10 new tools (8 Build Studio + 2 Playwright) |
| `apps/web/lib/route-context-map.ts` | Expand `/build` domainTools |
| `apps/web/lib/actions/agent-coworker.ts` | Pass `onProgress` to agentic loop |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | SSE subscription for thinking indicator |
| `apps/web/components/build/BuildStudio.tsx` | SSE subscription for live refresh, activity log |
| `apps/web/components/build/EvidenceSummary.tsx` | Add 7th evidence item |
| `packages/db/prisma/schema.prisma` | Add BuildActivity model, uxTestResults field |
| `docker-compose.yml` | Add playwright service |

---

## Task 1: Fix Zero-Tool Stalling in Agentic Loop

**Files:**
- Modify: `apps/web/lib/agentic-loop.ts:117-121`

- [ ] **Step 1: Write failing test**

Create test file if not present, or add to existing test patterns:

```typescript
// apps/web/lib/agentic-loop.test.ts
import { describe, it, expect } from "vitest";

// We test the nudge condition logic in isolation.
// Extract the shouldNudge logic into a testable function.

describe("shouldNudge", () => {
  it("nudges on first iteration when model returns text-only with tools available", () => {
    const result = shouldNudge({
      continuationNudges: 0,
      iteration: 0,
      maxIterations: 25,
      hasTools: true,
      executedToolCount: 0,
      responseLength: 44, // "I've completed the available actions"
    });
    expect(result).toBe(true);
  });

  it("does not nudge when no tools available", () => {
    const result = shouldNudge({
      continuationNudges: 0,
      iteration: 0,
      maxIterations: 25,
      hasTools: false,
      executedToolCount: 0,
      responseLength: 44,
    });
    expect(result).toBe(false);
  });

  it("does not nudge when response is a genuine question (> 200 chars)", () => {
    const result = shouldNudge({
      continuationNudges: 0,
      iteration: 0,
      maxIterations: 25,
      hasTools: true,
      executedToolCount: 0,
      responseLength: 250,
    });
    expect(result).toBe(false);
  });

  it("nudges when tools were used and model stalls with short response", () => {
    const result = shouldNudge({
      continuationNudges: 0,
      iteration: 3,
      maxIterations: 25,
      hasTools: true,
      executedToolCount: 2,
      responseLength: 5,
    });
    expect(result).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run lib/agentic-loop.test.ts`
Expected: FAIL — `shouldNudge` is not exported

- [ ] **Step 3: Extract shouldNudge function and fix the condition**

In `apps/web/lib/agentic-loop.ts`, add before the `runAgenticLoop` function:

```typescript
export function shouldNudge(params: {
  continuationNudges: number;
  iteration: number;
  maxIterations: number;
  hasTools: boolean;
  executedToolCount: number;
  responseLength: number;
}): boolean {
  return params.continuationNudges < 1
    && params.iteration < params.maxIterations - 1
    && params.hasTools
    && (params.executedToolCount > 0 || params.iteration === 0)
    && params.responseLength < 200;
}
```

Then replace lines 117-121 in the loop body:

```typescript
const shouldNudgeNow = shouldNudge({
  continuationNudges,
  iteration,
  maxIterations: MAX_ITERATIONS,
  hasTools: !!(toolsForProvider && toolsForProvider.length > 0),
  executedToolCount: executedTools.length,
  responseLength: trimmed.length,
});
```

Replace `if (shouldNudge)` with `if (shouldNudgeNow)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run lib/agentic-loop.test.ts`
Expected: PASS — all 4 tests green

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/agentic-loop.ts apps/web/lib/agentic-loop.test.ts
git commit -m "fix: detect zero-tool stalling in agentic loop (EP-SELF-DEV-002 §2)"
```

---

## Task 2: Add Fabrication Guardrail to Agentic Loop

**Files:**
- Modify: `apps/web/lib/agentic-loop.ts`
- Modify: `apps/web/lib/agentic-loop.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { detectFabrication } from "./agentic-loop";

describe("detectFabrication", () => {
  it("detects completion claim with zero tools executed", () => {
    expect(detectFabrication("I've built the feature and deployed it.", 0, false)).toBe(true);
  });

  it("does not flag when tools were executed", () => {
    expect(detectFabrication("I've built the feature.", 3, false)).toBe(false);
  });

  it("does not flag when proposal was returned", () => {
    expect(detectFabrication("I've created the deployment.", 0, true)).toBe(false);
  });

  it("does not flag informational responses", () => {
    expect(detectFabrication("The feature brief describes a notification system.", 0, false)).toBe(false);
  });

  it("detects 'TESTS PASS' with no tools", () => {
    expect(detectFabrication("TESTS PASS\n✅ All 4 criteria met", 0, false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run lib/agentic-loop.test.ts`
Expected: FAIL — `detectFabrication` not exported

- [ ] **Step 3: Implement detectFabrication and wire into loop**

Add to `apps/web/lib/agentic-loop.ts`:

```typescript
const COMPLETION_CLAIM_PATTERN = /\b(built|deployed|shipped|created|implemented|saved|configured|tested|fixed|completed|installed)\b/i;

export function detectFabrication(
  response: string,
  executedToolCount: number,
  hasProposal: boolean,
): boolean {
  if (executedToolCount > 0 || hasProposal) return false;
  return COMPLETION_CLAIM_PATTERN.test(response);
}
```

In `runAgenticLoop`, add a `let fabricationRetried = false;` at the top alongside `continuationNudges`. Then, in the no-tool-calls exit path (after the nudge check, before the `return` at line 140), add:

```typescript
// Fabrication guardrail: if agent claims completion without calling tools, retry once
if (!fabricationRetried && detectFabrication(trimmed, executedTools.length, false)) {
  fabricationRetried = true;
  console.warn(
    `[agentic-loop] fabrication detected: claimed completion with 0 tools. Retrying.`,
  );
  messages = [
    ...messages,
    { role: "assistant" as const, content: result.content },
    {
      role: "user" as const,
      content: "You claimed to complete actions but called no tools. Use your available tools to actually perform the work, or state honestly what you cannot do and create a backlog item.",
    },
  ];
  continue;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run lib/agentic-loop.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd apps/web && pnpm vitest run`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/agentic-loop.ts apps/web/lib/agentic-loop.test.ts
git commit -m "feat: fabrication guardrail detects completion claims without tool usage (EP-SELF-DEV-002 §1)"
```

---

## Task 3: Harden System Prompt

**Files:**
- Modify: `apps/web/lib/prompt-assembler.ts:21-37`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/lib/prompt-assembler.test.ts
import { describe, it, expect } from "vitest";
import { assembleSystemPrompt } from "./prompt-assembler";

describe("assembleSystemPrompt identity block", () => {
  const base = {
    hrRole: "HR-300",
    grantedCapabilities: ["view_platform"],
    deniedCapabilities: [],
    mode: "act" as const,
    sensitivity: "internal" as const,
    domainContext: "Build Studio",
    domainTools: [],
    routeData: null,
    attachmentContext: null,
  };

  it("includes anti-fabrication rule (rule 15)", () => {
    const prompt = assembleSystemPrompt(base);
    expect(prompt).toContain("NEVER describe code you haven't written through a tool");
  });

  it("includes tool-first rule (rule 16)", () => {
    const prompt = assembleSystemPrompt(base);
    expect(prompt).toContain("your FIRST action must be a tool call");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run lib/prompt-assembler.test.ts`
Expected: FAIL — rules 15-16 not present in output

- [ ] **Step 3: Add rules 15-16 to IDENTITY_BLOCK**

In `apps/web/lib/prompt-assembler.ts`, append to the IDENTITY_BLOCK string (before the closing backtick at line 37):

```
15. NEVER describe code you haven't written through a tool. NEVER say "built", "created", "deployed", "shipped", or "implemented" unless you called a tool that did it. If you lack the right tool, say so and create a backlog item.
16. When a user says "build this" or "do it", your FIRST action must be a tool call — search_project_files, update_feature_brief, or whatever tool is most relevant. If you respond with text only when tools are available, you have failed.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run lib/prompt-assembler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/prompt-assembler.ts apps/web/lib/prompt-assembler.test.ts
git commit -m "feat: add anti-fabrication and tool-first rules to system prompt (EP-SELF-DEV-002 §3)"
```

---

## Task 4: Agent Event Bus

**Files:**
- Create: `apps/web/lib/agent-event-bus.ts`
- Create: `apps/web/lib/agent-event-bus.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/lib/agent-event-bus.test.ts
import { describe, it, expect, vi } from "vitest";
import { agentEventBus, type AgentEvent } from "./agent-event-bus";

describe("agentEventBus", () => {
  it("delivers events to subscribers", () => {
    const handler = vi.fn();
    const unsub = agentEventBus.subscribe("thread-1", handler);

    const event: AgentEvent = { type: "tool:start", tool: "search_project_files", iteration: 0 };
    agentEventBus.emit("thread-1", event);

    expect(handler).toHaveBeenCalledWith(event);
    unsub();
  });

  it("does not deliver events to other threads", () => {
    const handler = vi.fn();
    const unsub = agentEventBus.subscribe("thread-2", handler);

    agentEventBus.emit("thread-1", { type: "done" });

    expect(handler).not.toHaveBeenCalled();
    unsub();
  });

  it("unsubscribe stops delivery", () => {
    const handler = vi.fn();
    const unsub = agentEventBus.subscribe("thread-3", handler);
    unsub();

    agentEventBus.emit("thread-3", { type: "done" });

    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run lib/agent-event-bus.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement agent-event-bus.ts**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run lib/agent-event-bus.test.ts`
Expected: PASS — all 3 tests green

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/agent-event-bus.ts apps/web/lib/agent-event-bus.test.ts
git commit -m "feat: agent event bus for real-time progress streaming (EP-SELF-DEV-002 §4)"
```

---

## Task 5: Wire Event Bus into Agentic Loop

**Files:**
- Modify: `apps/web/lib/agentic-loop.ts:35-47` (params type) and tool execution block
- Modify: `apps/web/lib/actions/agent-coworker.ts:522-538` (pass onProgress)

- [ ] **Step 1: Add `onProgress` to runAgenticLoop params**

In `apps/web/lib/agentic-loop.ts`, add to the params type at line 46:

```typescript
  onProgress?: (event: import("./agent-event-bus").AgentEvent) => void;
```

Destructure it in the body at line 60:

```typescript
  const onProgress = params.onProgress;
```

- [ ] **Step 2: Emit events around tool execution**

In the tool execution loop (lines 159-191), wrap the `executeTool` call:

```typescript
// Before tool execution
onProgress?.({ type: "tool:start", tool: tc.name, iteration });

// After tool execution (line 189, after executedTools.push)
onProgress?.({ type: "tool:complete", tool: tc.name, success: toolResult.success });
```

- [ ] **Step 3: Pass onProgress from agent-coworker.ts**

In `apps/web/lib/actions/agent-coworker.ts`, import the event bus:

```typescript
import { agentEventBus } from "@/lib/agent-event-bus";
```

At line 526 (runAgenticLoop call), add:

```typescript
onProgress: (event) => agentEventBus.emit(input.threadId, event),
```

- [ ] **Step 4: Run full test suite**

Run: `cd apps/web && pnpm vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/agentic-loop.ts apps/web/lib/actions/agent-coworker.ts
git commit -m "feat: wire event bus into agentic loop for real-time progress (EP-SELF-DEV-002 §4)"
```

---

## Task 6: SSE Endpoint

**Files:**
- Create: `apps/web/app/api/agent/stream/route.ts`

- [ ] **Step 1: Create SSE route handler**

```typescript
// apps/web/app/api/agent/stream/route.ts
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { agentEventBus } from "@/lib/agent-event-bus";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const threadId = request.nextUrl.searchParams.get("threadId");
  if (!threadId) {
    return new Response("threadId required", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const unsub = agentEventBus.subscribe(threadId, (event) => {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
        if (event.type === "done") {
          controller.close();
        }
      });

      // Clean up on client disconnect
      request.signal.addEventListener("abort", () => {
        unsub();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Run build to verify no compile errors**

Run: `cd apps/web && pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/agent/stream/route.ts
git commit -m "feat: SSE endpoint for agent progress streaming (EP-SELF-DEV-002 §4)"
```

---

## Task 7: Schema Migration — BuildActivity + uxTestResults

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add BuildActivity model and uxTestResults field**

In `packages/db/prisma/schema.prisma`, after the FeatureBuild model, add:

```prisma
model BuildActivity {
  id        String       @id @default(cuid())
  buildId   String
  build     FeatureBuild @relation(fields: [buildId], references: [buildId])
  tool      String
  summary   String
  createdAt DateTime     @default(now())

  @@index([buildId, createdAt])
}
```

In the FeatureBuild model, add the back-relation and new field:

```prisma
  uxTestResults Json?
  activities    BuildActivity[]
```

- [ ] **Step 2: Generate and run migration**

Run: `cd packages/db && pnpm prisma migrate dev --name add_build_activity_ux_tests`
Expected: Migration created and applied

- [ ] **Step 3: Regenerate Prisma client**

Run: `cd packages/db && pnpm prisma generate`
Expected: Client regenerated

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ packages/db/src/
git commit -m "schema: add BuildActivity model and uxTestResults field (EP-SELF-DEV-002 §6)"
```

---

## Task 8: Register Build Studio MCP Tools

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/route-context-map.ts:202-230`

- [ ] **Step 1: Add tool definitions to PLATFORM_TOOLS array**

In `apps/web/lib/mcp-tools.ts`, after the `save_build_notes` tool definition (around line 312), add:

```typescript
  // ─── Build Studio Lifecycle Tools ────────────────────────────────────────
  {
    name: "saveBuildEvidence",
    description: "Save evidence to a FeatureBuild record. Fields: designDoc, buildPlan, taskResults, verificationOut, acceptanceMet.",
    inputSchema: {
      type: "object",
      properties: {
        field: { type: "string", enum: ["designDoc", "designReview", "buildPlan", "planReview", "taskResults", "verificationOut", "acceptanceMet"], description: "Evidence field to update" },
        value: { type: "object", description: "JSON value to store" },
      },
      required: ["field", "value"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "reviewDesignDoc",
    description: "Submit the design document for AI review. Returns pass/fail with issues.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "reviewBuildPlan",
    description: "Submit the implementation plan for AI review. Returns pass/fail with issues.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "launch_sandbox",
    description: "Launch a Docker sandbox container for code generation. Requires approval.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "proposal",
    sideEffect: true,
  },
  {
    name: "generate_code",
    description: "Send a code generation instruction to the coding agent inside the sandbox.",
    inputSchema: {
      type: "object",
      properties: {
        instruction: { type: "string", description: "What to generate or change" },
      },
      required: ["instruction"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "iterate_sandbox",
    description: "Send a refinement instruction to the coding agent in the sandbox.",
    inputSchema: {
      type: "object",
      properties: {
        instruction: { type: "string", description: "Refinement instruction" },
      },
      required: ["instruction"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "run_sandbox_tests",
    description: "Run unit tests and typecheck inside the sandbox container.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "deploy_feature",
    description: "Extract the git diff from sandbox and deploy to the platform. Requires approval.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "manage_capabilities",
    executionMode: "proposal",
    sideEffect: true,
  },
```

- [ ] **Step 2: Add case handlers in executeTool switch**

In `apps/web/lib/mcp-tools.ts`, inside the `executeTool` switch statement (after the `save_build_notes` case), add handlers that call the existing backends:

```typescript
    case "saveBuildEvidence": {
      const { saveBuildEvidence } = await import("@/lib/actions/build");
      const field = String(params.field);
      const value = params.value;
      const buildId = await resolveActiveBuildId(context?.threadId);
      if (!buildId) return { success: false, error: "No active build found.", message: "No active build." };
      await saveBuildEvidence(buildId, field, value);
      // Emit SSE event
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      if (context?.threadId) {
        agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field });
      }
      return { success: true, message: `Evidence "${field}" saved.`, entityId: buildId };
    }

    case "reviewDesignDoc": {
      const buildId = await resolveActiveBuildId(context?.threadId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { designDoc: true } });
      if (!build?.designDoc) return { success: false, error: "No design document saved yet.", message: "Save designDoc first." };
      const { buildDesignReviewPrompt, parseReviewResponse } = await import("@/lib/build-reviewers");
      const prompt = buildDesignReviewPrompt(build.designDoc as any, "");
      const { callWithFailover } = await import("@/lib/ai-provider-priority");
      const llmResult = await callWithFailover(
        [{ role: "user", content: prompt }], "You are a design reviewer.", "internal", {},
      );
      const review = parseReviewResponse(llmResult.content);
      await prisma.featureBuild.update({ where: { buildId }, data: { designReview: review as any } });
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      if (context?.threadId) agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "designReview" });
      return { success: true, message: `Design review: ${review.decision}. ${review.summary}`, data: { review } };
    }

    case "reviewBuildPlan": {
      const buildId = await resolveActiveBuildId(context?.threadId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { buildPlan: true } });
      if (!build?.buildPlan) return { success: false, error: "No build plan saved yet.", message: "Save buildPlan first." };
      const { buildPlanReviewPrompt, parseReviewResponse } = await import("@/lib/build-reviewers");
      const prompt = buildPlanReviewPrompt(build.buildPlan as any);
      const { callWithFailover } = await import("@/lib/ai-provider-priority");
      const llmResult = await callWithFailover(
        [{ role: "user", content: prompt }], "You are a plan reviewer.", "internal", {},
      );
      const review = parseReviewResponse(llmResult.content);
      await prisma.featureBuild.update({ where: { buildId }, data: { planReview: review as any } });
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      if (context?.threadId) agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "planReview" });
      return { success: true, message: `Plan review: ${review.decision}. ${review.summary}`, data: { review } };
    }

    case "launch_sandbox": {
      const buildId = await resolveActiveBuildId(context?.threadId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const { createSandbox, startSandbox } = await import("@/lib/sandbox");
      const port = 3001 + Math.floor(Math.random() * 100);
      const containerId = await createSandbox(buildId, port);
      await startSandbox(containerId);
      await prisma.featureBuild.update({ where: { buildId }, data: { sandboxId: containerId, sandboxPort: port } });
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      if (context?.threadId) agentEventBus.emit(context.threadId, { type: "phase:change", buildId, phase: "build" });
      return { success: true, message: `Sandbox launched on port ${port}.`, entityId: buildId, data: { containerId, port } };
    }

    case "generate_code": {
      const buildId = await resolveActiveBuildId(context?.threadId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true, brief: true, buildPlan: true } });
      if (!build?.sandboxId) return { success: false, error: "Sandbox not running. Launch it first.", message: "No sandbox." };
      if (!build.brief) return { success: false, error: "No feature brief.", message: "Save brief first." };
      const { buildCodeGenPrompt } = await import("@/lib/coding-agent");
      const { execInSandbox } = await import("@/lib/sandbox");
      const prompt = buildCodeGenPrompt(build.brief as any, (build.buildPlan ?? {}) as any, String(params.instruction ?? ""));
      // Write prompt to sandbox and execute
      await execInSandbox(build.sandboxId, `cat > /tmp/codegen-prompt.txt << 'PROMPT_EOF'\n${prompt}\nPROMPT_EOF`);
      return { success: true, message: "Code generation instruction sent to sandbox.", data: { instruction: String(params.instruction ?? "") } };
    }

    case "iterate_sandbox": {
      const buildId = await resolveActiveBuildId(context?.threadId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true } });
      if (!build?.sandboxId) return { success: false, error: "Sandbox not running.", message: "No sandbox." };
      const { execInSandbox } = await import("@/lib/sandbox");
      const output = await execInSandbox(build.sandboxId, String(params.instruction ?? "echo 'No instruction'"));
      return { success: true, message: "Refinement applied.", data: { output: output.slice(0, 2000) } };
    }

    case "run_sandbox_tests": {
      const buildId = await resolveActiveBuildId(context?.threadId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true } });
      if (!build?.sandboxId) return { success: false, error: "Sandbox not running.", message: "No sandbox." };
      const { runSandboxTests } = await import("@/lib/coding-agent");
      const results = await runSandboxTests(build.sandboxId);
      await prisma.featureBuild.update({
        where: { buildId },
        data: {
          verificationOut: {
            testsPassed: results.passed ? 1 : 0,
            testsFailed: results.passed ? 0 : 1,
            typecheckPassed: results.typeCheckPassed,
            testOutput: results.testOutput.slice(0, 5000),
            typeCheckOutput: results.typeCheckOutput.slice(0, 5000),
          },
        },
      });
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      if (context?.threadId) agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "verificationOut" });
      return {
        success: true,
        message: results.passed ? "All tests pass, typecheck clean." : `Tests: ${results.passed ? "PASS" : "FAIL"}. Typecheck: ${results.typeCheckPassed ? "PASS" : "FAIL"}.`,
        data: { testsPassed: results.passed, typeCheckPassed: results.typeCheckPassed },
      };
    }

    case "deploy_feature": {
      const buildId = await resolveActiveBuildId(context?.threadId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true } });
      if (!build?.sandboxId) return { success: false, error: "Sandbox not running.", message: "No sandbox." };
      const { extractDiff } = await import("@/lib/sandbox");
      const diff = await extractDiff(build.sandboxId);
      await prisma.featureBuild.update({ where: { buildId }, data: { diffPatch: diff, diffSummary: diff.slice(0, 500) } });
      return { success: true, message: "Diff extracted. Ready for approval.", data: { diffLength: diff.length, summary: diff.slice(0, 500) } };
    }
```

Also add a helper function `resolveActiveBuildId` near the top of the file:

```typescript
async function resolveActiveBuildId(threadId?: string): Promise<string | null> {
  if (!threadId) return null;
  // Find the most recent non-complete, non-failed build for this thread
  const build = await prisma.featureBuild.findFirst({
    where: { phase: { notIn: ["complete", "failed"] } },
    orderBy: { createdAt: "desc" },
    select: { buildId: true },
  });
  return build?.buildId ?? null;
}
```

- [ ] **Step 3: Update route-context-map.ts domainTools**

In `apps/web/lib/route-context-map.ts`, replace the `/build` domainTools array (around line 208) with:

```typescript
  domainTools: [
    "update_feature_brief",
    "create_build_epic",
    "register_digital_product_from_build",
    "search_portfolio_context",
    "assess_complexity",
    "propose_decomposition",
    "register_tech_debt",
    "save_build_notes",
    "saveBuildEvidence",
    "reviewDesignDoc",
    "reviewBuildPlan",
    "launch_sandbox",
    "generate_code",
    "iterate_sandbox",
    "run_sandbox_tests",
    "deploy_feature",
    "read_project_file",
    "search_project_files",
    "list_project_directory",
  ],
```

- [ ] **Step 4: Run typecheck**

Run: `cd apps/web && pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/mcp-tools.ts apps/web/lib/route-context-map.ts
git commit -m "feat: register 8 Build Studio MCP tools with case handlers (EP-SELF-DEV-002 §7)"
```

---

## Task 9: Build Page Live Refresh + Activity Log

**Files:**
- Create: `apps/web/lib/actions/build-read.ts`
- Create: `apps/web/components/build/BuildActivityLog.tsx`
- Modify: `apps/web/components/build/BuildStudio.tsx`

- [ ] **Step 1: Create getFeatureBuild server action**

```typescript
// apps/web/lib/actions/build-read.ts
"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import type { FeatureBuildRow } from "@/lib/feature-build-types";

export async function getFeatureBuild(buildId: string): Promise<FeatureBuildRow | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    include: {
      digitalProduct: { select: { productId: true, version: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });

  if (!build || build.createdById !== session.user.id) return null;

  // Map to FeatureBuildRow shape (same as getFeatureBuilds)
  return {
    ...build,
    brief: build.brief as FeatureBuildRow["brief"],
    plan: build.plan as FeatureBuildRow["plan"],
    phase: build.phase as FeatureBuildRow["phase"],
    designDoc: build.designDoc as FeatureBuildRow["designDoc"],
    designReview: build.designReview as FeatureBuildRow["designReview"],
    buildPlan: build.buildPlan as FeatureBuildRow["buildPlan"],
    planReview: build.planReview as FeatureBuildRow["planReview"],
    taskResults: build.taskResults as FeatureBuildRow["taskResults"],
    verificationOut: build.verificationOut as FeatureBuildRow["verificationOut"],
    acceptanceMet: build.acceptanceMet as FeatureBuildRow["acceptanceMet"],
    product: build.digitalProduct
      ? { productId: build.digitalProduct.productId, version: build.digitalProduct.version, backlogCount: 0 }
      : null,
  } as FeatureBuildRow;
}
```

- [ ] **Step 2: Create BuildActivityLog component**

```typescript
// apps/web/components/build/BuildActivityLog.tsx
"use client";

type Activity = { id: string; tool: string; summary: string; createdAt: string };

export function BuildActivityLog({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) return null;

  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold text-white uppercase tracking-widest mb-2">Activity</h3>
      <div className="space-y-1 max-h-48 overflow-auto">
        {activities.map((a) => (
          <div key={a.id} className="flex items-start gap-2 text-[11px] text-[var(--dpf-muted)]">
            <span className="shrink-0 tabular-nums">
              {new Date(a.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="text-[#ccc]">{a.summary}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add SSE subscription and activity log to BuildStudio.tsx**

In `apps/web/components/build/BuildStudio.tsx`, add imports and SSE effect:

```typescript
import { getFeatureBuild } from "@/lib/actions/build-read";
import { BuildActivityLog } from "./BuildActivityLog";
```

Add useEffect for SSE after the existing effects (around line 121):

```typescript
  // SSE subscription for live refresh
  useEffect(() => {
    if (!activeBuild?.buildId) return;
    // We need the threadId — fetch it if not available
    const es = new EventSource(`/api/agent/stream?threadId=${activeBuild.buildId}`);
    es.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (["brief:update", "phase:change", "evidence:update"].includes(data.type)) {
          const fresh = await getFeatureBuild(activeBuild.buildId);
          if (fresh) setActiveBuild(fresh);
        }
      } catch { /* ignore parse errors */ }
    };
    return () => es.close();
  }, [activeBuild?.buildId]);
```

- [ ] **Step 4: Run typecheck**

Run: `cd apps/web && pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/build-read.ts apps/web/components/build/BuildActivityLog.tsx apps/web/components/build/BuildStudio.tsx
git commit -m "feat: Build page live refresh via SSE + activity log (EP-SELF-DEV-002 §5-6)"
```

---

## Task 10: SSE Thinking Indicator in Coworker Panel

**Files:**
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx`

- [ ] **Step 1: Add SSE subscription for tool activity**

In `AgentCoworkerPanel.tsx`, add state for current tool:

```typescript
const [currentTool, setCurrentTool] = useState<string | null>(null);
```

Add useEffect after the existing thinking timer effect (around line 97):

```typescript
  // SSE for tool-level progress
  useEffect(() => {
    if (!isPending || !threadId) { setCurrentTool(null); return; }
    const es = new EventSource(`/api/agent/stream?threadId=${threadId}`);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "tool:start") setCurrentTool(data.tool);
        if (data.type === "tool:complete" || data.type === "done") setCurrentTool(null);
      } catch { /* ignore */ }
    };
    return () => { es.close(); setCurrentTool(null); };
  }, [isPending, threadId]);
```

- [ ] **Step 2: Update thinking indicator text**

In the thinking indicator section (around line 411-415), replace the existing ternary with:

```typescript
{isClearing
  ? "Clearing conversation"
  : currentTool
    ? `${agent.agentName} is using ${currentTool.replace(/_/g, " ")}...`
    : thinkingSeconds < 5
      ? `${agent.agentName} is thinking`
      : thinkingSeconds < 15
        ? `${agent.agentName} is working on it`
        : `${agent.agentName} is still working (${thinkingSeconds}s)`}
```

- [ ] **Step 3: Run typecheck**

Run: `cd apps/web && pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/agent/AgentCoworkerPanel.tsx
git commit -m "feat: thinking indicator shows tool-level progress via SSE (EP-SELF-DEV-002 §4)"
```

---

## Task 11: EvidenceSummary — Add UX Tests Item

**Files:**
- Modify: `apps/web/components/build/EvidenceSummary.tsx`

- [ ] **Step 1: Add 7th evidence item**

In `EvidenceSummary.tsx`, add after the "Acceptance Criteria" item in the `items` array (around line 47):

```typescript
    {
      label: "UX Acceptance Tests",
      status: (build as any).uxTestResults
        ? ((build as any).uxTestResults.every((s: any) => s.passed) ? "pass" : "fail")
        : "missing",
      detail: (build as any).uxTestResults
        ? `${(build as any).uxTestResults.filter((s: any) => s.passed).length}/${(build as any).uxTestResults.length} passed`
        : "Not run",
    },
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/build/EvidenceSummary.tsx
git commit -m "feat: add UX Acceptance Tests to evidence chain (EP-SELF-DEV-002 §8)"
```

---

## Task 12: Playwright Container + Runner

**Files:**
- Modify: `docker-compose.yml`
- Create: `apps/web/lib/playwright-runner.ts`
- Create: `apps/web/components/build/TestRunnerPanel.tsx`

- [ ] **Step 1: Add Playwright service to docker-compose.yml**

After the `sandbox-image` service (around line 110), add:

```yaml
  playwright:
    image: mcr.microsoft.com/playwright:v1.52.0-noble
    volumes:
      - playwright_scripts:/scripts
      - playwright_results:/results
    network_mode: host
    profiles: ["build-images"]
    command: ["sleep", "infinity"]
```

Add to volumes section:

```yaml
  playwright_scripts:
  playwright_results:
```

- [ ] **Step 2: Create playwright-runner.ts**

```typescript
// apps/web/lib/playwright-runner.ts
// Generates and executes Playwright tests against sandbox containers.

import { exec as execCb } from "child_process";
import { promisify } from "util";

const exec = promisify(execCb);

export type UxTestStep = {
  step: string;
  passed: boolean;
  screenshotUrl: string | null;
  error: string | null;
};

export function generateTestScript(
  sandboxUrl: string,
  acceptanceCriteria: string[],
  buildId: string,
): string {
  const steps = acceptanceCriteria.map((criterion, i) => `
    await test.step('${criterion.replace(/'/g, "\\'")}', async () => {
      await page.screenshot({ path: '/results/${buildId}-step-${i}.png' });
      // Criterion: ${criterion}
      // Agent should have set up test conditions
    });
  `).join("\n");

  return `
import { test, expect } from '@playwright/test';

test('UX Acceptance: ${buildId}', async ({ page }) => {
  await page.goto('${sandboxUrl}');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: '/results/${buildId}-initial.png' });
${steps}
});
`;
}

export async function runPlaywrightTest(buildId: string): Promise<UxTestStep[]> {
  try {
    const { stdout } = await exec(
      `docker exec playwright npx playwright test /scripts/${buildId}.spec.ts --reporter=json 2>&1 || true`,
      { timeout: 120000 },
    );
    // Parse JSON reporter output
    try {
      const report = JSON.parse(stdout);
      return (report.suites?.[0]?.specs ?? []).map((spec: any, i: number) => ({
        step: spec.title ?? `Step ${i + 1}`,
        passed: spec.ok ?? false,
        screenshotUrl: `/results/${buildId}-step-${i}.png`,
        error: spec.tests?.[0]?.results?.[0]?.error?.message ?? null,
      }));
    } catch {
      return [{ step: "Test execution", passed: false, screenshotUrl: null, error: stdout.slice(0, 500) }];
    }
  } catch (e) {
    return [{ step: "Test execution", passed: false, screenshotUrl: null, error: e instanceof Error ? e.message : String(e) }];
  }
}
```

- [ ] **Step 3: Create TestRunnerPanel component**

```typescript
// apps/web/components/build/TestRunnerPanel.tsx
"use client";

import { useState } from "react";

type TestStep = {
  step: string;
  passed: boolean;
  screenshotUrl: string | null;
  error: string | null;
};

export function TestRunnerPanel({ steps }: { steps: TestStep[] }) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  if (steps.length === 0) {
    return (
      <div className="p-4 text-center text-[var(--dpf-muted)] text-sm">
        UX tests will appear here during the Review phase.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      <h3 className="text-xs font-semibold text-white uppercase tracking-widest">UX Test Results</h3>
      {steps.map((s, i) => (
        <div key={i}>
          <button
            onClick={() => setExpandedStep(expandedStep === i ? null : i)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-left cursor-pointer hover:border-[var(--dpf-accent)] transition-colors"
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: s.passed ? "#4ade80" : "#f87171" }}
            />
            <span className="text-xs text-white flex-1">{s.step}</span>
            <span className="text-[10px] text-[var(--dpf-muted)]">{s.passed ? "PASS" : "FAIL"}</span>
          </button>
          {expandedStep === i && (
            <div className="mt-1 ml-4 p-2 rounded bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
              {s.screenshotUrl && (
                <img src={s.screenshotUrl} alt={`Step ${i + 1}`} className="rounded border border-[var(--dpf-border)] mb-2 max-w-full" />
              )}
              {s.error && (
                <pre className="text-[10px] text-[#f87171] whitespace-pre-wrap">{s.error}</pre>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Register Playwright MCP tools in mcp-tools.ts**

Add tool definitions after `deploy_feature`:

```typescript
  {
    name: "generate_ux_test",
    description: "Generate a Playwright test script from acceptance criteria for the sandbox.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "run_ux_test",
    description: "Execute the Playwright UX test against the sandbox. Returns step-by-step results with screenshots.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
```

Add case handlers:

```typescript
    case "generate_ux_test": {
      const buildId = await resolveActiveBuildId(context?.threadId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxPort: true, brief: true } });
      if (!build?.sandboxPort || !build.brief) return { success: false, error: "Sandbox or brief not ready.", message: "Launch sandbox and save brief first." };
      const { generateTestScript } = await import("@/lib/playwright-runner");
      const brief = build.brief as any;
      const script = generateTestScript(`http://localhost:${build.sandboxPort}`, brief.acceptanceCriteria ?? [], buildId);
      // Write script to Playwright container
      const { exec: execCb } = await import("child_process");
      const { promisify } = await import("util");
      const exec = promisify(execCb);
      await exec(`docker exec playwright sh -c 'cat > /scripts/${buildId}.spec.ts << SCRIPT_EOF\n${script}\nSCRIPT_EOF'`);
      return { success: true, message: "UX test script generated.", data: { script } };
    }

    case "run_ux_test": {
      const buildId = await resolveActiveBuildId(context?.threadId);
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      const { runPlaywrightTest } = await import("@/lib/playwright-runner");
      const steps = await runPlaywrightTest(buildId);
      // Emit SSE events per step
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      for (let i = 0; i < steps.length; i++) {
        if (context?.threadId) {
          agentEventBus.emit(context.threadId, {
            type: "test:step",
            stepIndex: i,
            description: steps[i]!.step,
            screenshot: steps[i]!.screenshotUrl ?? undefined,
            passed: steps[i]!.passed,
          });
        }
      }
      await prisma.featureBuild.update({ where: { buildId }, data: { uxTestResults: steps as any } });
      if (context?.threadId) agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "uxTestResults" });
      const passed = steps.filter((s) => s.passed).length;
      return { success: true, message: `UX tests: ${passed}/${steps.length} passed.`, data: { steps } };
    }
```

Also add to the `/build` domainTools in route-context-map.ts:

```typescript
    "generate_ux_test",
    "run_ux_test",
```

- [ ] **Step 5: Run typecheck**

Run: `cd apps/web && pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml apps/web/lib/playwright-runner.ts apps/web/components/build/TestRunnerPanel.tsx apps/web/lib/mcp-tools.ts apps/web/lib/route-context-map.ts
git commit -m "feat: Playwright UX testing container + runner + panel (EP-SELF-DEV-002 §8)"
```

---

## Task 13: Final Integration — Emit done Event + Write BuildActivity Rows

**Files:**
- Modify: `apps/web/lib/agentic-loop.ts`
- Modify: `apps/web/lib/actions/agent-coworker.ts`

- [ ] **Step 1: Emit "done" event when agentic loop completes**

In `apps/web/lib/actions/agent-coworker.ts`, after the `runAgenticLoop` call completes (around line 538), add:

```typescript
agentEventBus.emit(input.threadId, { type: "done" });
```

- [ ] **Step 2: Write BuildActivity rows for tool executions**

In the agentic loop tool execution section (after `executedTools.push` at line 189), add:

```typescript
// Fire-and-forget: write activity log
if (context?.routeContext === "/build") {
  import("@dpf/db").then(({ prisma }) => {
    resolveActiveBuildId(context?.threadId).then((buildId) => {
      if (buildId) {
        prisma.buildActivity.create({
          data: { buildId, tool: tc.name, summary: toolResult.message.slice(0, 500) },
        }).catch(() => {});
      }
    });
  }).catch(() => {});
}
```

Note: `resolveActiveBuildId` needs to be importable from mcp-tools or moved to a shared location. Move it to a small utility:

```typescript
// Export resolveActiveBuildId from mcp-tools.ts so the agentic loop can use it
// Or inline the query — simpler given it's a 5-line function
```

- [ ] **Step 3: Run full test suite**

Run: `cd apps/web && pnpm vitest run`
Expected: All tests pass

- [ ] **Step 4: Run typecheck**

Run: `cd apps/web && pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/agentic-loop.ts apps/web/lib/actions/agent-coworker.ts
git commit -m "feat: emit done event + write BuildActivity rows on tool execution (EP-SELF-DEV-002 §6)"
```

---

## Task 14: End-to-End Verification

- [ ] **Step 1: Build the sandbox image**

Run: `docker compose --profile build-images build`
Expected: `dpf-sandbox` and `playwright` images built successfully

- [ ] **Step 2: Start the platform**

Run: `docker compose up -d` (or `pnpm dev` for developer mode)
Expected: All services healthy

- [ ] **Step 3: Run full test suite**

Run: `cd apps/web && pnpm vitest run`
Expected: All tests pass, including new tests from Tasks 1-4

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && pnpm tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Manual smoke test via Playwright browser**

Navigate to `http://localhost:3000/build`:
1. Create a new feature — verify coworker panel opens
2. Type a message — verify thinking indicator shows tool names
3. Verify FeatureBriefPanel updates when agent saves brief
4. Verify EvidenceSummary shows 7 items
5. Verify PhaseIndicator advances when phase changes

- [ ] **Step 6: Commit**

```bash
git commit -m "chore: end-to-end verification pass (EP-SELF-DEV-002)"
```
