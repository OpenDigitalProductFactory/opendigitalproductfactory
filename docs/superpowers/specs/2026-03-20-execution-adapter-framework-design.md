# EP-INF-008a/008b: Execution Adapter Framework & Tool-Based Capabilities

**Date:** 2026-03-20
**Status:** Approved
**Author:** Mark Bodman (CEO) + Claude (COO/design partner)
**Epics:** EP-INF-008a (Execution Adapter Framework), EP-INF-008b (Tool-Based Capabilities)

**Prerequisites:**
- EP-INF-003 through EP-INF-006 (routing redesign) — implemented (521 tests, 28 test files)
- EP-INF-005b (Execution Recipes) — provides the recipe abstraction, `RoutedExecutionPlan`, `callProvider()` integration

**Parent spec:**
- [2026-03-20-specialized-model-capabilities-design.md](2026-03-20-specialized-model-capabilities-design.md) — EP-INF-008 umbrella with 4 sub-epics

---

## Problem Statement

The routing redesign built a comprehensive pipeline for chat and reasoning models. `callProvider()` already dispatches per-provider (Anthropic/Gemini/OpenAI-compat branches) and accepts a `RoutedExecutionPlan` from EP-INF-005b. But:

1. **No adapter abstraction.** The per-provider dispatch is inlined in `callProvider()`. There's no way to add non-chat execution patterns (image generation, audio, async/long-running) without further bloating that function.

2. **No provider tool injection.** Models like Gemini support `code_execution` and `google_search_retrieval` as provider-level tool declarations. Anthropic supports `computer_20241022` tool types. These capabilities are discovered and recorded on ModelCards, but there's no path from capability → recipe → request body.

3. **No capability-based routing.** `routeEndpointV2()` filters on hard constraints (tool use, structured output, streaming, image input) but not on specialized capabilities like code execution or web search. A request that needs grounded web search can't prefer models that support it natively.

---

## EP-INF-008a: Execution Adapter Framework

### Section 1: Adapter Interface

Every adapter implements a common interface. The `"chat"` adapter wraps the existing `callProvider()` per-provider logic. Future adapters (`"image_gen"`, `"audio"`, `"async"`) register alongside it.

```typescript
// apps/web/lib/routing/adapter-types.ts

interface AdapterRequest {
  providerId: string;
  modelId: string;
  plan: RoutedExecutionPlan;
  messages: ChatMessage[];
  systemPrompt: string;
  tools?: Array<Record<string, unknown>>;
}

interface AdapterResult {
  text: string;
  toolCalls: ToolCallResult[];
  usage: { inputTokens: number; outputTokens: number };
  inferenceMs: number;
  raw?: Record<string, unknown>;
}

interface ExecutionAdapterHandler {
  type: string;
  execute(request: AdapterRequest): Promise<AdapterResult>;
}
```

`AdapterRequest` encapsulates everything the adapter needs. `AdapterResult` is the normalized output. The `raw` field preserves the full provider response for debugging.

### Section 2: Adapter Registry

A typed `Map<string, ExecutionAdapterHandler>` with registration and lookup:

```typescript
// apps/web/lib/routing/execution-adapter-registry.ts

const adapters = new Map<string, ExecutionAdapterHandler>();

function registerAdapter(adapter: ExecutionAdapterHandler): void;
function getAdapter(type: string): ExecutionAdapterHandler;  // throws if not found
function hasAdapter(type: string): boolean;
```

The chat adapter is registered at module load time. No dynamic loading, no plugin system — a static map.

### Section 3: Chat Adapter

The default `"chat"` adapter extracts the existing per-provider branches from `callProvider()`:

```typescript
// apps/web/lib/routing/chat-adapter.ts

const chatAdapter: ExecutionAdapterHandler = {
  type: "chat",
  async execute(request: AdapterRequest): Promise<AdapterResult> {
    // Existing Anthropic/Gemini/OpenAI-compat dispatch logic
    // Moved from callProvider() with minimal changes
    // Plus: merge providerTools from plan.providerSettings
  },
};
```

The three provider branches (Anthropic at `/messages`, Gemini at `/models/{id}:generateContent`, OpenAI-compat at `/v1/chat/completions`) move into this adapter. Each branch gains `providerTools` merging logic (see EP-INF-008b below).

### Section 4: callProvider() Refactor

`callProvider()` becomes a thin dispatcher:

```typescript
export async function callProvider(
  providerId: string,
  modelId: string,
  messages: ChatMessage[],
  systemPrompt: string,
  tools?: Array<Record<string, unknown>>,
  plan?: RoutedExecutionPlan,
): Promise<InferenceResult> {
  const adapterType = plan?.executionAdapter ?? "chat";
  const adapter = getAdapter(adapterType);

  const result = await adapter.execute({
    providerId, modelId, plan: plan ?? buildMinimalPlan(providerId, modelId),
    messages, systemPrompt, tools,
  });

  return mapAdapterResultToInferenceResult(result);
}
```

When no plan is provided (backward compat), a minimal plan with `executionAdapter: "chat"` and `maxTokens: 4096` is built inline — preserving current behavior exactly.

### Section 5: Schema & Type Extensions

**Prisma — `ExecutionRecipe` table:**
```prisma
executionAdapter  String  @default("chat")
```

**`RecipeRow` type:**
```typescript
executionAdapter: string;  // "chat" | "image_gen" | "audio" | "async"
```

**`RoutedExecutionPlan` type:**
```typescript
executionAdapter: string;  // defaults to "chat"
```

All existing recipes get `executionAdapter: "chat"` via the default. No migration needed for existing data.

---

## EP-INF-008b: Tool-Based Capabilities (Pattern A)

### Section 1: Provider Tools Concept

Pattern A capabilities use the standard chat API with provider-specific tool declarations. These are NOT tools the caller passes in (like function calling tools) — they're provider-level capabilities that the recipe activates.

The recipe's `providerSettings` gains a `providerTools` array:

```typescript
providerSettings: {
  max_tokens: 4096,
  providerTools: [
    { "code_execution": {} },                    // Gemini
    { "google_search_retrieval": { ... } },       // Gemini
    { "type": "computer_20241022", ... },          // Anthropic
  ]
}
```

The chat adapter merges these into the request body in the provider-specific format.

### Section 2: Gemini Code Execution

When a model has `capabilities.codeExecution === true`:

**Recipe seed** (for `sync.code-gen` family):
```json
{
  "providerSettings": {
    "max_tokens": 4096,
    "providerTools": [{ "code_execution": {} }]
  }
}
```

**Chat adapter merge** (Gemini branch):
```typescript
// Merge providerTools into Gemini's tools array
if (plan.providerSettings?.providerTools) {
  body.tools = [...(body.tools ?? []), ...plan.providerSettings.providerTools];
}
```

Gemini's `generateContent` API accepts `tools` as a top-level array. `code_execution` and `google_search_retrieval` are tool types alongside function declarations.

### Section 3: Gemini Grounding (Web Search)

When a model has `capabilities.webSearch === true` (new capability field):

**Recipe seed** (for `sync.web-search` family):
```json
{
  "providerSettings": {
    "max_tokens": 4096,
    "providerTools": [{
      "google_search_retrieval": {
        "dynamic_retrieval_config": { "mode": "MODE_DYNAMIC" }
      }
    }]
  }
}
```

Same merge path as code execution — both go into Gemini's `tools` array.

### Section 4: Anthropic Computer Use

When a model has `capabilities.computerUse === true` (new capability field):

**Recipe seed** (for `sync.tool-action` family):
```json
{
  "providerSettings": {
    "max_tokens": 4096,
    "providerTools": [{
      "type": "computer_20241022",
      "name": "computer",
      "display_width_px": 1024,
      "display_height_px": 768
    }]
  }
}
```

**Chat adapter merge** (Anthropic branch):
```typescript
// Anthropic computer use tools go in the tools array alongside function tools
if (plan.providerSettings?.providerTools) {
  body.tools = [...(body.tools ?? []), ...plan.providerSettings.providerTools];
}
```

The screenshot→action loop is an orchestrator concern, not the adapter's. The adapter declares the tool; the calling agent decides whether to loop on tool_use responses.

### Section 5: Provider Tools Builder

A pure function that derives `providerTools` from model capabilities and contract family:

```typescript
// apps/web/lib/routing/provider-tools.ts

function buildProviderTools(
  providerId: string,
  capabilities: ModelCardCapabilities,
  contractFamily: string,
): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [];

  // Gemini code execution for code-gen contracts
  if (providerId === "gemini" && capabilities.codeExecution === true
      && contractFamily === "sync.code-gen") {
    tools.push({ code_execution: {} });
  }

  // Gemini grounding for web-search contracts
  if (providerId === "gemini" && capabilities.webSearch === true
      && contractFamily === "sync.web-search") {
    tools.push({
      google_search_retrieval: {
        dynamic_retrieval_config: { mode: "MODE_DYNAMIC" },
      },
    });
  }

  // Anthropic computer use for tool-action contracts
  if (isAnthropic(providerId) && capabilities.computerUse === true
      && contractFamily === "sync.tool-action") {
    tools.push({
      type: "computer_20241022",
      name: "computer",
      display_width_px: 1024,
      display_height_px: 768,
    });
  }

  return tools;
}
```

`buildSeedRecipe()` calls `buildProviderTools()` and includes the result in `providerSettings.providerTools` when non-empty.

### Section 6: RequestContract Extension

Three new optional capability flags on `RequestContract`:

```typescript
requiresCodeExecution?: boolean;
requiresWebSearch?: boolean;
requiresComputerUse?: boolean;
```

`inferContract()` infers these from task type:
- `requiresCodeExecution`: true when `taskType === "code-gen"` AND route context indicates code execution desired
- `requiresWebSearch`: true when `taskType === "web-search"`
- `requiresComputerUse`: true when route context explicitly requests computer use

These are optional — unset means "no preference." When set, they're hard requirements.

### Section 7: ModelCardCapabilities Extension

Two new fields:

```typescript
webSearch: boolean | null;     // Provider supports built-in web search/grounding
computerUse: boolean | null;   // Provider supports computer use tool type
```

`codeExecution` already exists. `EMPTY_CAPABILITIES` updated with `webSearch: null, computerUse: null`.

### Section 8: Routing Extension

`getExclusionReasonV2()` gains three new checks after the existing capability checks:

```typescript
if (contract.requiresCodeExecution && ep.capabilities.codeExecution !== true) {
  return "Missing required capability: codeExecution";
}

if (contract.requiresWebSearch && ep.capabilities.webSearch !== true) {
  return "Missing required capability: webSearch";
}

if (contract.requiresComputerUse && ep.capabilities.computerUse !== true) {
  return "Missing required capability: computerUse";
}
```

Models without these capabilities are excluded from consideration when the contract requires them. Models that do have them remain eligible via the normal cost-per-success ranking.

---

## Files Summary

### New Files

| File | Responsibility |
|---|---|
| `apps/web/lib/routing/adapter-types.ts` | `ExecutionAdapterHandler`, `AdapterRequest`, `AdapterResult` types |
| `apps/web/lib/routing/execution-adapter-registry.ts` | Registry: `registerAdapter()`, `getAdapter()`, `hasAdapter()` |
| `apps/web/lib/routing/chat-adapter.ts` | Default `"chat"` adapter — existing `callProvider()` per-provider branches |
| `apps/web/lib/routing/provider-tools.ts` | `buildProviderTools()` — derives provider tools from capabilities + contract |
| `apps/web/lib/routing/execution-adapter-registry.test.ts` | Registry tests |
| `apps/web/lib/routing/chat-adapter.test.ts` | Chat adapter dispatch + providerTools merge tests |
| `apps/web/lib/routing/provider-tools.test.ts` | Provider tools derivation tests |

### Modified Files

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add `executionAdapter String @default("chat")` to `ExecutionRecipe` |
| `apps/web/lib/routing/recipe-types.ts` | Add `executionAdapter` to `RoutedExecutionPlan` and `RecipeRow` |
| `apps/web/lib/routing/model-card-types.ts` | Add `webSearch`, `computerUse` to `ModelCardCapabilities` and `EMPTY_CAPABILITIES` |
| `apps/web/lib/routing/request-contract.ts` | Add `requiresCodeExecution`, `requiresWebSearch`, `requiresComputerUse` optional flags |
| `apps/web/lib/routing/recipe-seeder.ts` | Call `buildProviderTools()`, include in seed output |
| `apps/web/lib/routing/execution-plan.ts` | Pass `executionAdapter` through to plan |
| `apps/web/lib/routing/pipeline-v2.ts` | Add capability-based exclusion checks |
| `apps/web/lib/ai-inference.ts` | `callProvider()` → thin adapter dispatcher |
| `apps/web/lib/routing/index.ts` | Export new modules |

### Unchanged Files

All 28 existing test files pass without modification. No changes to: `scoring.ts`, `pipeline.ts`, `cost-ranking.ts`, `fallback.ts`, `reward.ts`, `route-outcome.ts`, `recipe-performance.ts`, `champion-challenger.ts`, `golden-realignment.ts`, `eval-runner.ts`, `eval-scoring.ts`, `golden-tests.ts`.

---

## Testing Strategy

### New Test Files

**`execution-adapter-registry.test.ts`:**
- Registers and retrieves an adapter by type
- Default "chat" adapter is registered
- `getAdapter()` throws for unknown type
- `hasAdapter()` returns true/false correctly
- Duplicate registration overwrites

**`chat-adapter.test.ts`:**
- Anthropic branch: correct URL, body shape, max_tokens from plan, thinking config
- Gemini branch: correct URL, contents format, generationConfig from plan
- OpenAI-compat branch: correct URL, messages format, max_tokens/temperature from plan
- providerTools merged into Gemini request body
- providerTools merged into Anthropic request body
- No providerTools: request body unchanged (backward compat)
- No plan: uses default maxTokens=4096 (backward compat)

**`provider-tools.test.ts`:**
- Gemini + codeExecution + sync.code-gen → `[{ code_execution: {} }]`
- Gemini + webSearch + sync.web-search → `[{ google_search_retrieval: {...} }]`
- Anthropic + computerUse + sync.tool-action → `[{ type: "computer_20241022", ... }]`
- Model without capability → empty array
- Wrong contract family → empty array
- Multiple capabilities on same model → combined array
- OpenAI provider → empty array (no Pattern A tools for OpenAI yet)

### Extended Existing Tests

**`recipe-seeder.test.ts`** (extend):
- Seed includes `providerTools` when model has matching capability
- Seed omits `providerTools` when model lacks capability
- `executionAdapter` is always `"chat"` in seed output

**`request-contract.test.ts`** (extend):
- `requiresCodeExecution` set for code-gen task with code execution context
- `requiresWebSearch` set for web-search task
- `requiresComputerUse` set when route context requests it
- Flags unset by default

**`pipeline-v2.test.ts`** (extend):
- Model excluded when contract requires code execution but model lacks it
- Model excluded when contract requires web search but model lacks it
- Model excluded when contract requires computer use but model lacks it
- Model NOT excluded when contract doesn't require these capabilities

**`execution-plan.test.ts`** (extend):
- Plan includes `executionAdapter` from recipe
- Default plan has `executionAdapter: "chat"`

### Backward Compatibility

- `callProvider()` without plan parameter → identical behavior to current
- All 521 existing routing tests pass without modification
- Existing recipes without `executionAdapter` default to `"chat"` via Prisma default

---

## Relationship to EP-INF-008c/008d

| This Delivers | EP-INF-008c/008d Consumes It |
|---|---|
| `ExecutionAdapterHandler` interface | Image gen, audio, async adapters implement it |
| Adapter registry with `registerAdapter()` | New adapters register alongside chat |
| `executionAdapter` field on recipes | Recipes declare `"image_gen"`, `"audio"`, `"async"` |
| `callProvider()` adapter dispatch | Non-chat requests go to the right adapter automatically |
| `providerTools` pattern in `providerSettings` | Pattern B/C may use similar config-driven approach |

The framework is built for extensibility but ships with exactly one adapter and three Pattern A capabilities.
