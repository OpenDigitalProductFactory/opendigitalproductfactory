# Structured Tool-Calling Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the agentic loop's text-based tool-call/result messages with provider-native structured protocol so models operate in the format they were trained on.

**Architecture:** Extend `ChatMessage` to carry structured tool data (IDs, content blocks). Update `callProvider` to format these correctly per provider (Anthropic tool_use/tool_result, OpenAI tool_calls/tool role). Update agentic loop to create structured messages instead of fabricated text.

**Tech Stack:** TypeScript, Next.js server actions, Anthropic Messages API, OpenAI Chat Completions API

**Spec:** `docs/superpowers/specs/2026-03-18-structured-tool-calling-design.md`

---

### Task 1: Extend ChatMessage and InferenceResult Types

**Files:**
- Modify: `apps/web/lib/ai-inference.ts:11-22`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/ai-inference-types.test.ts`:

```typescript
import type { ChatMessage, InferenceResult } from "./ai-inference";

// Type-level tests — these verify the type system accepts structured messages.
// They compile or they don't — no runtime assertions needed.

describe("ChatMessage type", () => {
  it("accepts plain string content (backward compat)", () => {
    const msg: ChatMessage = { role: "user", content: "hello" };
    expect(msg.content).toBe("hello");
  });

  it("accepts content block arrays", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "Searching..." },
        { type: "tool_use", id: "toolu_01A", name: "search_project_files", input: { query: "agent" } },
      ],
    };
    expect(Array.isArray(msg.content)).toBe(true);
  });

  it("accepts tool role with toolCallId", () => {
    const msg: ChatMessage = {
      role: "tool",
      content: "Found 3 files",
      toolCallId: "call_abc",
    };
    expect(msg.role).toBe("tool");
    expect(msg.toolCallId).toBe("call_abc");
  });

  it("accepts assistant with toolCalls", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "Let me search.",
      toolCalls: [{ id: "toolu_01A", name: "search_project_files", arguments: { query: "agent" } }],
    };
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0].id).toBe("toolu_01A");
  });
});

describe("InferenceResult type", () => {
  it("includes id in toolCalls", () => {
    const result: InferenceResult = {
      content: "",
      inputTokens: 10,
      outputTokens: 5,
      inferenceMs: 100,
      toolCalls: [{ id: "toolu_01A", name: "search", arguments: {} }],
    };
    expect(result.toolCalls![0].id).toBe("toolu_01A");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/ai-inference-types.test.ts`
Expected: FAIL — `ChatMessage` doesn't accept `role: "tool"`, `content: ContentBlock[]`, `toolCalls`, `toolCallId`. `InferenceResult.toolCalls` doesn't have `id`.

- [ ] **Step 3: Update the types**

In `apps/web/lib/ai-inference.ts`, replace the `ChatMessage` and `InferenceResult` type definitions:

```typescript
/** Anthropic-style content blocks for structured tool-calling messages */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentBlock[];
  /** Tool calls the assistant made (present when role=assistant and model called tools) */
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  /** For role=tool messages: which tool call this result responds to */
  toolCallId?: string;
};

export type InferenceResult = {
  content: string;
  inputTokens: number;
  outputTokens: number;
  inferenceMs: number;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/ai-inference-types.test.ts`
Expected: PASS

- [ ] **Step 5: Fix any downstream type errors**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -40`

The `id` field addition to `toolCalls` will cause type errors wherever tool calls are constructed without `id`. Fix each site:
- `apps/web/lib/routing/fallback.ts` — `FallbackResult` has its own `toolCalls` definition (does NOT extend `InferenceResult`). Update it to include `id`: `toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>`
- Any test mocks that construct `toolCalls` — add `id: "mock_id"`
- Gemini path in `callProvider` — add `typeof` guard for `msg.content` which is now `string | ContentBlock[]`: use `typeof m.content === "string" ? m.content : JSON.stringify(m.content)` and skip `role: "tool"` messages

Fix these now — they must compile before later tasks can run.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/ai-inference.ts apps/web/lib/ai-inference-types.test.ts
git commit -m "feat: extend ChatMessage and InferenceResult types for structured tool calling (EP-AGENT-EXEC-002)"
```

---

### Task 2: Preserve Tool Call IDs in callProvider Response Parsing

**Files:**
- Modify: `apps/web/lib/ai-inference.ts:302-326` (tool call extraction)

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/ai-inference-toolcalls.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

// These tests verify the tool call ID extraction logic directly.
// We'll extract the parsing logic into a testable helper.

describe("extractToolCalls", () => {
  describe("Anthropic format", () => {
    it("preserves tool_use block IDs", () => {
      const contentBlocks = [
        { type: "text", text: "Searching..." },
        { type: "tool_use", id: "toolu_01A09q90qw90", name: "search_project_files", input: { query: "agent" } },
        { type: "tool_use", id: "toolu_01B99x88yy88", name: "read_project_file", input: { path: "lib/foo.ts" } },
      ];
      const result = extractAnthropicToolCalls(contentBlocks);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("toolu_01A09q90qw90");
      expect(result[0].name).toBe("search_project_files");
      expect(result[1].id).toBe("toolu_01B99x88yy88");
    });
  });

  describe("OpenAI-compatible format", () => {
    it("preserves tool_call IDs", () => {
      const toolCalls = [
        { id: "call_abc123", type: "function", function: { name: "search_project_files", arguments: '{"query":"agent"}' } },
      ];
      const result = extractOpenAIToolCalls(toolCalls);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("call_abc123");
      expect(result[0].name).toBe("search_project_files");
      expect(result[0].arguments).toEqual({ query: "agent" });
    });
  });
});
```

- [ ] **Step 2: Extract parsing into exported helper functions and add IDs**

Extract the inline tool call parsing from `callProvider` into two exported functions. This makes them independently testable (the tests in step 1 import these directly).

Add to `apps/web/lib/ai-inference.ts`:

```typescript
/** Extract tool calls from Anthropic content blocks, preserving IDs */
export function extractAnthropicToolCalls(
  contentBlocks: Array<{ type?: string; id?: string; name?: string; input?: Record<string, unknown> }>,
): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
  return contentBlocks
    .filter((b) => b.type === "tool_use" && b.name)
    .map((b) => ({
      id: b.id ?? `synth_${Math.random().toString(36).slice(2, 9)}`,
      name: b.name!,
      arguments: b.input ?? {},
    }));
}

/** Extract tool calls from OpenAI-compatible tool_calls array, preserving IDs */
export function extractOpenAIToolCalls(
  rawToolCalls: Array<{ id?: string; function?: { name?: string; arguments?: string } }>,
): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
  return rawToolCalls
    .filter((tc) => tc.function?.name)
    .map((tc) => ({
      id: tc.id ?? `synth_${Math.random().toString(36).slice(2, 9)}`,
      name: tc.function!.name!,
      arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) as Record<string, unknown> : {},
    }));
}
```

Then update `callProvider`'s inline parsing to call these helpers:

Anthropic path: `toolCalls = extractAnthropicToolCalls(contentBlocks ?? []);`
OpenAI-compatible path: `toolCalls = extractOpenAIToolCalls(rawMsg.tool_calls);`

The `synth_` prefix on fallback IDs ensures we never send an empty ID to a provider that requires one.

- [ ] **Step 3: Run tests**

Run: `cd apps/web && npx vitest run lib/ai-inference-toolcalls.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/ai-inference.ts apps/web/lib/ai-inference-toolcalls.test.ts
git commit -m "feat: preserve tool call IDs in callProvider response parsing (EP-AGENT-EXEC-002)"
```

---

### Task 3: Update callProvider Message Formatting for Structured Messages

**Files:**
- Modify: `apps/web/lib/ai-inference.ts:208-264` (message formatting in callProvider)

- [ ] **Step 1: Write the failing test**

Add to `apps/web/lib/ai-inference-toolcalls.test.ts`:

```typescript
describe("formatMessagesForProvider", () => {
  describe("Anthropic", () => {
    it("formats assistant message with toolCalls as content block array", () => {
      const msg: ChatMessage = {
        role: "assistant",
        content: "Searching...",
        toolCalls: [{ id: "toolu_01A", name: "search", arguments: { q: "agent" } }],
      };
      const formatted = formatMessageForAnthropic(msg);
      expect(formatted.role).toBe("assistant");
      expect(formatted.content).toEqual([
        { type: "text", text: "Searching..." },
        { type: "tool_use", id: "toolu_01A", name: "search", input: { q: "agent" } },
      ]);
    });

    it("converts tool role message to user with tool_result block", () => {
      const msg: ChatMessage = {
        role: "tool",
        content: "Found 3 files",
        toolCallId: "toolu_01A",
      };
      const formatted = formatMessageForAnthropic(msg);
      expect(formatted.role).toBe("user");
      expect(formatted.content).toEqual([
        { type: "tool_result", tool_use_id: "toolu_01A", content: "Found 3 files" },
      ]);
    });

    it("passes plain messages unchanged", () => {
      const msg: ChatMessage = { role: "user", content: "hello" };
      const formatted = formatMessageForAnthropic(msg);
      expect(formatted).toEqual({ role: "user", content: "hello" });
    });
  });

  describe("OpenAI-compatible", () => {
    it("formats assistant message with tool_calls field", () => {
      const msg: ChatMessage = {
        role: "assistant",
        content: "Searching...",
        toolCalls: [{ id: "call_abc", name: "search", arguments: { q: "agent" } }],
      };
      const formatted = formatMessageForOpenAI(msg);
      expect(formatted.role).toBe("assistant");
      expect(formatted.content).toBe("Searching...");
      expect(formatted.tool_calls).toEqual([
        { id: "call_abc", type: "function", function: { name: "search", arguments: '{"q":"agent"}' } },
      ]);
    });

    it("formats tool role message with tool_call_id", () => {
      const msg: ChatMessage = {
        role: "tool",
        content: "Found 3 files",
        toolCallId: "call_abc",
      };
      const formatted = formatMessageForOpenAI(msg);
      expect(formatted.role).toBe("tool");
      expect(formatted.tool_call_id).toBe("call_abc");
      expect(formatted.content).toBe("Found 3 files");
    });
  });
});
```

- [ ] **Step 2: Implement formatting helper functions**

Add two exported functions to `apps/web/lib/ai-inference.ts`:

```typescript
/** Format a ChatMessage for the Anthropic Messages API */
export function formatMessageForAnthropic(msg: ChatMessage): Record<string, unknown> {
  // Tool result messages → Anthropic uses role=user with tool_result content block
  if (msg.role === "tool" && msg.toolCallId) {
    return {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: msg.toolCallId, content: typeof msg.content === "string" ? msg.content : "" }],
    };
  }
  // Assistant messages with tool calls → content block array with text + tool_use blocks
  if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
    const textContent = typeof msg.content === "string" ? msg.content : "";
    return {
      role: "assistant",
      content: [
        ...(textContent ? [{ type: "text", text: textContent }] : []),
        ...msg.toolCalls.map((tc) => ({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments })),
      ],
    };
  }
  // Plain messages — pass through with string content
  return { role: msg.role, content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) };
}

/** Format a ChatMessage for the OpenAI Chat Completions API */
export function formatMessageForOpenAI(msg: ChatMessage): Record<string, unknown> {
  // Tool result messages → role=tool with tool_call_id
  if (msg.role === "tool" && msg.toolCallId) {
    return { role: "tool", tool_call_id: msg.toolCallId, content: typeof msg.content === "string" ? msg.content : "" };
  }
  // Assistant messages with tool calls → tool_calls field
  if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: typeof msg.content === "string" ? msg.content : "",
      tool_calls: msg.toolCalls.map((tc) => ({
        id: tc.id, type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    };
  }
  // Plain messages — pass through with string content
  return { role: msg.role, content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) };
}
```

Then update `callProvider` to use these helpers:

**Anthropic message mapping** (replace existing `.map((m) => ({ role: m.role, content: m.content }))`):
```typescript
messages: messages
  .filter((m) => m.role !== "system")
  .map((m) => formatMessageForAnthropic(m)),
```

**OpenAI-compatible message mapping** (replace existing `.map((m) => ({ role: m.role, content: m.content }))`):
```typescript
const allMessages = [
  { role: "system" as const, content: systemPrompt },
  ...messages.map((m) => formatMessageForOpenAI(m)),
];
```

**Gemini message mapping** — Gemini doesn't support structured tool calling yet. Add a `typeof` guard to prevent compile errors from the `content: string | ContentBlock[]` union:
```typescript
for (const m of messages) {
  const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
  // Skip tool-result messages in Gemini path (no structured tool support)
  if (m.role === "tool") continue;
  contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text }] });
}
```

- [ ] **Step 3: Run tests and type check**

Run: `cd apps/web && npx vitest run lib/ai-inference-toolcalls.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/ai-inference.ts apps/web/lib/ai-inference-toolcalls.test.ts
git commit -m "feat: structured message formatting for Anthropic and OpenAI in callProvider (EP-AGENT-EXEC-002)"
```

---

### Task 4: Update Agentic Loop to Create Structured Messages

**Files:**
- Modify: `apps/web/lib/agentic-loop.ts`
- Create: `apps/web/lib/agentic-loop.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/agentic-loop.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

// Mock the imports
vi.mock("./ai-provider-priority", () => ({
  callWithFailover: vi.fn(),
}));
vi.mock("./routing/fallback", () => ({
  callWithFallbackChain: vi.fn(),
}));
vi.mock("./mcp-tools", () => ({
  executeTool: vi.fn(),
}));

import { runAgenticLoop } from "./agentic-loop";
import { callWithFailover } from "./ai-provider-priority";
import { executeTool } from "./mcp-tools";

describe("runAgenticLoop", () => {
  const baseParams = {
    chatHistory: [{ role: "user" as const, content: "search for agent code" }],
    systemPrompt: "You are a helpful assistant.",
    sensitivity: "internal" as const,
    tools: [{ name: "search_project_files", description: "Search", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: false }],
    toolsForProvider: [{ type: "function", function: { name: "search_project_files", description: "Search", parameters: {} } }],
    userId: "user-1",
    routeContext: "/build",
    agentId: "software-engineer",
    threadId: "thread-1",
  };

  it("creates structured messages with tool call IDs after tool execution", async () => {
    const mockFailover = vi.mocked(callWithFailover);
    const mockExecuteTool = vi.mocked(executeTool);

    // Iteration 0: model calls a tool
    mockFailover.mockResolvedValueOnce({
      content: "Searching for agent code.",
      providerId: "anthropic-sub",
      modelId: "claude-haiku-4-5-20251001",
      downgraded: false,
      downgradeMessage: null,
      inputTokens: 100,
      outputTokens: 50,
      inferenceMs: 500,
      toolCalls: [{ id: "toolu_01A", name: "search_project_files", arguments: { query: "agent" } }],
    });

    mockExecuteTool.mockResolvedValueOnce({
      success: true,
      message: "Found 3 files",
      data: { files: ["a.ts", "b.ts", "c.ts"] },
    });

    // Iteration 1: model responds with text only
    mockFailover.mockResolvedValueOnce({
      content: "I found 3 agent-related files: a.ts, b.ts, c.ts.",
      providerId: "anthropic-sub",
      modelId: "claude-haiku-4-5-20251001",
      downgraded: false,
      downgradeMessage: null,
      inputTokens: 200,
      outputTokens: 80,
      inferenceMs: 400,
    });

    const result = await runAgenticLoop(baseParams);

    expect(result.content).toBe("I found 3 agent-related files: a.ts, b.ts, c.ts.");
    expect(result.executedTools).toHaveLength(1);

    // Verify the messages passed to the second callWithFailover call
    const secondCallMessages = mockFailover.mock.calls[1][0]; // first arg is messages
    // Should include: original user msg, assistant with toolCalls, tool result
    const assistantMsg = secondCallMessages.find((m: any) => m.role === "assistant" && m.toolCalls);
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.toolCalls[0].id).toBe("toolu_01A");

    const toolMsg = secondCallMessages.find((m: any) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.toolCallId).toBe("toolu_01A");
    expect(toolMsg.content).toContain("Found 3 files");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/agentic-loop.test.ts`
Expected: FAIL — agentic loop still creates text-based messages, not structured ones.

- [ ] **Step 3: Refactor the agentic loop tool-call iteration**

In `apps/web/lib/agentic-loop.ts`, replace the tool-call processing block (the `for (const tc of result.toolCalls)` loop) with the collect-then-append pattern from the spec:

```typescript
// Collect all immediate tool results for this iteration
const iterationResults: Array<{
  tc: { id: string; name: string; arguments: Record<string, unknown> };
  toolResult: ToolResult;
}> = [];

for (const tc of result.toolCalls) {
  const toolDef = tools.find((t) => t.name === tc.name);

  // Proposal tools — break the loop (unchanged)
  if (toolDef && toolDef.executionMode !== "immediate") {
    return { /* existing proposal return */ };
  }

  const toolResult = await executeTool(
    tc.name, tc.arguments, userId,
    { routeContext, agentId, threadId },
  );
  executedTools.push({ name: tc.name, result: toolResult });
  iterationResults.push({ tc, toolResult });
}

// Append ONE assistant message (with toolCalls) + N tool result messages
messages = [
  ...messages,
  {
    role: "assistant" as const,
    content: result.content,
    toolCalls: result.toolCalls,
  },
  ...iterationResults.map(({ tc, toolResult }) => ({
    role: "tool" as const,
    content: toolResult.success
      ? `${toolResult.message}${toolResult.data ? `\n${JSON.stringify(toolResult.data).slice(0, 3000)}` : ""}`
      : `Error: ${toolResult.error ?? "unknown error"}`,
    toolCallId: tc.id,
  })),
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/agentic-loop.test.ts`
Expected: PASS

- [ ] **Step 5: Add test for callWithFallbackChain path**

The test in step 1 exercises the `callWithFailover` (legacy) path. Add a second test with `routeDecision` to cover the manifest-routing path:

```typescript
it("creates structured messages via callWithFallbackChain when routeDecision is set", async () => {
  const mockFallbackChain = vi.mocked((await import("./routing/fallback")).callWithFallbackChain);
  const mockExecuteTool = vi.mocked(executeTool);

  mockFallbackChain.mockResolvedValueOnce({
    content: "Searching.",
    providerId: "anthropic-sub",
    modelId: "claude-haiku-4-5-20251001",
    downgraded: false,
    downgradeMessage: null,
    tokenUsage: { inputTokens: 100, outputTokens: 50 },
    toolCalls: [{ id: "toolu_02B", name: "search_project_files", arguments: { query: "agent" } }],
  });

  mockExecuteTool.mockResolvedValueOnce({ success: true, message: "Found 2 files" });

  mockFallbackChain.mockResolvedValueOnce({
    content: "Found 2 agent files.",
    providerId: "anthropic-sub",
    modelId: "claude-haiku-4-5-20251001",
    downgraded: false,
    downgradeMessage: null,
    tokenUsage: { inputTokens: 150, outputTokens: 60 },
    toolCalls: [],
  });

  const result = await runAgenticLoop({
    ...baseParams,
    routeDecision: { selectedEndpoint: "anthropic-sub", reason: "test", fallbackChain: [] } as any,
  });

  expect(result.content).toBe("Found 2 agent files.");
  const secondCallMessages = mockFallbackChain.mock.calls[1]?.[1]; // 2nd arg is messages for fallback chain
  const toolMsg = secondCallMessages?.find((m: any) => m.role === "tool");
  expect(toolMsg?.toolCallId).toBe("toolu_02B");
});
```

- [ ] **Step 6: Run existing tests for regression**

Run: `cd apps/web && npx vitest run lib/actions/agent-coworker.test.ts lib/actions/agent-coworker-server.test.ts`
Expected: PASS (may need mock updates for new `id` field)

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/agentic-loop.ts apps/web/lib/agentic-loop.test.ts
git commit -m "feat: agentic loop creates structured tool-calling messages (EP-AGENT-EXEC-002)"
```

---

### Task 5: Update Routing/Failover Types

**Files:**
- Modify: `apps/web/lib/ai-provider-priority.ts:30-35`
- Modify: `apps/web/lib/routing/fallback.ts:10-18`

- [ ] **Step 1: Update FailoverResult toolCalls type**

In `ai-provider-priority.ts`, `FailoverResult` extends `InferenceResult` which now has `id` in `toolCalls`. Verify no override is needed.

- [ ] **Step 2: Update FallbackResult toolCalls type**

In `routing/fallback.ts`, update `FallbackResult.toolCalls` to include `id`:

```typescript
toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
```

- [ ] **Step 3: Thread ChatMessage type through callWithFailover and callWithFallbackChain**

Both functions accept `messages: ChatMessage[]`. Since `ChatMessage` is now a union type, the existing function signatures continue to work. Verify with type check:

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/ai-provider-priority.ts apps/web/lib/routing/fallback.ts
git commit -m "feat: update routing types for structured tool call IDs (EP-AGENT-EXEC-002)"
```

---

### Task 6: End-to-End Verification and Cleanup

**Files:**
- Modify: `apps/web/lib/agentic-loop.ts` (simplify continuation nudge)
- Modify: `apps/web/lib/actions/agent-coworker.ts` (verify sanitization is still minimal)

- [ ] **Step 1: Run full test suite**

Run: `cd apps/web && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Type check the full app**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Manual verification with dev server**

Start dev server and test:
1. Open the agent panel on any page
2. Send a message that triggers tool use (e.g., "what backlog items are open?")
3. Verify the agent calls `query_backlog` and responds with results
4. Check server console for `[agentic-loop]` logs — verify `toolCalls > 0` on iteration 0, then text response on iteration 1
5. Test dev mode: enable dev mode, ask agent to search codebase — verify multi-step tool use works

- [ ] **Step 4: Simplify continuation nudge**

With structured messages, most stalling should be eliminated. Simplify the nudge to a single pattern: if the model returns text-only when tools are available and it has already used tools this session, nudge once. Remove the complex multi-pattern detection (postToolStall, toolIntentNarration, shortAck, emptyResponse, contamination) — these were band-aids for the text-based format.

- [ ] **Step 5: Review sanitization in agent-coworker.ts**

Review `apps/web/lib/actions/agent-coworker.ts` sanitization (around line 673). With proper structured tool calling, models won't narrate tool use as text. Verify the sanitization is minimal (only stripping: `Action: tool_name(...)`, `Self-correction:`, filler apologies, stalling language). Remove any patterns that were added as band-aids during the debugging session.

- [ ] **Step 6: Confirm diagnostic logging is preserved**

Verify that `[agentic-loop]` logging in `agentic-loop.ts` and `[quality-gate]` logging in `agent-coworker.ts` are still present. These are essential for diagnosing future issues and must not be removed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: complete structured tool-calling protocol (EP-AGENT-EXEC-002)"
```
