# EP-INF-008a/008b: Execution Adapter Framework & Tool-Based Capabilities

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an adapter registry pattern to `callProvider()` so non-chat execution patterns can plug in, then activate Pattern A capabilities (Gemini code execution, Gemini grounding, Anthropic computer use) via enriched recipe tool declarations.

**Architecture:** Extract `callProvider()`'s per-provider HTTP branches into a `chat-adapter` implementing an `ExecutionAdapterHandler` interface. A registry maps adapter type strings to handlers. `callProvider()` resolves provider auth, looks up the adapter from the plan, dispatches, and maps the result. Pattern A capabilities inject provider-specific tool declarations into the request body via `providerTools` in recipe `providerSettings`.

**Tech Stack:** TypeScript, Vitest (globals: false), Prisma (PostgreSQL), existing routing module structure.

**Spec:** `docs/superpowers/specs/2026-03-20-execution-adapter-framework-design.md`

**Test command:** `npx vitest run apps/web/lib/routing/ --reporter=verbose`

**Full suite check:** `npx vitest run apps/web/lib/routing/ --reporter=verbose` (521+ tests must pass)

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `apps/web/lib/routing/provider-utils.ts` | Shared `isAnthropic()`, `isOpenAI()` helpers |
| `apps/web/lib/routing/adapter-types.ts` | `ExecutionAdapterHandler`, `AdapterRequest`, `AdapterResult`, `ResolvedProvider`, `ToolCallEntry` types |
| `apps/web/lib/routing/execution-adapter-registry.ts` | `registerExecutionAdapter()`, `getExecutionAdapter()` |
| `apps/web/lib/routing/execution-adapter-registry.test.ts` | Registry tests |
| `apps/web/lib/routing/provider-tools.ts` | `buildProviderTools()` — provider tool declarations from capabilities + contract |
| `apps/web/lib/routing/provider-tools.test.ts` | Provider tools tests |
| `apps/web/lib/routing/chat-adapter.ts` | Default `"chat"` adapter — per-provider HTTP dispatch + providerTools merge |
| `apps/web/lib/routing/chat-adapter.test.ts` | Chat adapter tests (mock fetch) |

### Modified Files

| File | Lines | Change |
|---|---|---|
| `packages/db/prisma/schema.prisma` | 3512-3532 | Add `executionAdapter` field to `ExecutionRecipe` |
| `apps/web/lib/routing/recipe-types.ts` | 13-29, 33-44 | Add `executionAdapter` to `RoutedExecutionPlan` and `RecipeRow` |
| `apps/web/lib/routing/model-card-types.ts` | 20-34, 108-122 | Add `webSearch`, `computerUse` to `ModelCardCapabilities` and `EMPTY_CAPABILITIES` |
| `apps/web/lib/routing/request-contract.ts` | 17-51 | Add `requiresCodeExecution`, `requiresWebSearch`, `requiresComputerUse` |
| `apps/web/lib/routing/execution-plan.ts` | 56-65, 101-110 | Pass `executionAdapter` through in both plan builders |
| `apps/web/lib/routing/recipe-seeder.ts` | 10, 91-97, 34-79 | Import from `provider-utils`, call `buildProviderTools()` |
| `apps/web/lib/routing/pipeline-v2.ts` | 38-111 | Add capability-based exclusion checks |
| `apps/web/lib/ai-inference.ts` | 299-462 | Thin dispatcher using adapter registry |
| `apps/web/lib/routing/index.ts` | 60-72 | Export new modules |

---

## Task 1: Provider Utilities (extract shared helpers)

**Files:**
- Create: `apps/web/lib/routing/provider-utils.ts`
- Modify: `apps/web/lib/routing/recipe-seeder.ts:91-97`

- [ ] **Step 1: Create provider-utils.ts**

```typescript
// apps/web/lib/routing/provider-utils.ts

/**
 * EP-INF-008a: Shared provider ID helpers.
 * Extracted from recipe-seeder.ts for use across routing modules.
 */

export function isAnthropic(providerId: string): boolean {
  return providerId === "anthropic" || providerId.startsWith("anthropic-");
}

export function isOpenAI(providerId: string): boolean {
  return providerId === "openai" || providerId.startsWith("openai-");
}
```

- [ ] **Step 2: Update recipe-seeder.ts to import from provider-utils**

In `apps/web/lib/routing/recipe-seeder.ts`, add import at top:
```typescript
import { isAnthropic, isOpenAI } from "./provider-utils";
```

Remove the two private functions `isAnthropic` (line 91-93) and `isOpenAI` (line 95-97).

- [ ] **Step 3: Run existing tests to verify no regression**

Run: `npx vitest run apps/web/lib/routing/recipe-seeder.test.ts --reporter=verbose`
Expected: All existing recipe-seeder tests PASS (no behavioral change)

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/routing/provider-utils.ts apps/web/lib/routing/recipe-seeder.ts
git commit -m "refactor(routing): extract isAnthropic/isOpenAI to shared provider-utils"
```

---

## Task 2: Type Extensions (adapter types, recipe types, model card, request contract)

**Files:**
- Create: `apps/web/lib/routing/adapter-types.ts`
- Modify: `apps/web/lib/routing/recipe-types.ts`
- Modify: `apps/web/lib/routing/model-card-types.ts`
- Modify: `apps/web/lib/routing/request-contract.ts`
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Create adapter-types.ts**

```typescript
// apps/web/lib/routing/adapter-types.ts

/**
 * EP-INF-008a: Execution adapter interface types.
 */

import type { RoutedExecutionPlan } from "./recipe-types";
import type { ChatMessage } from "../ai-inference";

/** Named type for tool call entries (matches InferenceResult.toolCalls shape) */
export type ToolCallEntry = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

/** Pre-resolved provider connection info — callProvider resolves before dispatch */
export interface ResolvedProvider {
  baseUrl: string;
  headers: Record<string, string>;
}

/** Input to an execution adapter */
export interface AdapterRequest {
  providerId: string;
  modelId: string;
  plan: RoutedExecutionPlan;
  provider: ResolvedProvider;
  messages: ChatMessage[];
  systemPrompt: string;
  tools?: Array<Record<string, unknown>>;
}

/** Normalized output from an execution adapter */
export interface AdapterResult {
  text: string;
  toolCalls: ToolCallEntry[];
  usage: { inputTokens: number; outputTokens: number };
  inferenceMs: number;
  raw?: Record<string, unknown>;
}

/** Contract every execution adapter implements */
export interface ExecutionAdapterHandler {
  type: string;
  execute(request: AdapterRequest): Promise<AdapterResult>;
}
```

- [ ] **Step 2: Add `executionAdapter` to `RoutedExecutionPlan` in recipe-types.ts**

In `apps/web/lib/routing/recipe-types.ts`, add field to `RoutedExecutionPlan` after `contractFamily`:
```typescript
  executionAdapter: string;
```

And add to `RecipeRow` after `origin`:
```typescript
  executionAdapter: string;
```

- [ ] **Step 3: Add `webSearch`, `computerUse` to ModelCardCapabilities**

In `apps/web/lib/routing/model-card-types.ts`, add after `codeExecution: boolean | null;` (line 26):
```typescript
  webSearch: boolean | null;
  computerUse: boolean | null;
```

In `EMPTY_CAPABILITIES` (after `codeExecution: null`, line 116):
```typescript
  webSearch: null,
  computerUse: null,
```

- [ ] **Step 4: Add capability flags to RequestContract**

In `apps/web/lib/routing/request-contract.ts`, add after `requiresStreaming: boolean;` (line 36):
```typescript
  requiresCodeExecution?: boolean;
  requiresWebSearch?: boolean;
  requiresComputerUse?: boolean;
```

In `inferContract()`, add inference logic after the `requiresStreaming` assignment (around line 96):
```typescript
  // ── Capability flags (EP-INF-008b) ───────────────────────────────────────
  const requiresCodeExecution = routeContext?.requiresCodeExecution === true;
  const requiresWebSearch = taskType === "web-search" || routeContext?.requiresWebSearch === true;
  const requiresComputerUse = routeContext?.requiresComputerUse === true;
```

Update the `routeContext` parameter type to add:
```typescript
    requiresCodeExecution?: boolean;
    requiresWebSearch?: boolean;
    requiresComputerUse?: boolean;
```

Add the flags to the assembled contract object:
```typescript
    ...(requiresCodeExecution && { requiresCodeExecution }),
    ...(requiresWebSearch && { requiresWebSearch }),
    ...(requiresComputerUse && { requiresComputerUse }),
```

- [ ] **Step 5: Add `executionAdapter` to Prisma schema**

In `packages/db/prisma/schema.prisma`, add after `origin` field (line 3519):
```prisma
  executionAdapter      String    @default("chat")
```

- [ ] **Step 6: Run Prisma migration**

Run: `cd packages/db && npx prisma migrate dev --name add-execution-adapter`
Expected: Migration created and applied

- [ ] **Step 7: Run all existing routing tests**

Run: `npx vitest run apps/web/lib/routing/ --reporter=verbose`
Expected: All 521+ existing tests PASS. The new fields are optional or have defaults, so nothing breaks.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/routing/adapter-types.ts apps/web/lib/routing/recipe-types.ts apps/web/lib/routing/model-card-types.ts apps/web/lib/routing/request-contract.ts packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(routing): EP-INF-008a/008b type extensions — adapter types, capabilities, contract flags"
```

---

## Task 3: Execution Plan Builder — pass through `executionAdapter`

**Files:**
- Modify: `apps/web/lib/routing/execution-plan.ts:56-65, 101-110`
- Test: `apps/web/lib/routing/execution-plan.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `apps/web/lib/routing/execution-plan.test.ts`:

In `makeRecipe()` fixture, add `executionAdapter: "chat"` to the default return.

```typescript
// Add to the "buildPlanFromRecipe" describe block:
it("includes executionAdapter from recipe", () => {
  const recipe = makeRecipe({ executionAdapter: "chat" });
  const plan = buildPlanFromRecipe(recipe, makeContract());
  expect(plan.executionAdapter).toBe("chat");
});

it("passes through non-chat executionAdapter", () => {
  const recipe = makeRecipe({ executionAdapter: "image_gen" });
  const plan = buildPlanFromRecipe(recipe, makeContract());
  expect(plan.executionAdapter).toBe("image_gen");
});

// Add to the "buildDefaultPlan" describe block:
it("defaults executionAdapter to 'chat'", () => {
  const plan = buildDefaultPlan(makeEndpoint(), makeContract());
  expect(plan.executionAdapter).toBe("chat");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/lib/routing/execution-plan.test.ts --reporter=verbose`
Expected: 3 new tests FAIL (`executionAdapter` not on plan)

- [ ] **Step 3: Implement — add `executionAdapter` to both plan builders**

In `apps/web/lib/routing/execution-plan.ts`, update `buildPlanFromRecipe()` (inside the plan object, after `contractFamily`):
```typescript
    executionAdapter: recipe.executionAdapter ?? "chat",
```

Update `buildDefaultPlan()` (inside the return object, after `contractFamily`):
```typescript
    executionAdapter: "chat",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/lib/routing/execution-plan.test.ts --reporter=verbose`
Expected: All tests PASS (existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/execution-plan.ts apps/web/lib/routing/execution-plan.test.ts
git commit -m "feat(routing): pass executionAdapter through plan builders"
```

---

## Task 4: Execution Adapter Registry

**Files:**
- Create: `apps/web/lib/routing/execution-adapter-registry.ts`
- Create: `apps/web/lib/routing/execution-adapter-registry.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/routing/execution-adapter-registry.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import {
  registerExecutionAdapter,
  getExecutionAdapter,
  _resetAdaptersForTest,
} from "./execution-adapter-registry";
import type { ExecutionAdapterHandler } from "./adapter-types";

const fakeAdapter: ExecutionAdapterHandler = {
  type: "fake",
  execute: async () => ({
    text: "",
    toolCalls: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    inferenceMs: 0,
  }),
};

describe("execution-adapter-registry", () => {
  beforeEach(() => {
    _resetAdaptersForTest();
  });

  it("registers and retrieves an adapter", () => {
    registerExecutionAdapter(fakeAdapter);
    expect(getExecutionAdapter("fake")).toBe(fakeAdapter);
  });

  it("throws for unknown adapter type", () => {
    expect(() => getExecutionAdapter("nonexistent")).toThrow(
      /No execution adapter registered for type "nonexistent"/,
    );
  });

  it("overwrites on duplicate registration", () => {
    registerExecutionAdapter(fakeAdapter);
    const replacement: ExecutionAdapterHandler = {
      type: "fake",
      execute: async () => ({
        text: "replaced",
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        inferenceMs: 0,
      }),
    };
    registerExecutionAdapter(replacement);
    expect(getExecutionAdapter("fake")).toBe(replacement);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/lib/routing/execution-adapter-registry.test.ts --reporter=verbose`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement the registry**

Create `apps/web/lib/routing/execution-adapter-registry.ts`:

```typescript
// apps/web/lib/routing/execution-adapter-registry.ts

/**
 * EP-INF-008a: Execution adapter registry.
 * Maps adapter type strings to handler implementations.
 * The "chat" adapter is registered by chat-adapter.ts at import time.
 */

import type { ExecutionAdapterHandler } from "./adapter-types";

const adapters = new Map<string, ExecutionAdapterHandler>();

export function registerExecutionAdapter(adapter: ExecutionAdapterHandler): void {
  adapters.set(adapter.type, adapter);
}

export function getExecutionAdapter(type: string): ExecutionAdapterHandler {
  const adapter = adapters.get(type);
  if (!adapter) {
    throw new Error(`No execution adapter registered for type "${type}". Registered: [${[...adapters.keys()].join(", ")}]`);
  }
  return adapter;
}

/** Test-only: reset registry to empty state */
export function _resetAdaptersForTest(): void {
  adapters.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/lib/routing/execution-adapter-registry.test.ts --reporter=verbose`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/execution-adapter-registry.ts apps/web/lib/routing/execution-adapter-registry.test.ts
git commit -m "feat(routing): EP-INF-008a execution adapter registry"
```

---

## Task 5: Provider Tools Builder

**Files:**
- Create: `apps/web/lib/routing/provider-tools.ts`
- Create: `apps/web/lib/routing/provider-tools.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/routing/provider-tools.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildProviderTools } from "./provider-tools";
import { EMPTY_CAPABILITIES } from "./model-card-types";
import type { ModelCardCapabilities } from "./model-card-types";

function caps(overrides: Partial<ModelCardCapabilities> = {}): ModelCardCapabilities {
  return { ...EMPTY_CAPABILITIES, ...overrides };
}

describe("buildProviderTools", () => {
  // ── Gemini Code Execution ──
  it("Gemini + codeExecution + sync.code-gen → code_execution tool", () => {
    const tools = buildProviderTools("gemini", caps({ codeExecution: true }), "sync.code-gen");
    expect(tools).toEqual([{ code_execution: {} }]);
  });

  it("Gemini + codeExecution + wrong family → empty", () => {
    const tools = buildProviderTools("gemini", caps({ codeExecution: true }), "sync.greeting");
    expect(tools).toEqual([]);
  });

  it("Gemini + no codeExecution + sync.code-gen → empty", () => {
    const tools = buildProviderTools("gemini", caps({ codeExecution: false }), "sync.code-gen");
    expect(tools).toEqual([]);
  });

  // ── Gemini Grounding ──
  it("Gemini + webSearch + sync.web-search → google_search_retrieval tool", () => {
    const tools = buildProviderTools("gemini", caps({ webSearch: true }), "sync.web-search");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toHaveProperty("google_search_retrieval");
    expect((tools[0] as any).google_search_retrieval.dynamic_retrieval_config.mode).toBe("MODE_DYNAMIC");
  });

  it("Gemini + webSearch + wrong family → empty", () => {
    const tools = buildProviderTools("gemini", caps({ webSearch: true }), "sync.greeting");
    expect(tools).toEqual([]);
  });

  // ── Anthropic Computer Use ──
  it("Anthropic + computerUse + sync.tool-action → computer tool", () => {
    const tools = buildProviderTools("anthropic", caps({ computerUse: true }), "sync.tool-action");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      type: "computer_20241022",
      name: "computer",
      display_width_px: 1024,
      display_height_px: 768,
    });
  });

  it("anthropic- prefix + computerUse + sync.tool-action → computer tool", () => {
    const tools = buildProviderTools("anthropic-vertex", caps({ computerUse: true }), "sync.tool-action");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toHaveProperty("type", "computer_20241022");
  });

  it("Anthropic + computerUse + wrong family → empty", () => {
    const tools = buildProviderTools("anthropic", caps({ computerUse: true }), "sync.code-gen");
    expect(tools).toEqual([]);
  });

  it("Anthropic + no computerUse → empty", () => {
    const tools = buildProviderTools("anthropic", caps({ computerUse: false }), "sync.tool-action");
    expect(tools).toEqual([]);
  });

  // ── Multiple capabilities ──
  it("Gemini with both codeExecution and webSearch → combined for matching families", () => {
    const tools = buildProviderTools(
      "gemini",
      caps({ codeExecution: true, webSearch: true }),
      "sync.code-gen",
    );
    // Only code_execution matches sync.code-gen; webSearch needs sync.web-search
    expect(tools).toEqual([{ code_execution: {} }]);
  });

  // ── Other providers ──
  it("OpenAI provider → empty array", () => {
    const tools = buildProviderTools("openai", caps({ codeExecution: true }), "sync.code-gen");
    expect(tools).toEqual([]);
  });

  it("Ollama provider → empty array", () => {
    const tools = buildProviderTools("ollama", caps(), "sync.code-gen");
    expect(tools).toEqual([]);
  });

  it("Unknown provider → empty array", () => {
    const tools = buildProviderTools("litellm", caps(), "sync.code-gen");
    expect(tools).toEqual([]);
  });

  // ── Null capabilities ──
  it("null codeExecution → empty", () => {
    const tools = buildProviderTools("gemini", caps({ codeExecution: null }), "sync.code-gen");
    expect(tools).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/lib/routing/provider-tools.test.ts --reporter=verbose`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement buildProviderTools**

Create `apps/web/lib/routing/provider-tools.ts`:

```typescript
// apps/web/lib/routing/provider-tools.ts

/**
 * EP-INF-008b: Derive provider-specific tool declarations from model capabilities
 * and contract family. These are injected into the request body by the chat adapter.
 */

import type { ModelCardCapabilities } from "./model-card-types";
import { isAnthropic } from "./provider-utils";

export function buildProviderTools(
  providerId: string,
  capabilities: ModelCardCapabilities,
  contractFamily: string,
): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [];

  // Gemini code execution for code-gen contracts
  if (
    providerId === "gemini" &&
    capabilities.codeExecution === true &&
    contractFamily === "sync.code-gen"
  ) {
    tools.push({ code_execution: {} });
  }

  // Gemini grounding for web-search contracts
  if (
    providerId === "gemini" &&
    capabilities.webSearch === true &&
    contractFamily === "sync.web-search"
  ) {
    tools.push({
      google_search_retrieval: {
        dynamic_retrieval_config: { mode: "MODE_DYNAMIC" },
      },
    });
  }

  // Anthropic computer use for tool-action contracts
  if (
    isAnthropic(providerId) &&
    capabilities.computerUse === true &&
    contractFamily === "sync.tool-action"
  ) {
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/lib/routing/provider-tools.test.ts --reporter=verbose`
Expected: All 14 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/provider-tools.ts apps/web/lib/routing/provider-tools.test.ts
git commit -m "feat(routing): EP-INF-008b buildProviderTools — capability-driven tool declarations"
```

---

## Task 6: Recipe Seeder — include providerTools in seed output

**Files:**
- Modify: `apps/web/lib/routing/recipe-seeder.ts:34-79`
- Test: `apps/web/lib/routing/recipe-seeder.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `apps/web/lib/routing/recipe-seeder.test.ts`:

```typescript
import { buildProviderTools } from "./provider-tools";

// ── providerTools in seed output (EP-INF-008b) ──────────────────────────────

describe("buildSeedRecipe – providerTools", () => {
  it("Gemini + codeExecution + sync.code-gen → providerTools in providerSettings", () => {
    const result = buildSeedRecipe(
      "gemini",
      "gemini-2.0-flash",
      "sync.code-gen",
      baseModelCard({ capabilities: caps({ codeExecution: true }) }),
      baseContract(),
    );
    expect(result.providerSettings.providerTools).toEqual([{ code_execution: {} }]);
  });

  it("Gemini + webSearch + sync.web-search → grounding tool in providerSettings", () => {
    const result = buildSeedRecipe(
      "gemini",
      "gemini-2.0-flash",
      "sync.web-search",
      baseModelCard({ capabilities: caps({ webSearch: true }) }),
      baseContract(),
    );
    expect(result.providerSettings.providerTools).toBeDefined();
    expect((result.providerSettings.providerTools as any[])[0]).toHaveProperty("google_search_retrieval");
  });

  it("Anthropic + computerUse + sync.tool-action → computer tool in providerSettings", () => {
    const result = buildSeedRecipe(
      "anthropic",
      "claude-sonnet-4-5",
      "sync.tool-action",
      baseModelCard({ capabilities: caps({ computerUse: true }) }),
      baseContract(),
    );
    expect(result.providerSettings.providerTools).toBeDefined();
    expect((result.providerSettings.providerTools as any[])[0]).toHaveProperty("type", "computer_20241022");
  });

  it("no matching capability → no providerTools key", () => {
    const result = buildSeedRecipe(
      "openai",
      "gpt-4o",
      "sync.code-gen",
      baseModelCard(),
      baseContract(),
    );
    expect(result.providerSettings.providerTools).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/lib/routing/recipe-seeder.test.ts --reporter=verbose`
Expected: 4 new tests FAIL (providerTools not in output)

- [ ] **Step 3: Implement — integrate buildProviderTools into buildSeedRecipe**

In `apps/web/lib/routing/recipe-seeder.ts`:

Add import at top:
```typescript
import { buildProviderTools } from "./provider-tools";
```

The `buildSeedRecipe` function needs the `contractFamily` parameter (currently `_contractFamily`). Rename it:
```typescript
export function buildSeedRecipe(
  providerId: string,
  _modelId: string,
  contractFamily: string,  // was _contractFamily
```

After the `responsePolicy` assignment and before the `return` (around line 76), add:
```typescript
  const providerTools = buildProviderTools(providerId, modelCard.capabilities, contractFamily);
  if (providerTools.length > 0) {
    providerSettings.providerTools = providerTools;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/lib/routing/recipe-seeder.test.ts --reporter=verbose`
Expected: All tests PASS (existing + 4 new)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/recipe-seeder.ts apps/web/lib/routing/recipe-seeder.test.ts
git commit -m "feat(routing): EP-INF-008b seed providerTools from model capabilities"
```

---

## Task 7: Pipeline V2 — capability-based exclusion

**Files:**
- Modify: `apps/web/lib/routing/pipeline-v2.ts:38-111`
- Test: `apps/web/lib/routing/pipeline-v2.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `apps/web/lib/routing/pipeline-v2.test.ts`, in or after the existing `getExclusionReasonV2` describe block:

```typescript
describe("getExclusionReasonV2 – capability-based exclusion (EP-INF-008b)", () => {
  it("excludes model without codeExecution when contract requires it", () => {
    const ep = makeEndpoint({ capabilities: { ...EMPTY_CAPABILITIES, codeExecution: false } as any });
    const contract = makeContract({ requiresCodeExecution: true });
    expect(getExclusionReasonV2(ep, contract)).toMatch(/codeExecution/);
  });

  it("includes model with codeExecution when contract requires it", () => {
    const ep = makeEndpoint({ capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true, codeExecution: true } as any });
    const contract = makeContract({ requiresCodeExecution: true });
    expect(getExclusionReasonV2(ep, contract)).toBeNull();
  });

  it("excludes model without webSearch when contract requires it", () => {
    const ep = makeEndpoint({ capabilities: { ...EMPTY_CAPABILITIES, webSearch: false } as any });
    const contract = makeContract({ requiresWebSearch: true });
    expect(getExclusionReasonV2(ep, contract)).toMatch(/webSearch/);
  });

  it("includes model with webSearch when contract requires it", () => {
    const ep = makeEndpoint({ capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true, webSearch: true } as any });
    const contract = makeContract({ requiresWebSearch: true });
    expect(getExclusionReasonV2(ep, contract)).toBeNull();
  });

  it("excludes model without computerUse when contract requires it", () => {
    const ep = makeEndpoint({ capabilities: { ...EMPTY_CAPABILITIES, computerUse: false } as any });
    const contract = makeContract({ requiresComputerUse: true });
    expect(getExclusionReasonV2(ep, contract)).toMatch(/computerUse/);
  });

  it("does not check capabilities when contract does not require them", () => {
    const ep = makeEndpoint({ capabilities: { ...EMPTY_CAPABILITIES, codeExecution: false, webSearch: false, computerUse: false } as any });
    const contract = makeContract(); // no requiresCodeExecution/webSearch/computerUse
    // Should not be excluded for missing optional capabilities
    expect(getExclusionReasonV2(ep, contract)).toBeNull();
  });
});
```

Note: the `makeContract` and `makeEndpoint` fixtures in this test file may need `webSearch`, `computerUse` added to their default capabilities (from the EMPTY_CAPABILITIES changes in Task 2). Check that the defaults include the new fields.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/lib/routing/pipeline-v2.test.ts --reporter=verbose`
Expected: New tests FAIL (no capability checks in pipeline)

- [ ] **Step 3: Implement — add capability checks to `getExclusionReasonV2`**

In `apps/web/lib/routing/pipeline-v2.ts`, add after the file/pdf input check (around line 97), before the residency policy check:

```typescript
  // EP-INF-008b: Specialized capability requirements
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/lib/routing/pipeline-v2.test.ts --reporter=verbose`
Expected: All tests PASS (existing + 6 new)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/pipeline-v2.ts apps/web/lib/routing/pipeline-v2.test.ts
git commit -m "feat(routing): EP-INF-008b capability-based exclusion in routeEndpointV2"
```

---

## Task 8: Chat Adapter

This is the largest task — extracting the per-provider HTTP dispatch from `callProvider()` into the chat adapter.

**Files:**
- Create: `apps/web/lib/routing/chat-adapter.ts`
- Create: `apps/web/lib/routing/chat-adapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/routing/chat-adapter.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AdapterRequest, AdapterResult } from "./adapter-types";
import type { RoutedExecutionPlan } from "./recipe-types";

// We'll test the chat adapter by mocking global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after stubbing
import { chatAdapter } from "./chat-adapter";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePlan(overrides: Partial<RoutedExecutionPlan> = {}): RoutedExecutionPlan {
  return {
    providerId: "openai",
    modelId: "gpt-4o",
    recipeId: null,
    contractFamily: "sync.greeting",
    executionAdapter: "chat",
    maxTokens: 4096,
    providerSettings: {},
    toolPolicy: {},
    responsePolicy: {},
    ...overrides,
  };
}

function makeRequest(overrides: Partial<AdapterRequest> = {}): AdapterRequest {
  return {
    providerId: "openai",
    modelId: "gpt-4o",
    plan: makePlan(),
    provider: { baseUrl: "https://api.openai.com/v1", headers: { Authorization: "Bearer sk-test" } },
    messages: [{ role: "user" as const, content: "Hello" }],
    systemPrompt: "You are helpful.",
    ...overrides,
  };
}

function mockJsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── OpenAI-compatible branch ─────────────────────────────────────────────────

describe("chatAdapter – OpenAI-compatible", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("sends correct URL and body shape", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      choices: [{ message: { content: "Hi there!" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));

    const result = await chatAdapter.execute(makeRequest());

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(opts.body);
    expect(body.model).toBe("gpt-4o");
    expect(body.max_tokens).toBe(4096);
    expect(body.messages[0].role).toBe("system");
    expect(result.text).toBe("Hi there!");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
  });

  it("applies temperature from plan", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }));

    await chatAdapter.execute(makeRequest({
      plan: makePlan({ temperature: 0.3 }),
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.temperature).toBe(0.3);
  });

  it("applies reasoning_effort from providerSettings", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }));

    await chatAdapter.execute(makeRequest({
      plan: makePlan({ providerSettings: { reasoning_effort: "high" } }),
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.reasoning_effort).toBe("high");
  });
});

// ── Anthropic branch ─────────────────────────────────────────────────────────

describe("chatAdapter – Anthropic", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("sends correct URL and body shape", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      content: [{ type: "text", text: "Hello from Claude" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }));

    const result = await chatAdapter.execute(makeRequest({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5",
      plan: makePlan({ providerId: "anthropic", modelId: "claude-sonnet-4-5" }),
      provider: { baseUrl: "https://api.anthropic.com/v1", headers: { "x-api-key": "sk-test" } },
    }));

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(opts.body);
    expect(body.model).toBe("claude-sonnet-4-5");
    expect(body.system).toBe("You are helpful.");
    expect(result.text).toBe("Hello from Claude");
  });

  it("merges providerTools into tools array", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 5, output_tokens: 2 },
    }));

    await chatAdapter.execute(makeRequest({
      providerId: "anthropic",
      plan: makePlan({
        providerId: "anthropic",
        providerSettings: {
          providerTools: [{ type: "computer_20241022", name: "computer", display_width_px: 1024, display_height_px: 768 }],
        },
      }),
      provider: { baseUrl: "https://api.anthropic.com/v1", headers: {} },
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toBeDefined();
    expect(body.tools).toContainEqual(expect.objectContaining({ type: "computer_20241022" }));
  });

  it("applies thinking config from providerSettings", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 5, output_tokens: 2 },
    }));

    await chatAdapter.execute(makeRequest({
      providerId: "anthropic",
      plan: makePlan({
        providerId: "anthropic",
        providerSettings: { thinking: { type: "enabled", budget_tokens: 8192 } },
      }),
      provider: { baseUrl: "https://api.anthropic.com/v1", headers: {} },
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
  });
});

// ── Gemini branch ────────────────────────────────────────────────────────────

describe("chatAdapter – Gemini", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("sends correct URL and body shape", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      candidates: [{ content: { parts: [{ text: "Gemini says hi" }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }));

    const result = await chatAdapter.execute(makeRequest({
      providerId: "gemini",
      modelId: "gemini-2.0-flash",
      plan: makePlan({ providerId: "gemini", modelId: "gemini-2.0-flash" }),
      provider: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", headers: {} },
    }));

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/models/gemini-2.0-flash:generateContent");
    expect(result.text).toBe("Gemini says hi");
  });

  it("merges providerTools into body.tools array", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      candidates: [{ content: { parts: [{ text: "ok" }] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
    }));

    await chatAdapter.execute(makeRequest({
      providerId: "gemini",
      modelId: "gemini-2.0-flash",
      plan: makePlan({
        providerId: "gemini",
        modelId: "gemini-2.0-flash",
        providerSettings: { providerTools: [{ code_execution: {} }] },
      }),
      provider: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", headers: {} },
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toContainEqual({ code_execution: {} });
  });
});

// ── Gemini code_execution response ────────────────────────────────────────

describe("chatAdapter – Gemini code_execution response", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("extracts executableCode and codeExecutionResult as text content", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      candidates: [{
        content: {
          parts: [
            { executableCode: { code: "print('hello')", language: "PYTHON" } },
            { codeExecutionResult: { output: "hello", outcome: "OUTCOME_OK" } },
            { text: "The code printed hello." },
          ],
        },
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
    }));

    const result = await chatAdapter.execute(makeRequest({
      providerId: "gemini",
      modelId: "gemini-2.0-flash",
      plan: makePlan({ providerId: "gemini", modelId: "gemini-2.0-flash" }),
      provider: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", headers: {} },
    }));

    // Text parts are extracted; code execution parts are non-text and should be included
    expect(result.text).toContain("The code printed hello.");
    // Tool calls should not include code_execution results (they're inline, not function calls)
    expect(result.toolCalls).toEqual([]);
  });
});

// ── Error handling ───────────────────────────────────────────────────────────

describe("chatAdapter – errors", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("throws InferenceError on HTTP 429", async () => {
    mockFetch.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));

    await expect(chatAdapter.execute(makeRequest())).rejects.toThrow(/rate limit/i);
  });

  it("throws InferenceError on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    await expect(chatAdapter.execute(makeRequest())).rejects.toThrow(/network/i);
  });
});

// ── Backward compat: no providerTools ────────────────────────────────────────

describe("chatAdapter – backward compat", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("request body unchanged when no providerTools", async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }));

    await chatAdapter.execute(makeRequest());

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/lib/routing/chat-adapter.test.ts --reporter=verbose`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement the chat adapter**

Create `apps/web/lib/routing/chat-adapter.ts`. This extracts the per-provider branches from `apps/web/lib/ai-inference.ts` lines 300-462 into an adapter.

```typescript
// apps/web/lib/routing/chat-adapter.ts

/**
 * EP-INF-008a: Default "chat" execution adapter.
 * Wraps the existing per-provider HTTP dispatch from callProvider().
 */

import type {
  AdapterRequest,
  AdapterResult,
  ExecutionAdapterHandler,
  ToolCallEntry,
} from "./adapter-types";
import {
  InferenceError,
  classifyHttpError,
  extractAnthropicToolCalls,
  extractOpenAIToolCalls,
  formatMessageForAnthropic,
  formatMessageForOpenAI,
} from "../ai-inference";
import { isAnthropic } from "./provider-utils";
import { registerExecutionAdapter } from "./execution-adapter-registry";

// classifyHttpError is imported from ai-inference.ts (exported there for reuse)

// ── Usage extraction helpers ─────────────────────────────────────────────────

function readUsageNumber(usage: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number") return value;
  }
  return 0;
}

// ── Chat adapter implementation ──────────────────────────────────────────────

export const chatAdapter: ExecutionAdapterHandler = {
  type: "chat",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, plan, provider, messages, systemPrompt, tools } = request;

    let chatUrl: string;
    let body: Record<string, unknown>;
    let extractText: (data: Record<string, unknown>) => string;
    let extractToolCalls: (data: Record<string, unknown>) => ToolCallEntry[];
    let extractUsage: (data: Record<string, unknown>) => { inputTokens: number; outputTokens: number };

    const providerTools = plan.providerSettings?.providerTools as
      | Array<Record<string, unknown>>
      | undefined;

    if (isAnthropic(providerId)) {
      // ── Anthropic ──────────────────────────────────────────────────────
      chatUrl = `${provider.baseUrl}/messages`;
      body = {
        model: modelId,
        max_tokens: plan.maxTokens,
        system: systemPrompt,
        messages: messages
          .filter((m) => m.role !== "system")
          .map((m) => formatMessageForAnthropic(m)),
      };
      if (plan.providerSettings?.thinking) {
        body.thinking = plan.providerSettings.thinking;
      }
      if (plan.temperature !== undefined) {
        body.temperature = plan.temperature;
      }
      // Caller-provided function tools
      const anthropicTools: Array<Record<string, unknown>> = [];
      if (tools && tools.length > 0) {
        for (const t of tools) {
          const fn = (t as { function?: { name?: string; description?: string; parameters?: unknown } }).function;
          anthropicTools.push(fn ? { name: fn.name, description: fn.description, input_schema: fn.parameters } : t);
        }
      }
      // Provider tools (computer use, etc.)
      if (providerTools && providerTools.length > 0) {
        anthropicTools.push(...providerTools);
      }
      if (anthropicTools.length > 0) {
        body.tools = anthropicTools;
      }

      extractText = (d) => {
        const content = d.content as Array<{ type?: string; text?: string }> | undefined;
        return content?.filter((b) => b.type === "text").map((b) => b.text ?? "").join("") ?? "";
      };
      extractToolCalls = (d) => {
        const contentBlocks = d.content as Array<{ type?: string; id?: string; name?: string; input?: Record<string, unknown> }> | undefined;
        return extractAnthropicToolCalls(contentBlocks ?? []);
      };
      extractUsage = (d) => {
        const usage = typeof d.usage === "object" && d.usage !== null ? d.usage as Record<string, unknown> : {};
        return {
          inputTokens: readUsageNumber(usage, "input_tokens"),
          outputTokens: readUsageNumber(usage, "output_tokens"),
        };
      };
    } else if (providerId === "gemini") {
      // ── Gemini ─────────────────────────────────────────────────────────
      chatUrl = `${provider.baseUrl}/models/${modelId}:generateContent`;
      const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
      if (systemPrompt) {
        contents.push({ role: "user", parts: [{ text: systemPrompt }] });
        contents.push({ role: "model", parts: [{ text: "Understood. I will follow these instructions." }] });
      }
      for (const m of messages) {
        if (m.role === "tool") continue;
        const textContent = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: textContent }] });
      }
      body = { contents };
      if (plan.maxTokens) {
        body.generationConfig = { maxOutputTokens: plan.maxTokens };
      }
      if (plan.temperature !== undefined) {
        body.generationConfig = { ...(body.generationConfig as Record<string, unknown> ?? {}), temperature: plan.temperature };
      }
      // Provider tools (code_execution, google_search_retrieval)
      if (providerTools && providerTools.length > 0) {
        body.tools = [...(body.tools as Array<Record<string, unknown>> ?? []), ...providerTools];
      }

      extractText = (d) => {
        const candidates = d.candidates as Array<{ content?: { parts?: Array<Record<string, unknown>> } }> | undefined;
        const parts = candidates?.[0]?.content?.parts ?? [];
        const textParts: string[] = [];
        for (const p of parts) {
          if (typeof p.text === "string") {
            textParts.push(p.text);
          } else if (p.executableCode && typeof p.executableCode === "object") {
            const code = (p.executableCode as { code?: string }).code ?? "";
            textParts.push(`\`\`\`\n${code}\n\`\`\``);
          } else if (p.codeExecutionResult && typeof p.codeExecutionResult === "object") {
            const output = (p.codeExecutionResult as { output?: string }).output ?? "";
            textParts.push(`Output: ${output}`);
          }
        }
        return textParts.join("\n") || "";
      };
      extractToolCalls = (d) => {
        // Gemini returns functionCall parts
        const candidates = d.candidates as Array<{ content?: { parts?: Array<Record<string, unknown>> } }> | undefined;
        const parts = candidates?.[0]?.content?.parts ?? [];
        const calls: ToolCallEntry[] = [];
        for (const p of parts) {
          if (p.functionCall && typeof p.functionCall === "object") {
            const fc = p.functionCall as { name?: string; args?: Record<string, unknown> };
            calls.push({
              id: `gemini_${Math.random().toString(36).slice(2, 9)}`,
              name: fc.name ?? "",
              arguments: fc.args ?? {},
            });
          }
        }
        return calls;
      };
      extractUsage = (d) => {
        const meta = typeof d.usageMetadata === "object" && d.usageMetadata !== null
          ? d.usageMetadata as Record<string, unknown>
          : {};
        return {
          inputTokens: readUsageNumber(meta, "promptTokenCount"),
          outputTokens: readUsageNumber(meta, "candidatesTokenCount"),
        };
      };
    } else {
      // ── OpenAI-compatible ──────────────────────────────────────────────
      const apiBase = provider.baseUrl.endsWith("/v1") ? provider.baseUrl : `${provider.baseUrl}/v1`;
      chatUrl = `${apiBase}/chat/completions`;
      const allMessages = [
        { role: "system" as const, content: systemPrompt },
        ...messages.map((m) => formatMessageForOpenAI(m)),
      ];
      body = { model: modelId, messages: allMessages, max_tokens: plan.maxTokens, keep_alive: -1 };
      if (plan.temperature !== undefined) body.temperature = plan.temperature;
      if (plan.providerSettings?.reasoning_effort) body.reasoning_effort = plan.providerSettings.reasoning_effort;
      if (plan.toolPolicy?.toolChoice && tools && tools.length > 0) {
        body.tool_choice = plan.toolPolicy.toolChoice;
      }
      if (tools && tools.length > 0) {
        body.tools = tools;
      }

      extractText = (d) => {
        const msg = (d.choices as Array<{ message?: { content?: string; reasoning?: string } }>)?.[0]?.message;
        return msg?.content || msg?.reasoning || "";
      };
      extractToolCalls = (d) => {
        const rawMsg = (d.choices as Array<{ message?: { tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>)?.[0]?.message;
        if (rawMsg?.tool_calls && rawMsg.tool_calls.length > 0) {
          return extractOpenAIToolCalls(rawMsg.tool_calls);
        }
        return [];
      };
      extractUsage = (d) => {
        const usage = typeof d.usage === "object" && d.usage !== null ? d.usage as Record<string, unknown> : {};
        return {
          inputTokens: readUsageNumber(usage, "input_tokens", "prompt_tokens"),
          outputTokens: readUsageNumber(usage, "output_tokens", "completion_tokens"),
        };
      };
    }

    // ── Execute HTTP request ─────────────────────────────────────────────
    const startMs = Date.now();
    let res: Response;
    try {
      res = await fetch(chatUrl, {
        method: "POST",
        headers: provider.headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      throw new InferenceError(
        `Network error calling ${providerId}: ${e instanceof Error ? e.message : String(e)}`,
        "network",
        providerId,
      );
    }
    const inferenceMs = Date.now() - startMs;

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw classifyHttpError(res.status, providerId, errBody, res.headers);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const usage = extractUsage(data);
    const toolCalls = extractToolCalls(data);

    return {
      text: extractText(data),
      toolCalls,
      usage,
      inferenceMs,
      raw: data,
    };
  },
};

// Auto-register at module load
registerExecutionAdapter(chatAdapter);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/lib/routing/chat-adapter.test.ts --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/chat-adapter.ts apps/web/lib/routing/chat-adapter.test.ts
git commit -m "feat(routing): EP-INF-008a chat adapter — extract per-provider dispatch from callProvider"
```

---

## Task 9: Refactor callProvider() to use adapter dispatch

**Files:**
- Modify: `apps/web/lib/ai-inference.ts:299-462`

- [ ] **Step 1: Refactor callProvider()**

Replace the body of `callProvider()` (lines 300-462 of `apps/web/lib/ai-inference.ts`) with the thin dispatcher. Keep the existing function signature (backward compat).

**First**, add static imports at the top of `ai-inference.ts`:
```typescript
import { getExecutionAdapter } from "./routing/execution-adapter-registry";
import "./routing/chat-adapter"; // side-effect: registers "chat" adapter
```

**Second**, export `classifyHttpError` (currently private, line 50). Add `export` keyword:
```typescript
export function classifyHttpError(
```

**Third**, replace callProvider body:
```typescript
export async function callProvider(
  providerId: string,
  modelId: string,
  messages: ChatMessage[],
  systemPrompt: string,
  tools?: Array<Record<string, unknown>>,
  plan?: RoutedExecutionPlan,
): Promise<InferenceResult> {
  // 1. Resolve provider (DB lookup + auth headers)
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) throw new InferenceError("Provider not found", "provider_error", providerId);
  const baseUrl = provider.baseUrl ?? provider.endpoint;
  if (!baseUrl) throw new InferenceError("No base URL configured", "provider_error", providerId);
  const headers = await buildAuthHeaders(providerId, provider.authMethod, provider.authHeader);

  // 2. Build minimal plan if none provided (backward compat)
  const effectivePlan: RoutedExecutionPlan = plan ?? {
    providerId,
    modelId,
    recipeId: null,
    contractFamily: "unknown",
    executionAdapter: "chat",
    maxTokens: 4096,
    providerSettings: {},
    toolPolicy: {},
    responsePolicy: {},
  };

  // 3. Dispatch to adapter
  const adapter = getExecutionAdapter(effectivePlan.executionAdapter);
  const result = await adapter.execute({
    providerId,
    modelId,
    plan: effectivePlan,
    provider: { baseUrl, headers },
    messages,
    systemPrompt,
    tools,
  });

  // 4. Map AdapterResult → InferenceResult
  return {
    content: result.text,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    inferenceMs: result.inferenceMs,
    ...(result.toolCalls.length > 0 && { toolCalls: result.toolCalls }),
  };
}
```

Note: `classifyHttpError` (now exported), `extractAnthropicToolCalls`, `extractOpenAIToolCalls`, `formatMessageForAnthropic`, and `formatMessageForOpenAI` stay in `ai-inference.ts` as exports (the chat adapter imports them). The old per-provider branching code in callProvider() is removed since it now lives in `chat-adapter.ts`. If circular dependency issues arise between `ai-inference.ts` and `chat-adapter.ts`, fall back to dynamic `await import()` as a workaround.

- [ ] **Step 2: Run the full routing test suite**

Run: `npx vitest run apps/web/lib/routing/ --reporter=verbose`
Expected: All 521+ tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/ai-inference.ts
git commit -m "feat(routing): EP-INF-008a refactor callProvider to use adapter dispatch"
```

---

## Task 10: Request Contract Tests & Barrel Export

**Files:**
- Modify: `apps/web/lib/routing/request-contract.test.ts`
- Modify: `apps/web/lib/routing/index.ts`

- [ ] **Step 1: Write new request contract tests**

Add to `apps/web/lib/routing/request-contract.test.ts`:

```typescript
// ── Capability flags (EP-INF-008b) ──────────────────────────────────────────

describe("inferContract – capability flags", () => {
  it("sets requiresWebSearch for web-search task type", async () => {
    const contract = await inferContract("web-search", SIMPLE_MESSAGES);
    expect(contract.requiresWebSearch).toBe(true);
  });

  it("does not set requiresWebSearch for non-web-search tasks", async () => {
    const contract = await inferContract("greeting", SIMPLE_MESSAGES);
    expect(contract.requiresWebSearch).toBeUndefined();
  });

  it("sets requiresCodeExecution from route context", async () => {
    const contract = await inferContract("code-gen", SIMPLE_MESSAGES, undefined, undefined, {
      requiresCodeExecution: true,
    });
    expect(contract.requiresCodeExecution).toBe(true);
  });

  it("sets requiresComputerUse from route context", async () => {
    const contract = await inferContract("tool-action", SIMPLE_MESSAGES, undefined, undefined, {
      requiresComputerUse: true,
    });
    expect(contract.requiresComputerUse).toBe(true);
  });

  it("does not set capability flags by default", async () => {
    const contract = await inferContract("greeting", SIMPLE_MESSAGES);
    expect(contract.requiresCodeExecution).toBeUndefined();
    expect(contract.requiresComputerUse).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run apps/web/lib/routing/request-contract.test.ts --reporter=verbose`
Expected: All tests PASS (implementation was done in Task 2)

- [ ] **Step 3: Update barrel exports in index.ts**

Add to `apps/web/lib/routing/index.ts`:

```typescript
// EP-INF-008a: Execution adapter framework
export type { ExecutionAdapterHandler, AdapterRequest, AdapterResult, ResolvedProvider, ToolCallEntry } from "./adapter-types";
export { registerExecutionAdapter, getExecutionAdapter } from "./execution-adapter-registry";
export { chatAdapter } from "./chat-adapter";

// EP-INF-008b: Provider tools
export { buildProviderTools } from "./provider-tools";
export { isAnthropic, isOpenAI } from "./provider-utils";
```

- [ ] **Step 4: Run full routing test suite**

Run: `npx vitest run apps/web/lib/routing/ --reporter=verbose`
Expected: All tests PASS (521 existing + ~30 new)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/request-contract.test.ts apps/web/lib/routing/index.ts
git commit -m "feat(routing): EP-INF-008a/008b barrel exports and request contract tests"
```

---

## Task 11: Final Verification

- [ ] **Step 1: Run full routing test suite one final time**

Run: `npx vitest run apps/web/lib/routing/ --reporter=verbose`
Expected: All tests PASS, count should be 521 + ~30 new = ~550+

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit --project apps/web/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Verify test count**

Count total tests across all routing test files. Should be 550+ (521 existing + new tests from tasks 3-10).
