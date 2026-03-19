# EP-AGENT-EXEC-002: Structured Tool-Calling Protocol for Agentic Loop — Design Spec

**Date:** 2026-03-18
**Extends:** EP-AGENT-EXEC-001 (Agent Task Execution with HITL Governance)
**Goal:** Replace the agentic loop's text-based tool-call/result messages with the provider-native structured protocol (Anthropic `tool_use`/`tool_result` blocks, OpenAI `tool_calls`/`tool` role messages), so models operate in the format they were trained on.

**Problem:** The agentic loop (not part of the original EP-AGENT-EXEC-001 spec) was added to support immediate tools (search, query) that execute without human approval. It works by iterating: call LLM → execute tools → feed results back → call LLM again. But it feeds results back as **fabricated text messages**:

```
assistant: "I used search project files to help with this."
user: "Done — search project files: Found 3 files..."
```

Models were trained on structured tool-calling protocol:

```json
// Anthropic
{"role": "assistant", "content": [
    {"type": "text", "text": "Searching..."},
    {"type": "tool_use", "id": "toolu_01A", "name": "search_project_files", "input": {"query": "agent"}}
]},
{"role": "user", "content": [
    {"type": "tool_result", "tool_use_id": "toolu_01A", "content": "Found 3 files..."}
]}

// OpenAI-compatible
{"role": "assistant", "content": "Searching...", "tool_calls": [
    {"id": "call_abc", "type": "function", "function": {"name": "search_project_files", "arguments": "{\"query\":\"agent\"}"}}
]},
{"role": "tool", "tool_call_id": "call_abc", "content": "Found 3 files..."}
```

The text-based format causes:
1. **Model confusion** — the model doesn't see its own tool_use blocks, loses context about what it did
2. **Narration instead of action** — model outputs "Let me search..." as text instead of calling tools
3. **Format mimicry** — model copies internal message formatting (e.g., outputs `[Calling tool_name]` as text)
4. **Degrading multi-step performance** — each iteration compounds confusion as the fabricated history grows

This is the root cause of all observed agent stalling behaviors: permission-asking, narration without tool calls, empty responses, and the quality-gate fallback.

---

## 1. ChatMessage Type Extension

Current type (`ai-inference.ts:11-14`):
```typescript
export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};
```

Extended type:
```typescript
export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentBlock[];
  /** Tool calls the assistant made (present when role=assistant and model called tools) */
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  /** For role=tool messages: which tool call this result responds to */
  toolCallId?: string;
};

/** Anthropic-style content blocks for structured messages */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };
```

**Design decisions:**
- `content` becomes `string | ContentBlock[]` — backward-compatible. All existing code that passes `string` continues to work.
- `toolCalls` on the message carries the structured tool call data for re-serialization.
- `role: "tool"` is only used for OpenAI-compatible providers (Anthropic uses `role: "user"` with `tool_result` content blocks).
- The `id` field is preserved from the provider's response — this is the critical missing piece. Anthropic requires `tool_use_id` to match between `tool_use` and `tool_result`. OpenAI requires `tool_call_id` to match between `tool_calls` and `tool` role messages.

---

## 2. InferenceResult Tool Call IDs

Current (`ai-inference.ts:21`):
```typescript
toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
```

Extended:
```typescript
toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
```

The `id` field is populated from:
- **Anthropic:** `content[].id` on `tool_use` blocks
- **OpenAI-compatible:** `tool_calls[].id` on the message object

---

## 3. callProvider Message Formatting

The `callProvider` function in `ai-inference.ts` currently maps all messages as `{ role, content: string }`. It needs provider-specific formatting for structured messages.

### Anthropic Path

When a message has `toolCalls` (assistant made tool calls):
```typescript
// Instead of: { role: "assistant", content: "text" }
// Emit:
{
  role: "assistant",
  content: [
    ...(msg.content ? [{ type: "text", text: typeof msg.content === "string" ? msg.content : "" }] : []),
    ...msg.toolCalls.map(tc => ({
      type: "tool_use",
      id: tc.id,
      name: tc.name,
      input: tc.arguments,
    })),
  ]
}
```

When a message has `role: "tool"` (tool result):
```typescript
// Convert to Anthropic's format: role=user with tool_result content block
// Anthropic requires tool results to be in a user message
{
  role: "user",
  content: [{
    type: "tool_result",
    tool_use_id: msg.toolCallId,
    content: typeof msg.content === "string" ? msg.content : "",
  }]
}
```

### OpenAI-compatible Path

When a message has `toolCalls`:
```typescript
{
  role: "assistant",
  content: typeof msg.content === "string" ? msg.content : "",
  tool_calls: msg.toolCalls.map(tc => ({
    id: tc.id,
    type: "function",
    function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
  })),
}
```

When a message has `role: "tool"`:
```typescript
{
  role: "tool",
  tool_call_id: msg.toolCallId,
  content: typeof msg.content === "string" ? msg.content : "",
}
```

### Backward Compatibility

Messages without `toolCalls` or `toolCallId` format exactly as before: `{ role, content: string }`. This means all existing callers (non-agentic-loop paths) continue to work without changes.

---

## 4. Agentic Loop Changes

`apps/web/lib/agentic-loop.ts` — the loop creates proper structured messages instead of fabricated text.

### After executing an immediate tool:

**Current (broken):**
```typescript
messages = [
  ...messages,
  { role: "assistant", content: result.content || `I used ${toolLabel} to help with this.` },
  { role: "user", content: `Done — ${toolLabel}: ${result.message}...` },
];
```

**New (structured):**
```typescript
messages = [
  ...messages,
  {
    role: "assistant" as const,
    content: result.content,
    toolCalls: result.toolCalls, // preserve the full structured tool calls from the LLM response
  },
  // One tool-result message per tool call (providers require 1:1 matching)
  ...executedInThisIteration.map(({ tc, toolResult }) => ({
    role: "tool" as const,
    content: toolResult.success
      ? `${toolResult.message}${toolResult.data ? `\n${JSON.stringify(toolResult.data).slice(0, 3000)}` : ""}`
      : `Error: ${toolResult.error ?? "unknown error"}`,
    toolCallId: tc.id,
  })),
];
```

**Key changes:**
- The assistant message preserves `toolCalls` from the LLM response — `callProvider` will re-serialize them in the provider's native format.
- Each tool result is a separate `role: "tool"` message with `toolCallId` linking it to the specific tool call.
- No more fabricated text — the model sees its own history in the exact format it produced.

### Tool call iteration refactor

The current loop processes tool calls inside a `for (const tc of result.toolCalls)` loop and appends messages PER tool call. The new approach collects all tool results from one iteration, then appends ONE assistant message + N tool result messages:

```typescript
// Collect all tool results for this iteration
const iterationResults: Array<{ tc: ToolCall; toolResult: ToolResult }> = [];

for (const tc of result.toolCalls) {
  const toolDef = tools.find((t) => t.name === tc.name);

  // Proposal tools — break the loop (unchanged)
  if (toolDef && toolDef.executionMode !== "immediate") {
    return { /* proposal */ };
  }

  const toolResult = await executeTool(tc.name, tc.arguments, userId, { routeContext, agentId, threadId });
  executedTools.push({ name: tc.name, result: toolResult });
  iterationResults.push({ tc, toolResult });
}

// Append structured messages for this iteration
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

### Continuation nudge

The continuation nudge logic (detecting stalled intent) remains. It's a safety net for models that still don't call tools despite seeing proper structured history. The nudge messages remain as simple text (role: "user", content: string) — they're user-level prompts, not tool protocol messages.

---

## 5. Dev Mode Considerations

The agent panel's dev mode (`devMode` state in `AgentCoworkerPanel.tsx`) forces `coworkerMode: "act"` and `externalAccessEnabled: true`, unlocking all side-effecting tools including codebase access (`search_project_files`, `read_project_file`, `write_project_file`). These tools are immediate-mode and run through the agentic loop.

Dev mode benefits directly from this fix — codebase tools require multi-step tool use (search → read → analyze → propose changes), and the current text-based format is especially problematic for these longer chains. Proper structured messages will let the model maintain coherent context across 4-6 iterations of tool use.

No changes to dev mode logic itself — it's purely a routing/permissions feature. The fix is in the transport layer below it.

---

## 6. Files Affected

### Modified Files

| File | Change |
|------|--------|
| `apps/web/lib/ai-inference.ts` | Extend `ChatMessage` and `InferenceResult` types. Update `callProvider` message formatting for Anthropic, OpenAI-compatible, and Gemini paths to handle structured messages. Preserve tool call IDs in response parsing. |
| `apps/web/lib/agentic-loop.ts` | Replace text-based tool call/result messages with structured `ChatMessage` objects. Refactor tool call iteration to collect results before appending messages. |
| `apps/web/lib/ai-provider-priority.ts` | Update `FailoverResult` type to include `id` in `toolCalls`. Thread `ChatMessage` type change through `callWithFailover`. |
| `apps/web/lib/routing/fallback.ts` | Update `FallbackResult` type to include `id` in `toolCalls`. Thread `ChatMessage` type change through `callWithFallbackChain`. |

### Test Files

| File | Change |
|------|--------|
| `apps/web/lib/agentic-loop.test.ts` (new) | Unit tests for structured message construction, tool call ID preservation, multi-tool iteration, proposal break, max iterations. |
| `apps/web/lib/actions/agent-coworker.test.ts` | Update mocks to include tool call IDs in mock LLM responses. |

### No Changes Required

| File | Reason |
|------|--------|
| `apps/web/lib/mcp-tools.ts` | Tool definitions and execution unchanged — only the message format changes. |
| `apps/web/lib/actions/proposals.ts` | Proposal approval flow unchanged — operates on stored proposal data, not live messages. |
| `apps/web/components/agent/*` | UI components unchanged — they receive the final `AgentMessageRow`, not internal loop messages. |
| `apps/web/lib/prompt-assembler.ts` | System prompt unchanged — the new rules 13-14 are independent of message format. |
| `apps/web/lib/actions/agent-coworker.ts` | Sanitization and quality gate unchanged — they operate on the final text content, not internal messages. |

---

## 7. Backward Compatibility

- **ChatMessage `content: string`** — all existing code passes strings. The union type `string | ContentBlock[]` accepts both. The structured form is only used inside the agentic loop.
- **callProvider with string messages** — the formatting code checks `typeof msg.content === "string"` and handles the simple case identically to today.
- **Providers without tool support** — if `tools` parameter is omitted, no structured messages are created. The agentic loop only creates structured messages when it has tool calls to represent.
- **Gemini path** — Gemini's tool calling format (`functionCall` / `functionResponse`) is different from both Anthropic and OpenAI. For now, Gemini continues with text-based messages (it's not a primary provider). A future task can add Gemini structured support.

---

## 8. Cleanup: Revert Ad-Hoc Fixes

This spec supersedes all the ad-hoc fixes applied during the debugging session (2026-03-18). After implementation, the following should be cleaned up:

1. **Continuation nudge patterns** (agentic-loop.ts) — keep the nudge as a safety net but simplify. With proper structured messages, most stalling should be eliminated. The nudge only needs to catch the case where a model returns text-only when it should call tools.
2. **Sanitization** (agent-coworker.ts) — the aggressive-then-reduced sanitization can be reviewed. With proper tool calling, models won't narrate tool use as text. Keep only the minimal set (apology filler, self-correction monologue).
3. **Diagnostic logging** (agentic-loop.ts, agent-coworker.ts) — keep the `[agentic-loop]` and `[quality-gate]` logging permanently. It's essential for diagnosing future issues.

---

## 9. Testing Strategy

- **Unit test: ChatMessage formatting** — verify that `callProvider` formats structured messages correctly for Anthropic (tool_use content blocks, tool_result in user messages) and OpenAI-compatible (tool_calls field, tool role messages).
- **Unit test: Tool call ID preservation** — verify that tool call IDs from the LLM response are preserved through `InferenceResult` and into the next iteration's messages.
- **Unit test: Agentic loop message construction** — mock `callWithFailover`/`callWithFallbackChain` to return responses with tool calls. Verify the loop creates proper structured messages with correct IDs and tool results.
- **Unit test: Backward compatibility** — verify that `callProvider` with plain string `ChatMessage` objects produces identical request bodies to today.
- **Integration test: Multi-step tool use** — end-to-end test with a real provider (Haiku) making 2+ tool calls across iterations. Verify the model receives its own tool_use history and produces correct follow-up tool calls.
- **Regression test: Proposal flow** — verify the proposal break (non-immediate tools) still works correctly with structured messages.

---

## 10. Iteration Limit: Safety Ceiling, Not Behavioral Limit

**Previous value:** `MAX_ITERATIONS = 6`
**New value:** `MAX_ITERATIONS = 25`

**Rationale:** The Anthropic API's agentic loop pattern (documented in the TypeScript SDK) uses `stop_reason === "end_turn"` as the termination condition — the model decides when it's done. The SDK's `maxTurns` parameter is a safety ceiling, not a behavioral limit. Our loop already terminates correctly when the model responds with text only (no tool calls). The `MAX_ITERATIONS` constant should serve the same purpose as `maxTurns`: preventing runaway loops, not choking off productive work.

**Evidence from debugging session (2026-03-18):** Server logs showed `executedTools=13` at `iter=4` — the model was actively searching and reading 13 files across 4 iterations, leaving only 2 iterations for synthesis before hitting the ceiling. The fallback message "I've completed the available actions" appeared when the model was mid-workflow, misleading the user into thinking the agent had finished when it had been cut off.

**Why 25:** Complex agentic workflows (search → read multiple files → analyze → design → propose) can legitimately require 10-15 iterations. 25 provides headroom without being unlimited. If a model hits 25 iterations, it is genuinely stuck — the fallback message now says "I ran into a limit" and the event is logged with `[agentic-loop] hit MAX_ITERATIONS` for monitoring.

**Cost guardrail:** Each iteration is a full LLM call. At 25 iterations with Haiku ($1/M input), a worst-case loop costs roughly $0.10-0.25 depending on context size. This is acceptable for agentic workflows. If cost becomes a concern, a per-conversation budget can be added as a separate control (not an iteration count).

---

## 11. Not in Scope

- **Gemini structured tool calling** — Gemini uses `functionCall`/`functionResponse` parts. Not a priority provider; can be added later.
- **Streaming** — the agentic loop processes complete responses. Streaming tool calls is a future enhancement.
- **Parallel tool execution** — tools are currently executed sequentially. Parallel execution is a future optimization.
- **Multi-proposal per message** — still v1 constraint from EP-AGENT-EXEC-001.
