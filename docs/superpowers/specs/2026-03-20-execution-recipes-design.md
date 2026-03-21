# EP-INF-005b: Execution Recipes

**Date:** 2026-03-20
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (COO/design partner)
**Epic:** EP-INF-005b

**Prerequisites:**
- EP-INF-003 (Provider Model Registry) — implemented. ModelCard with capabilities, pricing, parameters.
- EP-INF-004 (Rate Limits & Capacity) — implemented. Rate tracking, auto-recovery.
- EP-INF-005a (Contract-Based Selection) — implemented. RequestContract, cost-per-success ranking, routeEndpointV2.

**Related:**
- [2026-03-20-adaptive-model-routing-design.md](2026-03-20-adaptive-model-routing-design.md) — master vision (Sections 1.3, 3.2-3.3, 4)
- [2026-03-20-contract-based-selection-design.md](2026-03-20-contract-based-selection-design.md) — EP-INF-005a

**Followed by:**
- EP-INF-006: Adaptive Loop — champion/challenger evolution, outcome recording, promotion gates

---

## Problem Statement

The routing pipeline now selects the right model (EP-INF-005a), but the execution layer ignores the selection's context. `callProvider()` hardcodes `max_tokens: 4096` for every request, regardless of task type. It never sets `temperature`, `reasoning_effort`, `thinking` budgets, `tool_choice`, or `strict` schema mode — even though providers support these and the `RequestContract` captures the intent.

Verified problems:

1. **`max_tokens: 4096` hardcoded for all calls.** At `ai-inference.ts` lines 324 and 369. A greeting gets the same output budget as a code generation task. A model with 128K output capacity is capped at 4K.

2. **No provider-specific parameter construction.** Anthropic supports extended thinking with budget control. OpenAI reasoning models support `reasoning_effort`. Neither is used. The `RequestContract.reasoningDepth` field has no path to the execution layer.

3. **No execution audit trail.** When a request succeeds or fails, there's no record of what parameters were used. "Why did this code generation use max_tokens=4096 with no thinking enabled on Claude Opus?" is unanswerable.

4. **No unit for evolution.** EP-INF-006 needs to evolve "how to call model X for task Y" over time. Without a versioned recipe abstraction, there's nothing to mutate, compare, or promote.

---

## Goals

1. Create an `ExecutionRecipe` table — one row per (provider, model, contractFamily) — storing provider-specific call parameters.
2. Seed recipes deterministically from ModelCard capabilities + RequestContract requirements.
3. Produce a `RoutedExecutionPlan` from routing that tells the execution layer exactly how to call the model.
4. Update the execution layer to use plan parameters instead of hardcoded values.
5. Provide the foundation EP-INF-006 needs for champion/challenger evolution.

## Non-Goals

1. Recipe mutation or evolution (EP-INF-006).
2. Champion/challenger exploration (EP-INF-006).
3. Outcome recording or reward functions (EP-INF-006).
4. System prompt templates or instruction fragments (system prompt comes from agent/task context).
5. Replacing `callProvider()` — wrap it, don't rewrite it.

---

## Section 1: ExecutionRecipe Table

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

### Field Semantics

**`providerSettings: Json`** — Provider-specific call parameters. Examples:

Anthropic + high reasoning:
```json
{ "max_tokens": 8192, "thinking": { "type": "enabled", "budget_tokens": 8192 } }
```

OpenAI reasoning model + medium:
```json
{ "max_tokens": 4096, "reasoning_effort": "medium" }
```

OpenAI chat model + minimize_cost:
```json
{ "max_tokens": 4096, "temperature": 0.3 }
```

Ollama:
```json
{ "max_tokens": 4096, "keep_alive": -1 }
```

**`toolPolicy: Json`** — Tool calling behavior:
```json
{ "toolChoice": "auto", "allowParallelToolCalls": true }
```

**`responsePolicy: Json`** — Response format control:
```json
{ "strictSchema": true, "stream": true }
```

**`status`** — Recipe lifecycle:
- `"champion"` — active recipe for this (provider, model, contractFamily). One per combination.
- `"candidate"` — challenger (EP-INF-006). Not used until evolution is enabled.
- `"retired"` — superseded by a newer version. Kept for audit trail.
- `"blocked"` — manually disabled. Routing skips this recipe.

**`origin`** — How the recipe was created:
- `"seed"` — auto-generated from ModelCard + contract requirements
- `"manual"` — human-created or edited
- `"mutation"` — EP-INF-006 generated from a parent recipe
- `"provider-guided"` — created from provider documentation guidance

**`version`** — Increments when a new recipe replaces the old one for the same (provider, model, contractFamily). Old version gets `status: "retired"`.

---

## Section 2: RoutedExecutionPlan

The output of routing — a complete instruction for the execution layer.

```typescript
interface RoutedExecutionPlan {
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
```

### Building the Plan

**From recipe (when one exists):**
```typescript
function buildPlanFromRecipe(recipe: ExecutionRecipe, contract: RequestContract): RoutedExecutionPlan
```
Extracts `maxTokens` from `recipe.providerSettings.max_tokens`, overlays `toolPolicy` and `responsePolicy`, and passes through remaining `providerSettings`.

**From defaults (when no recipe exists):**
```typescript
function buildDefaultPlan(endpoint: EndpointManifest, contract: RequestContract): RoutedExecutionPlan
```
Uses `max_tokens: 4096` (current behavior), no temperature, no provider-specific settings. This is the backward-compatible fallback.

---

## Section 3: Recipe Seeding

Deterministic generation of seed recipes from ModelCard + RequestContract.

### Seed Function

```typescript
async function seedRecipesForModel(providerId: string, modelId: string): Promise<number>
```

For each known contract family:
1. Check if a champion recipe already exists for (provider, model, family)
2. If not, build a seed recipe using `buildSeedRecipe()`
3. Insert with `status: "champion"`, `origin: "seed"`, `version: 1`

### Provider-Specific Parameter Construction

**`buildSeedRecipe(providerId, modelId, contractFamily, modelCard, contract)`:**

The seed function uses the ModelCard capabilities and contract requirements to construct `providerSettings`:

**Max tokens derivation:**
```typescript
function deriveMaxTokens(contract: RequestContract, modelCard: ModelCard): number {
  const desired = contract.estimatedOutputTokens * 2; // headroom
  const cap = modelCard.maxOutputTokens ?? 4096;
  return Math.min(Math.max(desired, 1024), cap); // floor 1024, capped by model
}
```

**Anthropic models:**
- If `contract.reasoningDepth` is `"medium"` or `"high"` AND `modelCard.capabilities.thinking === true`:
  - Add `thinking: { type: "enabled", budget_tokens: THINKING_BUDGETS[reasoningDepth] }`
  - `THINKING_BUDGETS: { medium: 4096, high: 8192 }`
- If `modelCard.capabilities.adaptiveThinking === true` AND `reasoningDepth === "medium"`:
  - Use `thinking: { type: "adaptive" }` instead (auto-decides whether to think)

**OpenAI reasoning models** (modelClass === "reasoning"):
- Add `reasoning_effort: REASONING_EFFORT_MAP[reasoningDepth]`
- `REASONING_EFFORT_MAP: { minimal: "low", low: "low", medium: "medium", high: "high" }`

**OpenAI chat models:**
- `temperature`: `minimize_cost` → 0.3, `balanced` → 0.7, `quality_first` → 1.0

**Ollama:**
- `keep_alive: -1` (keep model loaded in VRAM)

**Tool policy from contract:**
- `toolChoice`: `"auto"` if `contract.requiresTools`, undefined otherwise
- `allowParallelToolCalls`: `true` (default — EP-INF-006 can tighten)

**Response policy from contract:**
- `strictSchema`: `contract.requiresStrictSchema`
- `stream`: `contract.requiresStreaming`

### When Seeding Happens

1. **On model discovery** — `profileModelsInternal()` calls `seedRecipesForModel()` after creating/updating a ModelProfile.
2. **Backfill** — `seedAllRecipes()` iterates all active ModelProfiles × all contract families. One-time operation.
3. **Not per-request** — recipes are seeded once and looked up at routing time.

### Contract Families

Initially the 9 sync families from existing task types:
```
sync.greeting, sync.status-query, sync.summarization, sync.reasoning,
sync.data-extraction, sync.code-gen, sync.web-search, sync.creative, sync.tool-action
```

Only seed for feasible combinations — a model that can't do tool use doesn't get a `sync.tool-action` recipe.

---

## Section 4: Execution Integration

### Recipe Lookup in Pipeline V2

After `routeEndpointV2()` selects a winner, load the recipe:

```typescript
const recipe = await loadChampionRecipe(winner.providerId, winner.modelId, contract.contractFamily);
const plan = recipe
  ? buildPlanFromRecipe(recipe, contract)
  : buildDefaultPlan(winner, contract);
```

`loadChampionRecipe()` queries:
```typescript
prisma.executionRecipe.findFirst({
  where: {
    providerId, modelId, contractFamily,
    status: "champion",
  },
  orderBy: { version: "desc" },
})
```

Returns the latest champion version, or null.

### Updating callProvider()

Rather than creating a separate `callProviderWithPlan()`, extend `callProvider()` with an optional plan parameter:

```typescript
export async function callProvider(
  providerId: string,
  modelId: string,
  messages: ChatMessage[],
  systemPrompt: string,
  tools?: Array<Record<string, unknown>>,
  plan?: RoutedExecutionPlan,  // EP-INF-005b: optional execution plan
): Promise<InferenceResult>
```

When `plan` is provided:
- `max_tokens`: use `plan.maxTokens` instead of hardcoded 4096
- `temperature`: add to request body if `plan.temperature` is set
- `reasoning_effort`: add if present in `plan.providerSettings`
- `thinking`: add if present in `plan.providerSettings` (Anthropic)
- `tool_choice`: add if `plan.toolPolicy.toolChoice` is set
- `strict`: set if `plan.responsePolicy.strictSchema` is true (OpenAI structured outputs)
- `stream`: set if `plan.responsePolicy.stream` is true
- All other `plan.providerSettings` entries: merge into request body

When `plan` is not provided: current behavior (hardcoded 4096, no extra params). Full backward compatibility.

### Fallback Chain Integration

`callWithFallbackChain()` receives the plan and passes it through:

```typescript
export async function callWithFallbackChain(
  decision: RouteDecision,
  messages: ChatMessage[],
  systemPrompt: string,
  tools?: Array<Record<string, unknown>>,
  plan?: RoutedExecutionPlan,  // EP-INF-005b
): Promise<FallbackResult>
```

When falling back to a different model in the chain, the plan for the primary model may not be appropriate for the fallback. Two options:
- **Option A:** Only apply the plan to the primary model. Fallbacks use default parameters.
- **Option B:** Load a fresh recipe for each fallback model.

**Recommendation: Option A.** Fallbacks are rare (model already passed selection), and loading recipes during error handling adds latency and DB calls. The plan applies to the selected model only. Fallbacks use existing defaults.

---

## Section 5: RouteDecision Extension

Add optional execution plan fields to `RouteDecision` for audit trail:

```typescript
// Add to RouteDecision
selectedRecipeId?: string;
selectedRecipeVersion?: number;
executionPlan?: RoutedExecutionPlan;
```

These are optional — the legacy `routeEndpoint()` path doesn't produce them. Only `routeEndpointV2()` with recipe lookup populates them.

---

## Section 6: Testing Strategy

### `recipe-seeder.test.ts` — Seed logic (pure, no DB)
- Anthropic + high reasoning → thinking enabled with 8192 budget
- Anthropic + medium reasoning + adaptive thinking → thinking type "adaptive"
- Anthropic + minimal reasoning → no thinking settings
- OpenAI reasoning model + medium → reasoning_effort: "medium"
- OpenAI chat model + minimize_cost → temperature: 0.3
- OpenAI chat model + quality_first → temperature: 1.0
- Ollama → keep_alive: -1
- Tool contract → toolChoice: "auto"
- Schema contract → strictSchema: true
- maxTokens derived correctly (estimated × 2, capped by model, floor 1024)
- Unknown provider → generic defaults (max_tokens only)

### `recipe-loader.test.ts` — DB lookup (mock Prisma)
- Returns champion recipe for matching (provider, model, contractFamily)
- Returns null when no recipe exists
- Ignores retired/blocked recipes
- Returns highest version when multiple champions exist (shouldn't happen, but defensive)

### `execution-plan.test.ts` — Plan building (pure)
- Builds plan from recipe with all fields
- Builds default plan with max_tokens=4096 fallback
- Plan maxTokens capped by model's maxOutputTokens
- Plan inherits toolPolicy and responsePolicy from recipe

### `callProvider` integration — Verify plan parameters flow into request body
- max_tokens from plan replaces hardcoded 4096
- temperature added when present
- reasoning_effort added for OpenAI reasoning models
- thinking config added for Anthropic
- tool_choice applied when set
- No plan → current behavior (backward compat)

### Backward compatibility
- All existing routing, scoring, pipeline tests unchanged
- `callProvider()` without plan parameter works identically to current behavior
- `callWithFallbackChain()` without plan parameter works identically

---

## Section 7: Files Summary

### New Files

| File | Responsibility |
|---|---|
| `apps/web/lib/routing/recipe-types.ts` | `RoutedExecutionPlan` type, recipe-related types |
| `apps/web/lib/routing/recipe-seeder.ts` | `buildSeedRecipe()`, `seedRecipesForModel()`, `seedAllRecipes()` |
| `apps/web/lib/routing/recipe-loader.ts` | `loadChampionRecipe()` |
| `apps/web/lib/routing/execution-plan.ts` | `buildPlanFromRecipe()`, `buildDefaultPlan()` |
| `apps/web/lib/routing/recipe-seeder.test.ts` | Seed logic tests |
| `apps/web/lib/routing/recipe-loader.test.ts` | Loader tests |
| `apps/web/lib/routing/execution-plan.test.ts` | Plan building tests |

### Modified Files

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add `ExecutionRecipe` table |
| `apps/web/lib/routing/types.ts` | Add optional recipe/plan fields to `RouteDecision` |
| `apps/web/lib/routing/pipeline-v2.ts` | Add recipe lookup + plan output |
| `apps/web/lib/ai-inference.ts` | Add optional `plan` parameter to `callProvider()` |
| `apps/web/lib/routing/fallback.ts` | Pass plan to `callProvider()` |
| `apps/web/lib/routing/index.ts` | Export new modules |

### Unchanged Files

| File | Responsibility |
|---|---|
| `apps/web/lib/routing/scoring.ts` | Legacy path |
| `apps/web/lib/routing/pipeline.ts` | Legacy path |
| `apps/web/lib/routing/request-contract.ts` | Contract inference unchanged |
| `apps/web/lib/routing/cost-ranking.ts` | Ranking unchanged |

---

## Section 8: Relationship to EP-INF-006

| This Epic Delivers | EP-INF-006 Consumes It |
|---|---|
| `ExecutionRecipe` table with `status` field | Champion/challenger uses status to manage recipe lifecycle |
| `version` field + `parentRecipeId` | Mutation creates new version, links to parent |
| `origin: "seed"` recipes | EP-INF-006 mutates seeds into optimized variants |
| Recipe audit trail (version history) | Promotion/demotion history is traceable |
| `RoutedExecutionPlan` with `recipeId` | Outcome recording links results to specific recipes |
| `loadChampionRecipe()` | EP-INF-006 adds `loadChallengerRecipes()` for exploration |

EP-INF-006 activates the dormant recipe lifecycle. It adds:
- `RecipePerformance` table (per-recipe outcome stats)
- `RouteOutcome` recording (unified feedback)
- Challenger traffic allocation (2% default)
- Promotion gates (minimum sample, no regression, statistical significance)
- Recipe mutation (bounded parameter changes)
- Anti-thrash guardrails (max one promotion per 24h)
