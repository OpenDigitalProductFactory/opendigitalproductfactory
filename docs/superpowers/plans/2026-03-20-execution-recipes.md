# EP-INF-005b: Execution Recipes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add versioned ExecutionRecipe table, deterministic recipe seeding, RoutedExecutionPlan output, and execution layer integration so routing decisions fully control how models are called.

**Architecture:** ExecutionRecipe Prisma table → recipe seeder generates seed recipes from ModelCard + contract → recipe loader fetches champion recipe → execution plan builder translates recipe into call parameters → callProvider() uses plan instead of hardcoded values.

**Tech Stack:** TypeScript, Vitest (globals: false), Prisma

**Spec:** `docs/superpowers/specs/2026-03-20-execution-recipes-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `apps/web/lib/routing/recipe-types.ts` | `RoutedExecutionPlan` type |
| `apps/web/lib/routing/recipe-seeder.ts` | `buildSeedRecipe()`, `seedRecipesForModel()` |
| `apps/web/lib/routing/recipe-loader.ts` | `loadChampionRecipe()` |
| `apps/web/lib/routing/execution-plan.ts` | `buildPlanFromRecipe()`, `buildDefaultPlan()` |
| `apps/web/lib/routing/recipe-seeder.test.ts` | Seed logic tests |
| `apps/web/lib/routing/recipe-loader.test.ts` | Loader tests (mock Prisma) |
| `apps/web/lib/routing/execution-plan.test.ts` | Plan building tests |

### Modified Files

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add `ExecutionRecipe` model |
| `apps/web/lib/routing/types.ts` | Add optional recipe/plan fields to `RouteDecision` |
| `apps/web/lib/routing/pipeline-v2.ts` | Add recipe lookup + plan output |
| `apps/web/lib/ai-inference.ts` | Add optional `plan` parameter to `callProvider()` |
| `apps/web/lib/routing/fallback.ts` | Pass plan through to `callProvider()` |
| `apps/web/lib/routing/index.ts` | Export new modules |

---

## Task 1: Recipe Types + Execution Plan Builder

**Files:**
- Create: `apps/web/lib/routing/recipe-types.ts`
- Create: `apps/web/lib/routing/execution-plan.ts`
- Create: `apps/web/lib/routing/execution-plan.test.ts`

- [ ] **Step 1: Create recipe-types.ts**

```typescript
// apps/web/lib/routing/recipe-types.ts

export interface RoutedExecutionPlan {
  providerId: string;
  modelId: string;
  recipeId: string | null;
  contractFamily: string;

  maxTokens: number;
  temperature?: number;
  providerSettings: Record<string, unknown>;
  toolPolicy: {
    toolChoice?: "auto" | "required" | "none";
    allowParallelToolCalls?: boolean;
  };
  responsePolicy: {
    strictSchema?: boolean;
    stream?: boolean;
  };
}

export interface RecipeRow {
  id: string;
  providerId: string;
  modelId: string;
  contractFamily: string;
  version: number;
  status: string;
  origin: string;
  providerSettings: unknown;
  toolPolicy: unknown;
  responsePolicy: unknown;
}
```

- [ ] **Step 2: Write failing tests for execution-plan**

Test cases:
- `buildPlanFromRecipe` extracts maxTokens from providerSettings
- `buildPlanFromRecipe` extracts temperature from providerSettings
- `buildPlanFromRecipe` passes through remaining providerSettings
- `buildPlanFromRecipe` maps toolPolicy and responsePolicy
- `buildPlanFromRecipe` sets recipeId from recipe.id
- `buildDefaultPlan` uses max_tokens=4096
- `buildDefaultPlan` sets recipeId to null
- `buildDefaultPlan` uses contract's tool/response requirements

- [ ] **Step 3: Implement execution-plan.ts**

```typescript
import type { RoutedExecutionPlan, RecipeRow } from "./recipe-types";
import type { EndpointManifest } from "./types";
import type { RequestContract } from "./request-contract";

export function buildPlanFromRecipe(
  recipe: RecipeRow,
  contract: RequestContract,
): RoutedExecutionPlan {
  const settings = recipe.providerSettings as Record<string, unknown>;
  const toolPolicy = recipe.toolPolicy as Record<string, unknown>;
  const responsePolicy = recipe.responsePolicy as Record<string, unknown>;

  const { max_tokens, temperature, ...rest } = settings;

  return {
    providerId: recipe.providerId,
    modelId: recipe.modelId,
    recipeId: recipe.id,
    contractFamily: recipe.contractFamily,
    maxTokens: typeof max_tokens === "number" ? max_tokens : 4096,
    temperature: typeof temperature === "number" ? temperature : undefined,
    providerSettings: rest,
    toolPolicy: {
      toolChoice: toolPolicy.toolChoice as any,
      allowParallelToolCalls: toolPolicy.allowParallelToolCalls as any,
    },
    responsePolicy: {
      strictSchema: responsePolicy.strictSchema as any,
      stream: responsePolicy.stream as any,
    },
  };
}

export function buildDefaultPlan(
  endpoint: EndpointManifest,
  contract: RequestContract,
): RoutedExecutionPlan {
  return {
    providerId: endpoint.providerId,
    modelId: endpoint.modelId,
    recipeId: null,
    contractFamily: contract.contractFamily,
    maxTokens: 4096,
    providerSettings: {},
    toolPolicy: {
      toolChoice: contract.requiresTools ? "auto" : undefined,
    },
    responsePolicy: {
      strictSchema: contract.requiresStrictSchema,
      stream: contract.requiresStreaming,
    },
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/web && npx vitest run lib/routing/execution-plan.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/recipe-types.ts apps/web/lib/routing/execution-plan.ts apps/web/lib/routing/execution-plan.test.ts
git commit -m "feat(routing): EP-INF-005b recipe types and execution plan builder with TDD"
```

---

## Task 2: Recipe Seeder

**Files:**
- Create: `apps/web/lib/routing/recipe-seeder.ts`
- Create: `apps/web/lib/routing/recipe-seeder.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases for `buildSeedRecipe()` (pure function, no DB):
- Anthropic + high reasoning + thinking capable → providerSettings includes `thinking: { type: "enabled", budget_tokens: 8192 }`
- Anthropic + medium reasoning + adaptive thinking capable → `thinking: { type: "adaptive" }`
- Anthropic + minimal reasoning → no thinking settings
- OpenAI reasoning model (modelClass "reasoning") + medium → `reasoning_effort: "medium"`
- OpenAI reasoning model + high → `reasoning_effort: "high"`
- OpenAI chat model + minimize_cost → `temperature: 0.3`
- OpenAI chat model + quality_first → `temperature: 1.0`
- Ollama → `keep_alive: -1`
- Unknown provider → generic (max_tokens only)
- Tool contract → toolPolicy.toolChoice: "auto"
- No tools contract → toolPolicy.toolChoice: undefined
- Schema contract → responsePolicy.strictSchema: true
- maxTokens: estimatedOutputTokens × 2, floor 1024, capped by model maxOutputTokens
- maxTokens: when model maxOutputTokens is null, use estimatedOutputTokens × 2

- [ ] **Step 2: Run tests, verify fail**

- [ ] **Step 3: Implement recipe-seeder.ts**

Key implementation:
- `buildSeedRecipe(providerId, modelId, contractFamily, modelCard, contract)` — pure function returning `{ providerSettings, toolPolicy, responsePolicy }`
- Provider detection: check `providerId` prefix for anthropic/ollama, check `modelCard.modelClass` for reasoning vs chat
- `THINKING_BUDGETS: Record<string, number> = { medium: 4096, high: 8192 }`
- `REASONING_EFFORT_MAP: Record<string, string> = { minimal: "low", low: "low", medium: "medium", high: "high" }`
- `deriveMaxTokens(contract, modelCard)`: `Math.min(Math.max(contract.estimatedOutputTokens * 2, 1024), modelCard.maxOutputTokens ?? 4096)`
- `seedRecipesForModel(providerId, modelId)` — async, queries DB for ModelProfile + existing recipes, creates missing seed recipes. This function will be tested separately or integrated in Task 5.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/recipe-seeder.ts apps/web/lib/routing/recipe-seeder.test.ts
git commit -m "feat(routing): EP-INF-005b recipe seeder with TDD"
```

---

## Task 3: Recipe Loader + Prisma Migration

**Files:**
- Create: `apps/web/lib/routing/recipe-loader.ts`
- Create: `apps/web/lib/routing/recipe-loader.test.ts`
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add ExecutionRecipe to Prisma schema**

```prisma
model ExecutionRecipe {
  id                    String    @id @default(cuid())
  providerId            String
  modelId               String
  contractFamily        String
  version               Int       @default(1)
  status                String    @default("champion")
  origin                String    @default("seed")
  providerSettings      Json
  toolPolicy            Json      @default("{}")
  responsePolicy        Json      @default("{}")
  parentRecipeId        String?
  mutationSummary       String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  promotedAt            DateTime?
  retiredAt             DateTime?

  @@unique([providerId, modelId, contractFamily, version])
  @@index([contractFamily, status])
}
```

- [ ] **Step 2: Run migration**

Use the manual approach (drift-safe):
1. Create migration directory and SQL
2. Apply with `prisma db execute`
3. Register with `prisma migrate resolve --applied`
4. Regenerate: `npx prisma generate`

- [ ] **Step 3: Write failing tests for recipe-loader**

Test cases (mock Prisma):
- Returns champion recipe for matching (provider, model, contractFamily)
- Returns null when no recipe exists
- Ignores retired recipes
- Ignores blocked recipes
- Returns highest version if multiple champions exist (defensive)

- [ ] **Step 4: Implement recipe-loader.ts**

```typescript
import { prisma } from "@dpf/db";
import type { RecipeRow } from "./recipe-types";

export async function loadChampionRecipe(
  providerId: string,
  modelId: string,
  contractFamily: string,
): Promise<RecipeRow | null> {
  const recipe = await prisma.executionRecipe.findFirst({
    where: {
      providerId,
      modelId,
      contractFamily,
      status: "champion",
    },
    orderBy: { version: "desc" },
  });
  return recipe as RecipeRow | null;
}
```

- [ ] **Step 5: Run tests, verify pass**

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ apps/web/lib/routing/recipe-loader.ts apps/web/lib/routing/recipe-loader.test.ts
git commit -m "feat(routing): EP-INF-005b ExecutionRecipe table and recipe loader with TDD"
```

---

## Task 4: Pipeline V2 Recipe Integration

**Files:**
- Modify: `apps/web/lib/routing/types.ts`
- Modify: `apps/web/lib/routing/pipeline-v2.ts`

- [ ] **Step 1: Add optional fields to RouteDecision type**

Read `apps/web/lib/routing/types.ts`. Add to the `RouteDecision` interface:

```typescript
  // EP-INF-005b: Execution recipe fields
  selectedRecipeId?: string;
  selectedRecipeVersion?: number;
  executionPlan?: import("./recipe-types").RoutedExecutionPlan;
```

- [ ] **Step 2: Update routeEndpointV2() to look up recipe and build plan**

Read `apps/web/lib/routing/pipeline-v2.ts`. After the winner is selected and before the RouteDecision is returned:

```typescript
import { loadChampionRecipe } from "./recipe-loader";
import { buildPlanFromRecipe, buildDefaultPlan } from "./execution-plan";

// After selecting winner...
const recipe = await loadChampionRecipe(winner.endpoint.providerId, winner.endpoint.modelId, contract.contractFamily);
const executionPlan = recipe
  ? buildPlanFromRecipe(recipe, contract)
  : buildDefaultPlan(winner.endpoint, contract);
```

Add `selectedRecipeId`, `selectedRecipeVersion`, and `executionPlan` to the returned RouteDecision.

**IMPORTANT:** `routeEndpointV2()` is currently synchronous. Adding `loadChampionRecipe()` (a DB call) makes it async. Update the signature to `async function routeEndpointV2(...): Promise<RouteDecision>`. Update all callers (pipeline-v2.test.ts) to await it.

- [ ] **Step 3: Update pipeline-v2.test.ts**

Update all `routeEndpointV2()` calls to use `await`. Add test:
- With a mocked recipe, RouteDecision includes `selectedRecipeId` and `executionPlan`
- Without a recipe, `executionPlan` uses default plan

- [ ] **Step 4: Run tests**

Run: `cd apps/web && npx vitest run lib/routing/pipeline-v2.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/types.ts apps/web/lib/routing/pipeline-v2.ts apps/web/lib/routing/pipeline-v2.test.ts
git commit -m "feat(routing): EP-INF-005b recipe lookup in pipeline-v2, async routeEndpointV2"
```

---

## Task 5: Execution Layer Integration

**Files:**
- Modify: `apps/web/lib/ai-inference.ts`
- Modify: `apps/web/lib/routing/fallback.ts`

- [ ] **Step 1: Read callProvider() in ai-inference.ts**

Read lines 299-440 to understand the current structure.

- [ ] **Step 2: Add optional plan parameter to callProvider()**

Update signature:
```typescript
export async function callProvider(
  providerId: string,
  modelId: string,
  messages: ChatMessage[],
  systemPrompt: string,
  tools?: Array<Record<string, unknown>>,
  plan?: RoutedExecutionPlan,
): Promise<InferenceResult>
```

Import `RoutedExecutionPlan` from `./routing/recipe-types`.

- [ ] **Step 3: Use plan parameters in request body construction**

In each provider branch, replace hardcoded values with plan values when plan is provided:

**Anthropic branch (around line 319-341):**
```typescript
body = {
  model: modelId,
  max_tokens: plan?.maxTokens ?? 4096,
  system: systemPrompt,
  messages: ...,
};
// Add thinking config from plan
if (plan?.providerSettings?.thinking) {
  body.thinking = plan.providerSettings.thinking;
}
// Add temperature if set
if (plan?.temperature !== undefined) {
  body.temperature = plan.temperature;
}
```

**OpenAI-compatible branch (around line 360-379):**
```typescript
body = {
  model: modelId,
  messages: allMessages,
  max_tokens: plan?.maxTokens ?? 4096,
  keep_alive: -1,
};
// Add provider settings from plan
if (plan?.temperature !== undefined) body.temperature = plan.temperature;
if (plan?.providerSettings?.reasoning_effort) body.reasoning_effort = plan.providerSettings.reasoning_effort;
// Tool choice from plan
if (plan?.toolPolicy?.toolChoice && tools && tools.length > 0) {
  body.tool_choice = plan.toolPolicy.toolChoice;
}
```

**Gemini branch:** Apply `max_tokens` as `maxOutputTokens` in the Gemini `generationConfig`.

- [ ] **Step 4: Update callWithFallbackChain() in fallback.ts**

Add optional `plan` parameter. Pass it to `callProvider()` only for the primary (first) attempt. Fallbacks use default parameters.

```typescript
export async function callWithFallbackChain(
  decision: RouteDecision,
  messages: ChatMessage[],
  systemPrompt: string,
  tools?: Array<Record<string, unknown>>,
  plan?: RoutedExecutionPlan,
): Promise<FallbackResult>
```

In the loop, pass plan only for `i === 0`:
```typescript
const result = await callProvider(
  entry.providerId, entry.modelId, messages, systemPrompt, tools,
  i === 0 ? plan : undefined,
);
```

- [ ] **Step 5: Verify existing tests pass**

Run: `cd apps/web && npx vitest run lib/ai-inference.test.ts lib/routing/fallback.test.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/ai-inference.ts apps/web/lib/routing/fallback.ts
git commit -m "feat(routing): EP-INF-005b callProvider uses execution plan parameters"
```

---

## Task 6: Update Exports + Verification

**Files:**
- Modify: `apps/web/lib/routing/index.ts`

- [ ] **Step 1: Add exports**

```typescript
// EP-INF-005b: Execution recipes
export type { RoutedExecutionPlan, RecipeRow } from "./recipe-types";
export { buildPlanFromRecipe, buildDefaultPlan } from "./execution-plan";
export { buildSeedRecipe, seedRecipesForModel } from "./recipe-seeder";
export { loadChampionRecipe } from "./recipe-loader";
```

- [ ] **Step 2: Run full routing test suite**

Run: `cd apps/web && npx vitest run lib/routing/`
Expected: All tests pass.

- [ ] **Step 3: Run type check**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/routing/index.ts
git commit -m "feat(routing): EP-INF-005b export execution recipe modules"
```
