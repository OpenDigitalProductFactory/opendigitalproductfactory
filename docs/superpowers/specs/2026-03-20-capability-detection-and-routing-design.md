> **⚠️ SUPERSEDED** — this design doc captures an earlier iteration of routing. See [2026-04-20-routing-architecture-current.md](./2026-04-20-routing-architecture-current.md) for the current authoritative architecture.

# EP-INF-008b-ext: Capability Detection & Agent Routing Surface

**Date:** 2026-03-20
**Status:** Approved
**Author:** Mark Bodman (CEO) + Claude (COO/design partner)
**Epic:** EP-INF-008b extension

**Prerequisites:**
- EP-INF-008a/008b (Execution Adapter Framework + Tool-Based Capabilities) — implemented
- Provider adapters (adapter-anthropic.ts, adapter-gemini.ts, adapter-openrouter.ts) — implemented
- Task classifier (task-classifier.ts, task-types.ts) — implemented
- Agent co-worker routing (agent-coworker.ts, agent-coworker-types.ts) — implemented

---

## Problem Statement

EP-INF-008b built the routing pipeline to filter, seed, and dispatch based on `codeExecution`, `webSearch`, and `computerUse` capabilities. But:

1. **No data in the pipeline.** Only Anthropic's adapter extracts `codeExecution` from its API. No adapter detects `webSearch` or `computerUse`. All three fields are `null` for Gemini and OpenRouter models.

2. **No requests into the pipeline.** The agent co-worker call site passes `sensitivity` and `interactionMode` into `routeContext` but never passes `requiresCodeExecution`, `requiresWebSearch`, or `requiresComputerUse`. The task classifier doesn't emit capability hints.

Without data supply (adapters) and demand signals (agents), the EP-INF-008b infrastructure is dormant.

---

## Part 1: Adapter Enrichment

### Anthropic Adapter

**Current state:** `codeExecution` extracted from API `capabilities.code_execution.supported`. Other capabilities from API where available.

**Add:**
- `computerUse`: Curated — `true` for models matching `claude-sonnet-4` and `claude-opus-4` families (the models Anthropic documents as supporting computer use). Pattern: `/^claude-(sonnet|opus)-4/`.
- `webSearch`: Leave `null` — Anthropic doesn't offer built-in web search grounding.

### Gemini Adapter

**Current state:** Only `toolUse` detected from `supportedGenerationMethods`.

**Add to `extractCapabilities()`:**
- `codeExecution`: `true` when `supportedGenerationMethods` includes `"generateContent"` AND model ID matches Gemini 2.0+ pattern (`/^gemini-2/`). Code execution is a Gemini 2.0+ feature.
- `webSearch`: `true` when `supportedGenerationMethods` includes `"generateContent"` AND model ID matches Gemini 1.5+ (`/^gemini-(1\.5|2)/`). Google Search grounding is available on these models.
- `streaming`: `true` when `supportedGenerationMethods` includes `"streamGenerateContent"`.

### OpenRouter Adapter

**Current state:** `toolUse`, `structuredOutput`, `streaming`, `imageInput`, `pdfInput` from `supported_parameters`.

**Add to `extractCapabilities()`:**
- `webSearch`: `true` when `pricing.web_search` is present and non-zero (indicates the model supports web search and has pricing for it).
- `codeExecution` and `computerUse`: Leave `null` — OpenRouter doesn't expose these in its API. The upstream provider's adapter handles detection when used directly.

### OpenAI & Ollama Adapters

No changes. OpenAI's list API exposes no capability metadata. Ollama is local-only with no provider tools.

---

## Part 2: Task Classifier Capability Hints

### Extended Types

```typescript
// task-types.ts
export type TaskTypeDefinition = {
  // ... existing fields
  capabilityHints?: {
    requiresCodeExecution?: boolean;
    requiresWebSearch?: boolean;
    requiresComputerUse?: boolean;
  };
};

// task-classifier.ts
export type ClassificationResult = {
  taskType: string;
  confidence: number;
  requiresCodeExecution?: boolean;
  requiresWebSearch?: boolean;
  requiresComputerUse?: boolean;
};
```

### Capability Hints on Task Types

| Task Type | Capability Hint | Rationale |
|---|---|---|
| `code-gen` | — | Code generation doesn't inherently need code *execution*. Most requests want code written, not run. |
| `web-search` | `requiresWebSearch: true` | Already handled by `inferContract()` mapping `taskType === "web-search"` → `requiresWebSearch`. Adding the hint makes it explicit in the task type definition too. |
| Others | — | No standing capability hints. |

### Message-Level Capability Detection

In addition to task-type-level hints, `classifyTask()` gains message-level pattern matching for capabilities:

```typescript
// After task type scoring, check for capability-specific patterns
const requiresCodeExecution = /\b(run|execute|eval)\b.*\b(code|script|program|python|javascript)\b/i.test(message)
  || /\b(run (this|that|it|the code))\b/i.test(message);

const requiresComputerUse = /\b(click|navigate|fill (out|in)|browse|open (the |a )?(site|page|url|form))\b/i.test(message)
  || /\b(computer use|browser (control|automation))\b/i.test(message);
```

These fire regardless of task type — "run this code" classified as `code-gen` gets `requiresCodeExecution: true`, but "run this code" classified as `tool-action` also gets it.

`requiresWebSearch` is already handled by task type detection + `inferContract()`.

---

## Part 3: Agent Model Requirements

### Extended Type

```typescript
// agent-coworker-types.ts
export type AgentModelRequirements = {
  // ... existing fields
  requiredCapabilities?: Array<"codeExecution" | "webSearch" | "computerUse">;
};
```

### Merge at Call Site

In `agent-coworker.ts` at the `inferContract()` call site (lines 488-497), merge both paths:

```typescript
const contract = await inferContract(
  classification.taskType,
  chatHistory,
  toolsForProvider,
  undefined,
  {
    sensitivity: routeCtx.sensitivity,
    interactionMode: "sync",
    requiresCodeExecution:
      modelReqs?.requiredCapabilities?.includes("codeExecution")
      || classification.requiresCodeExecution
      || undefined,
    requiresWebSearch:
      modelReqs?.requiredCapabilities?.includes("webSearch")
      || classification.requiresWebSearch
      || undefined,
    requiresComputerUse:
      modelReqs?.requiredCapabilities?.includes("computerUse")
      || classification.requiresComputerUse
      || undefined,
  },
);
```

The `|| undefined` ensures falsy values don't set the flag (unset = no preference, not `false`).

No agent definitions need to change now — `requiredCapabilities` is optional. Agents that need standing capabilities can be configured later.

---

## Files Summary

### Modified Files

| File | Change |
|---|---|
| `apps/web/lib/routing/adapter-anthropic.ts` | Add `computerUse` detection via model ID pattern |
| `apps/web/lib/routing/adapter-gemini.ts` | Add `codeExecution`, `webSearch`, `streaming` detection |
| `apps/web/lib/routing/adapter-openrouter.ts` | Add `webSearch` detection from pricing |
| `apps/web/lib/task-types.ts` | Add `capabilityHints` to `TaskTypeDefinition`, add `requiresWebSearch` to `web-search` |
| `apps/web/lib/task-classifier.ts` | Extend `ClassificationResult`, add message-level capability detection |
| `apps/web/lib/agent-coworker-types.ts` | Add `requiredCapabilities` to `AgentModelRequirements` |
| `apps/web/lib/actions/agent-coworker.ts` | Merge capability flags into `routeContext` at `inferContract()` call |

### Test Files

| File | Change |
|---|---|
| `apps/web/lib/routing/adapter-anthropic.test.ts` | Add tests for `computerUse` detection |
| `apps/web/lib/routing/adapter-gemini.test.ts` | Add tests for `codeExecution`, `webSearch`, `streaming` |
| `apps/web/lib/routing/adapter-openrouter.test.ts` | Add tests for `webSearch` from pricing |
| `apps/web/lib/task-classifier.test.ts` | Create — tests for capability hint emission |

### Unchanged

All EP-INF-008a/008b files: `request-contract.ts`, `pipeline-v2.ts`, `provider-tools.ts`, `chat-adapter.ts`, `recipe-seeder.ts`, `execution-adapter-registry.ts`.

---

## Testing Strategy

**Adapter tests:**
- Anthropic: `claude-sonnet-4-5` → `computerUse: true`; `claude-haiku-4-5` → `computerUse: null` (Haiku doesn't support it); `claude-3-opus` → `computerUse: null`
- Gemini: model with `generateContent` + `gemini-2.0-flash` → `codeExecution: true, webSearch: true`; `gemini-1.5-pro` → `webSearch: true, codeExecution: null`; embedding model → all `null`
- OpenRouter: model with `pricing.web_search: "0.005"` → `webSearch: true`; model without → `webSearch: null`

**Classifier tests:**
- "run this code and show output" → `requiresCodeExecution: true`
- "click the submit button on the form" → `requiresComputerUse: true`
- "search the web for recent news" → `taskType: "web-search"` (webSearch handled by inferContract)
- "hello" → no capability flags
- "write a function to sort a list" → no `requiresCodeExecution` (writing code ≠ running code)

**Integration (no new test file — verified by existing pipeline-v2 tests):**
- If adapter sets `codeExecution: true` on a model AND contract has `requiresCodeExecution: true`, model passes hard filter
- If adapter leaves `codeExecution: null` AND contract requires it, model excluded
