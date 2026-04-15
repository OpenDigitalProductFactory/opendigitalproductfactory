# Tool Use Model Compatibility — Specification

**Status:** Draft  
**Date:** 2026-04-12  
**Depends on:** EP-AGENT-EXEC-002 (`2026-03-18-structured-tool-calling-design.md`) — that spec fixed the outbound side (how tool history is serialized into requests). This spec fixes the inbound side (how tool calls are parsed from responses). Both must be in place for reliable multi-model tool use.  
**Relates to:** Phase 1–4 implementation briefs (unified capability lifecycle)  
**Owner:** Platform team  

---

## 1. Problem Statement

DPF supports multiple AI model families (OpenAI, Anthropic, Gemini, Gemma, Llama, Mistral, Phi, Qwen, etc.) via a unified OpenAI-compatible inference layer. The phrase "OpenAI-compatible" guarantees the `/v1/chat/completions` endpoint exists — it does NOT guarantee tool/function calling works consistently.

The specific failure mode that prompted this spec:

> Gemma 4 (and other local models served via Docker Model Runner or Ollama) emit tool calls as text strings in the `content` field rather than structured `tool_calls` objects. Argument JSON may contain unquoted keys or trailing commas. `finish_reason` is unreliable. `tool_choice: "required"` is silently ignored. The result is an agent that stops calling tools mid-task with no visible error.

This spec defines the canonical model compatibility matrix, the gaps in the current normalization layer, and the required changes to make tool use robust across all supported model families.

---

## 2. Scope

This spec covers:

- Format differences across model families (request format, response format, result return)
- Gaps in the current `extractTextualToolCalls()` fallback
- Invalid/malformed `arguments` JSON handling
- `tool_choice: "required"` enforcement via retry
- Pre-flight capability gating (don't send tools to models that can't use them)
- vLLM deployment configuration reference

This spec does NOT cover:

- Capability scoring / toolFidelity baselines (those live in `family-baselines.ts`)
- MCP tool definitions or the tool registry
- The agentic loop retry budget or cost policies

---

## 3. Model Family Compatibility Matrix

### 3.1 Request format

All model families accept the OpenAI `tools` array format via their serving layer (Ollama / Docker Model Runner / vLLM). The DPF adapters already convert to provider-native format for Anthropic and Gemini. No changes needed to request format for other families.

| Provider | Request format | Notes |
| --- | --- | --- |
| OpenAI (GPT-4o, GPT-4.1) | OpenAI native | Reference implementation |
| Anthropic (Claude) | Anthropic native | Adapter converts `{name, description, input_schema}` |
| Google Gemini (API) | Gemini native | Adapter converts `{functionDeclarations: [...]}` |
| OpenAI Responses API | Responses format | Separate adapter; flattened input array |
| All local models (Ollama, DMR, vLLM) | Standard OpenAI tools array | Serving layer handles model-native translation |

### 3.2 Response format — the core problem

| Model family | Expected response format | Actual response format | Text-leakage format |
| --- | --- | --- | --- |
| OpenAI GPT-4o/4.1 | `tool_calls` array | Always `tool_calls` array | None |
| Anthropic Claude | `content[].type=="tool_use"` | Always correct | None |
| Google Gemini | `parts[].functionCall` | Always correct | None |
| Gemma 3 (local) | `tool_calls` array | **Frequently leaks as text** | `<tool_call>{"name":"fn","arguments":{...}}</tool_call>` |
| Gemma 4 (local) | `tool_calls` array | **Sometimes leaks as text** | Same as Gemma 3; also `<\|tool_call>call: fn{key: val}<tool_call\|>` (JS-object variant) |
| Llama 3.1/3.2/3.3 (local) | `tool_calls` array | Mostly correct via Ollama 0.3+; leaks on old versions | `[TOOL_CALL] [{"name":"fn","parameters":{...}}]` — note: uses `parameters` not `arguments` |
| Llama 4 Scout (local) | `tool_calls` array | Mostly correct | Same as Llama 3.x when leaking |
| Mistral 7B (local) | `tool_calls` array | Correct via Ollama 0.3+; leaks on old versions | `[TOOL_CALLS] [{"name":"fn","arguments":{...}}]` |
| Mistral Large (API) | `tool_calls` array | Always correct | None |
| Phi-4 (local) | `tool_calls` array | Correct but malformed `arguments` | None (structured but JSON invalid) |
| Qwen 2.5 72B (local) | `tool_calls` array | Correct | None |
| Qwen 2.5 7B (local) | `tool_calls` array | Mostly correct | Rare leakage |

### 3.3 Tool result return format

| Provider | Role | ID field | Notes |
| --- | --- | --- | --- |
| OpenAI, Ollama, DMR, vLLM | `"tool"` | `tool_call_id` | Standard |
| Anthropic | `"user"` | `tool_use_id` (in content block `type: "tool_result"`) | Incompatible with OpenAI; existing adapter handles this |
| Gemini | `"user"` | N/A (no IDs) | Existing adapter generates synthetic IDs |

### 3.4 `finish_reason` reliability

Do NOT use `finish_reason === "tool_calls"` as the primary signal for tool-call detection.

| Source | `finish_reason` when tools called | Reliable? |
| --- | --- | --- |
| OpenAI | `"tool_calls"` | Yes |
| Anthropic | `"tool_use"` | Yes |
| Ollama (local) | Often `"stop"` even when tools called | **No** |
| Docker Model Runner | Often `"stop"` even when tools called | **No** |
| vLLM (configured parser) | `"tool_calls"` | Yes |
| vLLM (no parser) | `"stop"` | **No** |

**Required:** Primary tool-call detection must check `message.tool_calls?.length > 0` first. `finish_reason` is a secondary hint only.

### 3.5 Tool call ID stability

| Source | ID format | Stable/unique? |
| --- | --- | --- |
| OpenAI | `call_abc123` (UUID-style) | Yes |
| Anthropic | `toolu_01...` (prefixed) | Yes |
| Ollama/DMR | Sequential integers or short random strings | Partially — unique within a response, not guaranteed unique across turns |
| vLLM | Depends on model | Varies |
| Gemini | None — model doesn't emit IDs | Never |

The existing `synth_` prefix fallback in `ai-inference.ts` handles missing IDs. No change required, but the ID generation should use a proper UUID (not an incremental counter) to prevent cross-turn collisions in long agentic loops.

### 3.6 Parallel tool calls

Only offer `parallel_tool_calls: true` to models that reliably support it:

| Model family | Parallel tool calls |
| --- | --- |
| OpenAI GPT-4o/4.1 | Yes |
| Anthropic Claude 3+ Sonnet/Opus | Yes |
| Mistral Large (API) | Yes |
| Qwen 2.5 72B+ | Yes |
| Llama 4 Scout | Yes |
| All others (local 7B-14B, Gemma, Phi-4, Llama 3.x 8B) | **No — single tool at a time** |

---

## 4. Current Gaps and Required Fixes

### 4.1 Missing text-leakage format: Llama `[TOOL_CALL]` and Mistral `[TOOL_CALLS]`

**File:** `apps/web/lib/inference/ai-inference.ts`, function `extractTextualToolCalls()`

**Current coverage:**

- `<tool_call>{...}</tool_call>` — Gemma/Hermes JSON format ✓
- `<|tool_call>call: fn{...}<tool_call|>` — Gemma template JS-object variant ✓

**Missing coverage:**

- `[TOOL_CALL] [{"name":"fn","parameters":{...}}]` — Llama 3.x native (note: `parameters` key, not `arguments`)
- `[TOOL_CALLS] [{"name":"fn","arguments":{...}}]` — Mistral native

**Fix:** Add two additional regex cases to `extractTextualToolCalls()`:

```typescript
// Llama 3.x format: [TOOL_CALL] [{...}]
const llamaPattern = /\[TOOL_CALL\]\s*\[(.+?)\](?:\s*<\|eot_id\|>)?/gs;

// Mistral format: [TOOL_CALLS] [{...}]
const mistralPattern = /\[TOOL_CALLS\]\s*\[(.+?)\]/gs;
```

For Llama format: the field is `parameters` not `arguments`. Normalize to `arguments` when extracting:
```typescript
toolCalls.push({
  id: `text_${Date.now()}_${i}`,
  name: parsed.name,
  arguments: parsed.arguments ?? parsed.parameters ?? {},  // normalize both keys
});
```

### 4.2 Invalid JSON in `arguments`

**Scope:** All local model families can produce malformed `arguments` JSON.

**Common failure modes:**

1. Trailing commas: `{"key": "value",}` — invalid JSON
2. Unquoted keys: `{location: "London"}` — JS object literal, not JSON
3. Single quotes: `{'key': 'value'}` — invalid JSON
4. Truncated JSON: `{"key": "val` — incomplete response

**Fix:** Add a `repairArgumentsJson()` function in `ai-inference.ts`:

```typescript
function repairArgumentsJson(raw: string): Record<string, unknown> {
  // 1. Try standard parse first
  try {
    return JSON.parse(raw);
  } catch {}

  // 2. Remove trailing commas before } or ]
  const trailingCommaFixed = raw.replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(trailingCommaFixed);
  } catch {}

  // 3. Quote unquoted keys (simple heuristic for shallow objects)
  const unquotedKeyFixed = trailingCommaFixed.replace(
    /([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g,
    '$1"$2"$3'
  );
  try {
    return JSON.parse(unquotedKeyFixed);
  } catch {}

  // 4. Replace single-quoted strings with double-quoted
  const singleQuoteFixed = unquotedKeyFixed.replace(/'/g, '"');
  try {
    return JSON.parse(singleQuoteFixed);
  } catch {}

  // 5. Truncated — attempt to close open structures
  // This is best-effort; if it fails, return empty object and log warning
  console.warn("[tool-use] Could not parse tool arguments JSON:", raw);
  return {};
}
```

Call `repairArgumentsJson()` instead of `JSON.parse()` everywhere `arguments` is parsed from a model response.

### 4.3 `tool_choice: "required"` enforcement

**Problem:** Local models silently ignore `tool_choice: "required"`. The agentic loop receives a text-only response and treats the task as complete.

**Fix:** In the agentic loop (`apps/web/lib/tak/agentic-loop.ts`), after any iteration where:

- Tools are available
- The execution plan's `toolPolicy.toolChoice === "required"`
- The response contains no `toolCalls` (empty array)
- The response is not a final answer (no explicit completion signal)

...inject a retry message and call again, up to a configurable `toolRequiredRetries` limit (default: 2):

```typescript
// Pseudo-code for agentic loop retry
if (
  plan.toolPolicy?.toolChoice === "required" &&
  result.toolCalls.length === 0 &&
  !isTerminalResponse(result.text) &&
  toolRequiredRetryCount < MAX_TOOL_REQUIRED_RETRIES
) {
  messages = [
    ...messages,
    { role: "assistant", content: result.text },
    {
      role: "user",
      content:
        "You must use one of the available tools to complete this step. " +
        "Please call the appropriate tool now rather than answering from memory.",
    },
  ];
  toolRequiredRetryCount++;
  continue; // next iteration
}
```

**Note:** Only apply this retry for local models. For OpenAI and Anthropic, `tool_choice: "required"` is reliably honored and a retry would indicate a bug elsewhere.

Identify local models via `executionPlan.providerId` being `"ollama"`, `"docker-model-runner"`, or any provider where `adapter === "chat"` and the base URL is `model-runner.docker.internal`.

### 4.4 Pre-flight capability gating

**Problem:** Tools are currently sent to all models regardless of the `capabilities.toolUse` flag.

**Fix:** In the chat adapter dispatch (`apps/web/lib/routing/chat-adapter.ts`), before building the request body:

```typescript
const effectiveTools =
  plan.capabilities?.toolUse === false ? [] : (request.tools ?? []);
```

If `toolUse` is `false`, send no tools. Do not error — some requests are fine as text-only even if the original caller sent tools.

**Note:** `toolUse: null` means unknown (not confirmed unsupported). Pass tools through for `null` — the model may still handle them via text-leakage fallback.

### 4.5 Synthetic tool call ID should use UUID

**Current:** `synth_${Date.now()}_${index}` — timestamp + index.

**Problem:** Long agentic loops across multiple turns can produce colliding IDs if two tool calls happen within the same millisecond or if indexes restart.

**Fix:** Use `crypto.randomUUID()` or a short random hex suffix:
```typescript
const id = `synth_${Math.random().toString(36).slice(2, 10)}`;
```

---

## 5. vLLM Deployment Configuration Reference

If deploying DPF models via vLLM (not Ollama or Docker Model Runner), the `--tool-call-parser` flag must match the model family. Without it, vLLM passes raw model output through as `content` text.

| Model family | vLLM startup flag |
| --- | --- |
| Llama 3.x, Llama 4 | `--tool-call-parser llama3_json` |
| Mistral, Mixtral | `--tool-call-parser mistral` |
| Gemma 3/4, Hermes | `--tool-call-parser hermes` |
| Qwen 2.5+ | `--tool-call-parser hermes` or `--tool-call-parser llama3_json` (test both) |
| Phi-4 | `--tool-call-parser pythonic` |

Always combine with:
```
--enable-auto-tool-choice
```

Without `--enable-auto-tool-choice`, tool calls are suppressed even with the parser configured.

When DPF detects a vLLM endpoint, log a warning if `--tool-call-parser` is not configured for the model family. Detection: presence of vLLM-specific response headers or provider configuration flag.

---

## 6. Docker Model Runner Notes

Docker Model Runner (Docker Desktop 4.40+) uses llama.cpp as the inference backend. Key differences from Ollama:

- **No per-model capability advertisement** — `/v1/models` returns model IDs only, no capability flags. DPF must infer tool support from model family name after stripping the `ai/` prefix.

- **Template handling differs from Ollama** — The same model version may behave differently between DMR and Ollama. Gemma 4 specifically has higher text-leakage rates via DMR than via Ollama on the same hardware.

- **Namespace:** All models use `ai/` prefix (e.g., `ai/gemma4`, `ai/llama4`). The existing `extractModelFamily()` function already strips this prefix — no change needed.

- **No `tool_choice` enforcement at the serving layer** — Same as Ollama. Section 4.3 retry logic applies.

---

## 7. Acceptance Criteria

- [ ] `extractTextualToolCalls()` handles all four leakage formats: `<tool_call>`, `<|tool_call>`, `[TOOL_CALL]`, `[TOOL_CALLS]`. Field name `parameters` is normalized to `arguments`.
- [ ] `repairArgumentsJson()` is called instead of bare `JSON.parse()` everywhere tool arguments are parsed. Malformed JSON from local models logs a warning but does not throw.
- [ ] Agentic loop retries up to 2 times when `tool_choice: "required"` and no tool calls returned, for local model providers only.
- [ ] Chat adapter skips tools entirely when `capabilities.toolUse === false`.
- [ ] Synthetic tool call IDs use random suffix (not timestamp-based) to prevent cross-turn collisions.
- [ ] `finish_reason` is not the primary detector of tool calls in any code path — `tool_calls.length > 0` is used instead.
- [ ] Unit tests for `repairArgumentsJson()` cover: valid JSON (passthrough), trailing comma, unquoted keys, single quotes, truncated input.
- [ ] Unit tests for `extractTextualToolCalls()` cover all four text-leakage formats.
- [ ] TypeScript and lint pass with no new warnings.

---

## 8. What NOT to do

- Do not add a new `toolFormat` field to the model card or provider config — format is inferred from provider + serving layer, not declared.

- Do not require callers to specify which text-leakage format a model uses — detection must be automatic.

- Do not implement a full JSON repair library — the lightweight `repairArgumentsJson()` above handles the documented failure modes. Use a library only if that function proves insufficient in practice.

- Do not change the canonical `ToolCallEntry` type (`{ id, name, arguments }`) — all extraction paths must normalize to this shape.

- Do not add Anthropic-format or Gemini-format handling to the OpenAI-compat adapter path — those providers have their own adapters.
