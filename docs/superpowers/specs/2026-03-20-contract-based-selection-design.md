# EP-INF-005a: Contract-Based Selection

**Date:** 2026-03-20
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (COO/design partner)
**Epic:** EP-INF-005a

**Prerequisites:**
- EP-INF-003 (Provider Model Registry) — implemented. Provides ModelCard capabilities, multi-tier pricing, model classification.
- EP-INF-004 (Rate Limits & Capacity) — implemented. Provides capacity checks and model-level degradation.

**Related:**
- [2026-03-20-adaptive-model-routing-design.md](2026-03-20-adaptive-model-routing-design.md) — master vision (Sections 1, 3)
- [2026-03-20-provider-model-registry-design.md](2026-03-20-provider-model-registry-design.md) — EP-INF-003
- [2026-03-20-rate-limits-capacity-design.md](2026-03-20-rate-limits-capacity-design.md) — EP-INF-004

**Followed by:**
- EP-INF-005b: Execution Recipes — per-model invocation strategies, `RoutedExecutionPlan` output
- EP-INF-006: Adaptive Loop — champion/challenger, golden test realignment

---

## Problem Statement

The routing pipeline selects models using regex-based task classification and weighted dimension scores. This approach has three structural problems:

1. **Task classification is too coarse.** Nine regex-matched task types (`greeting`, `code-gen`, `tool-action`, etc.) cannot distinguish between a request that needs image input, strict JSON output, deep reasoning, and low latency — all at once. The `TaskRequirementContract` has no modality, no budget posture, no reasoning depth.

2. **Dimension scoring doesn't optimize for what matters.** `computeFitness()` produces a weighted quality score (0-100) with a binary `preferCheap` toggle. It doesn't answer the actual question: "what is the cheapest model that will succeed at this request?" A model scoring 95 always beats one scoring 85, even when 85 exceeds the task's quality floor and costs a tenth as much.

3. **Cost calculation is relative, not absolute.** The cost factor normalizes against the most expensive candidate. Adding or removing a candidate changes every other candidate's score. And null pricing is treated as zero cost, making unknown-cost models look free.

### What Exists Today

- `classifyTask()` in `task-classifier.ts` — regex heuristics producing one of 9 task types
- `TaskRequirementContract` — 8 fields: taskType, description, selectionRationale, requiredCapabilities (4 booleans), preferredMinScores, maxLatencyMs, preferCheap
- `computeFitness()` in `scoring.ts` — weighted dimension sum with relative cost factor
- `TaskRequirement` DB table — stores per-task-type requirements with approval workflow
- EP-INF-003 `ModelCardCapabilities` — boolean capability declarations per model (unused by routing)
- EP-INF-003 `ModelCardPricing` — multi-tier pricing per model (unused by ranking)

---

## Goals

1. Replace `TaskRequirementContract` with a richer `RequestContract` that captures modality, interaction mode, reasoning depth, budget posture, and token estimates.
2. Replace `computeFitness()` with cost-per-success ranking for the new contract path.
3. Add contract inference that deterministically builds a `RequestContract` from request context + DB templates.
4. Add modality-based and capability-based feasibility filtering using EP-INF-003 ModelCard data.
5. Maintain full backward compatibility — old path stays as fallback.

## Non-Goals

1. ExecutionRecipe table or per-model invocation strategies (EP-INF-005b).
2. `RoutedExecutionPlan` output or provider-specific parameter construction (EP-INF-005b).
3. Champion/challenger exploration (EP-INF-006).
4. LLM-assisted contract classification (deferred — deterministic inference covers current task types).
5. Removing the legacy routing path (stays as fallback).

---

## Section 1: RequestContract

The `RequestContract` is the structured input to the new routing path. It captures what a request actually needs from a model.

```typescript
interface RequestContract {
  // ── Identity ───────────────────────────────────────────────────
  contractId: string;              // unique per request (cuid or uuid)
  contractFamily: string;          // "sync.tool_action", "sync.code_gen", etc.
  taskType: string;                // legacy task type, retained for backward compat

  // ── Modality ───────────────────────────────────────────────────
  modality: {
    input: Array<"text" | "image" | "audio" | "file" | "video">;
    output: Array<"text" | "json" | "image" | "audio" | "tool_call">;
  };

  // ── Interaction ────────────────────────────────────────────────
  interactionMode: "sync" | "background" | "batch";
  sensitivity: "public" | "internal" | "confidential" | "restricted";

  // ── Hard Requirements ──────────────────────────────────────────
  requiresTools: boolean;
  requiresStrictSchema: boolean;
  requiresStreaming: boolean;

  // ── Token Estimates ────────────────────────────────────────────
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  minContextTokens?: number;

  // ── Quality/Cost Posture ───────────────────────────────────────
  reasoningDepth: "minimal" | "low" | "medium" | "high";
  budgetClass: "minimize_cost" | "balanced" | "quality_first";

  // ── Constraints ────────────────────────────────────────────────
  maxLatencyMs?: number;
  allowedProviders?: string[];
  residencyPolicy?: "local_only" | "approved_cloud" | "any_enabled";
}
```

### Design Decisions

1. **`contractFamily`** groups similar requests. Derived as `${interactionMode}.${taskType}`. This is the grouping key for EP-INF-005b recipes and EP-INF-006 champion/challenger.

2. **`budgetClass`** replaces the binary `preferCheap`. Three levels: `minimize_cost` (cheapest above quality floor), `balanced` (default), `quality_first` (best model regardless of cost).

3. **`reasoningDepth`** maps to provider parameters in EP-INF-005b. For now, it sets the quality floor: `minimal` → 30, `low` → 45, `medium` → 60, `high` → 75.

4. **`modality`** enables capability-based filtering against EP-INF-003's `ModelCardCapabilities`. If input includes `"image"`, only models with `capabilities.imageInput === true` are eligible.

5. **`estimatedInputTokens`** enables absolute cost estimation using `ModelCardPricing`, replacing the relative cost normalization in `computeFitness()`.

---

## Section 2: Contract Inference

Replaces the role of `classifyTask()` + `loadTaskRequirement()` with a single function that produces a `RequestContract` from request context.

### Function Signature

```typescript
function inferContract(
  taskType: string,
  messages: ChatMessage[],
  tools?: Array<Record<string, unknown>>,
  outputSchema?: Record<string, unknown>,
  routeContext?: {
    sensitivity: string;
    interactionMode?: string;
    maxLatencyMs?: number;
    budgetClass?: string;
    residencyPolicy?: string;
    allowedProviders?: string[];
  },
): Promise<RequestContract>
```

### Two-Stage Inference

**Stage 1: Deterministic extraction** (always runs, cheap, no DB):
- `requiresTools`: `tools !== undefined && tools.length > 0`
- `requiresStrictSchema`: `outputSchema !== undefined`
- `requiresStreaming`: from route context or default `true` for sync
- `modality.input`: scan messages for image/file/audio content blocks → `["text"]` baseline + detected types
- `modality.output`: if tools → `["text", "tool_call"]`, if schema → `["json"]`, else `["text"]`
- `sensitivity`: from route context or default `"internal"`
- `interactionMode`: from route context or default `"sync"`
- `estimatedInputTokens`: sum of message content lengths / 4 (rough char-to-token estimate)
- `estimatedOutputTokens`: from route context or task type default
- `minContextTokens`: `estimatedInputTokens * 1.5`
- `contractId`: generate cuid
- `contractFamily`: `${interactionMode}.${taskType}`

**Stage 2: Template enrichment** (DB lookup):
- Query `TaskRequirement` by `taskType`
- Fill: `reasoningDepth` from template `reasoningDepthDefault` or inferred from task type
- Fill: `budgetClass` from template `budgetClassDefault` or default `"balanced"`
- Fill: `maxLatencyMs` from template or route context
- Fill: `residencyPolicy` from template or route context

Route context values override template defaults (caller knows best).

### Default Reasoning Depth by Task Type

When no template exists:
```typescript
const DEFAULT_REASONING_DEPTH: Record<string, string> = {
  "greeting": "minimal",
  "status-query": "low",
  "summarization": "low",
  "web-search": "low",
  "creative": "medium",
  "data-extraction": "medium",
  "code-gen": "medium",
  "tool-action": "medium",
  "reasoning": "high",
};
```

### TaskRequirement Schema Extension

Add columns to existing `TaskRequirement` table (add-alongside pattern):

```prisma
  // EP-INF-005a: Contract template fields
  reasoningDepthDefault      String    @default("medium")
  budgetClassDefault         String    @default("balanced")
  interactionModeDefault     String    @default("sync")
  supportedInputModalities   Json      @default("[\"text\"]")
  supportedOutputModalities  Json      @default("[\"text\"]")
  residencyPolicy            String?
```

---

## Section 3: Cost-Per-Success Ranking

Replaces `computeFitness()` for the new contract path.

### Estimated Cost

Uses EP-INF-003's multi-tier `ModelCardPricing`:

```typescript
function estimateCost(
  endpoint: EndpointManifest,
  contract: RequestContract,
): number | null {
  const p = endpoint.pricing;
  if (p.inputPerMToken === null || p.outputPerMToken === null) return null;

  const inputCost = (contract.estimatedInputTokens / 1_000_000) * p.inputPerMToken;
  const outputCost = (contract.estimatedOutputTokens / 1_000_000) * p.outputPerMToken;
  return inputCost + outputCost;
}
```

Returns `null` for models with unknown pricing. Null-cost models are penalized in ranking (not treated as free).

### Estimated Success Probability

Without recipe performance data (EP-INF-005b/006), bootstrapped from:

```typescript
function estimateSuccessProbability(
  endpoint: EndpointManifest,
  contract: RequestContract,
): number {
  // Hard capability check — missing required capability = 0
  if (contract.requiresTools && !endpoint.capabilities.toolUse) return 0;
  if (contract.requiresStrictSchema && !endpoint.capabilities.structuredOutput) return 0;
  if (contract.requiresStreaming && !endpoint.capabilities.streaming) return 0;

  // Quality floor based on reasoning depth
  const qualityFloor = REASONING_DEPTH_FLOORS[contract.reasoningDepth];
  const avgScore = averageRelevantDimensions(endpoint, contract.taskType);
  if (avgScore < qualityFloor) return 0.3; // below floor = unlikely to succeed

  // Base probability from historical success rate
  return Math.max(1.0 - endpoint.recentFailureRate, 0.1);
}

const REASONING_DEPTH_FLOORS: Record<string, number> = {
  minimal: 30,
  low: 45,
  medium: 60,
  high: 75,
};
```

`averageRelevantDimensions()` uses the existing `TASK_DIMENSION_MAP` from `production-feedback.ts` to pick which dimension scores matter for a task type. For `code-gen`, that's `codegen` (weight 1.0) + `instructionFollowing` (weight 0.5).

### Ranking Function

```typescript
function rankByCostPerSuccess(
  candidates: Array<{ endpoint: EndpointManifest; successProb: number }>,
  contract: RequestContract,
): Array<{ endpoint: EndpointManifest; rankScore: number; estimatedCost: number | null }> {
  const ranked = candidates.map(c => {
    const cost = estimateCost(c.endpoint, contract);

    let rankScore: number;
    if (contract.budgetClass === "quality_first") {
      // Rank by success probability only
      rankScore = c.successProb * 100;
    } else if (cost === null) {
      // Unknown cost — penalized, ranked by quality only
      rankScore = c.successProb * 50;
    } else if (cost === 0) {
      // Free model (local) — ranked by quality
      rankScore = c.successProb * 100;
    } else {
      // Cost-per-success: lower is better
      const costPerSuccess = cost / c.successProb;
      // Invert so higher = better for sorting, scale for comparability
      rankScore = 1000 / costPerSuccess;

      if (contract.budgetClass === "balanced") {
        // Blend cost efficiency with quality
        rankScore = rankScore * 0.7 + c.successProb * 100 * 0.3;
      }
      // minimize_cost: pure cost-per-success (no quality blend)
    }

    return { endpoint: c.endpoint, rankScore, estimatedCost: cost };
  });

  ranked.sort((a, b) => b.rankScore - a.rankScore);
  return ranked;
}
```

---

## Section 4: Pipeline Integration

### New Pipeline Function: `routeEndpointV2()`

Lives in a new file `pipeline-v2.ts`. Parallel to `routeEndpoint()`, not replacing it.

```typescript
export function routeEndpointV2(
  endpoints: EndpointManifest[],
  contract: RequestContract,
  policies: PolicyRuleEval[],
  overrides: EndpointOverride[],
): RouteDecision
```

**Stages:**
1. **Pin/Block overrides** — reuses existing `checkOverrides()` from pipeline.ts
2. **Policy filter** — reuses existing `filterByPolicy()` from pipeline.ts
3. **Hard filter** — enhanced `filterHardV2()`:
   - All existing checks (status, sensitivity, context window, rate limits)
   - NEW: modality matching — `contract.modality.input` vs `endpoint.capabilities`
   - NEW: capability matching — `contract.requires*` vs `endpoint.capabilities`
   - NEW: residency policy — `contract.residencyPolicy` vs provider category
4. **Cost-per-success ranking** — replaces `computeFitness()`
5. **Capacity penalty** — same as EP-INF-004
6. **Select winner + fallback chain** — same as current

**Output:** Standard `RouteDecision` with full audit trail. No changes to the RouteDecision type — `taskType` comes from `contract.taskType`.

### Enhanced Hard Filter

New exclusion reasons in `filterHardV2()`:

```typescript
// Modality checks
if (contract.modality.input.includes("image") && !ep.capabilities.imageInput) {
  return "requires image input but model lacks imageInput capability";
}
if (contract.modality.input.includes("file") && !ep.capabilities.pdfInput) {
  return "requires file input but model lacks pdfInput capability";
}

// Strict schema check
if (contract.requiresStrictSchema && !ep.capabilities.structuredOutput) {
  return "requires strict schema but model lacks structuredOutput capability";
}

// Residency policy
if (contract.residencyPolicy === "local_only" && ep.providerId !== "ollama") {
  return "residency policy requires local_only but provider is cloud";
}
```

### Call Site Integration

In `agent-coworker.ts`, the routing call changes:

```typescript
// Old path (retained as fallback)
const taskReq = await loadTaskRequirement(classification.taskType);
const decision = routeEndpoint(manifests, taskReq, sensitivity, policies, overrides);

// New path (primary)
const contract = await inferContract(
  classification.taskType, messages, tools, outputSchema,
  { sensitivity, interactionMode: "sync" },
);
const decision = routeEndpointV2(manifests, contract, policies, overrides);
```

The old path fires if `inferContract` fails or returns null. In practice it won't fail (deterministic), but the fallback exists for safety.

### Reused vs Duplicated Logic

- `filterByPolicy()` — already exported from `pipeline.ts`, reused directly
- Pin/block override logic — inline in `routeEndpoint()`, duplicated in `pipeline-v2.ts` (~30 lines)
- `getExclusionReason()` — NOT reused (takes `TaskRequirementContract`). A new `getExclusionReasonV2()` is created in `pipeline-v2.ts` that takes `RequestContract` and reads sensitivity from `contract.sensitivity`
- `averageRelevantDimensions()` — new helper in `cost-ranking.ts`, uses exported `getDimensionsForTask()` from `production-feedback.ts` + a dimension score lookup map

### Capability Null Handling

`ModelCardCapabilities` fields are `boolean | null`. In feasibility checks and success probability, use `!== true` (not `!value`) so that `null` (unknown) is treated conservatively as "does not have capability." This matches the EP-INF-003 principle: unknowns must not satisfy hard requirements.

### Audit Trail

The `RouteDecision` type is unchanged in this epic. Estimated cost and success probability are computed for ranking but not persisted in the route decision log. EP-INF-005b will extend `RouteDecision` with recipe and cost audit fields when the execution plan output is introduced.

---

## Section 5: Testing Strategy

### `request-contract.test.ts` — Contract inference

- Infers `requiresTools: true` when tools array non-empty
- Infers `requiresTools: false` when no tools
- Infers `modality.input: ["text", "image"]` when messages contain image blocks
- Infers `modality.output: ["json"]` when outputSchema provided
- Infers `modality.output: ["text", "tool_call"]` when tools provided
- Maps `reasoning` task type to `reasoningDepth: "high"`
- Maps `greeting` task type to `reasoningDepth: "minimal"`
- Produces `contractFamily` as `"sync.code-gen"` for sync code-gen
- Estimates input tokens from message length (characters / 4)
- Route context overrides template defaults

### `cost-ranking.test.ts` — Ranking

- `minimize_cost`: cheapest model above quality floor wins
- `quality_first`: highest success probability wins regardless of cost
- `balanced`: blends cost efficiency with quality
- Null pricing penalized (not treated as free)
- Free model (cost=0) ranked by quality
- Model below quality floor gets successProb=0.3
- Model missing required tool capability gets successProb=0
- `estimateCost` uses multi-tier pricing correctly

### `pipeline.test.ts` additions — V2 integration

- `routeEndpointV2()` produces valid RouteDecision
- Modality filter excludes models lacking image input
- Strict schema filter excludes models lacking structured output
- `residencyPolicy: "local_only"` excludes cloud providers
- Cost-per-success produces different ranking than dimension scoring for same candidates
- Fallback chain built correctly

### Backward compatibility

- All existing `routeEndpoint()` tests unchanged
- All existing `computeFitness()` tests unchanged
- `classifyTask()` still works, feeds taskType to contract inference

---

## Section 6: Files Summary

### New Files

| File | Responsibility |
|---|---|
| `apps/web/lib/routing/request-contract.ts` | `RequestContract` type + `inferContract()` |
| `apps/web/lib/routing/cost-ranking.ts` | `estimateCost()`, `estimateSuccessProbability()`, `rankByCostPerSuccess()` |
| `apps/web/lib/routing/pipeline-v2.ts` | `routeEndpointV2()` — new routing pipeline using contracts |
| `apps/web/lib/routing/request-contract.test.ts` | Contract inference tests |
| `apps/web/lib/routing/cost-ranking.test.ts` | Ranking tests |

### Modified Files

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add contract template fields to `TaskRequirement` |
| `apps/web/lib/routing/pipeline.ts` | Export helper functions for reuse by pipeline-v2 |
| `apps/web/lib/routing/pipeline.test.ts` | Add V2 integration tests |
| `apps/web/lib/ai-provider-internals.ts` or `apps/web/lib/actions/agent-coworker.ts` | Wire contract inference into routing call site |
| `apps/web/lib/routing/index.ts` | Export new modules |

### Unchanged Files

| File | Why |
|---|---|
| `apps/web/lib/routing/scoring.ts` | Legacy path, retained for fallback |
| `apps/web/lib/routing/fallback.ts` | Dispatch layer unchanged — still receives RouteDecision |
| `apps/web/lib/task-classifier.ts` | Still determines taskType string |
| `apps/web/lib/task-types.ts` | Task type definitions unchanged |
| `apps/web/lib/routing/rate-tracker.ts` | Rate tracking unchanged, consumed by both paths |

---

## Section 7: Relationship to Subsequent Epics

| This Epic Delivers | Next Epic Consumes It |
|---|---|
| `RequestContract` type + `contractFamily` | EP-INF-005b: ExecutionRecipe keyed by contractFamily |
| `inferContract()` | EP-INF-005b: contract feeds recipe selection |
| `estimateCost()` | EP-INF-005b: recipe cost estimation |
| `estimateSuccessProbability()` | EP-INF-006: replaced by actual recipe performance data |
| `routeEndpointV2()` | EP-INF-005b: extended with recipe expansion stage |
| `budgetClass` | EP-INF-006: exploration budget varies by budget class |
| `reasoningDepth` | EP-INF-005b: maps to provider-specific parameters in recipes |

### Epic Chain

```
EP-INF-003 (Model Registry)     ✅ Done
EP-INF-004 (Rate Limits)        ✅ Done
EP-INF-005a (This spec)         → Contract-Based Selection
EP-INF-005b                     → Execution Recipes
EP-INF-006                      → Adaptive Loop & Eval Realignment
```

---

## Appendix: Migration from Legacy Path

The transition from `routeEndpoint()` to `routeEndpointV2()` is gradual:

1. **EP-INF-005a ships:** Both paths exist. `routeEndpointV2()` is the primary path. `routeEndpoint()` is the fallback.
2. **EP-INF-005b ships:** Recipes add provider-specific execution strategies to V2. Legacy path becomes less useful.
3. **EP-INF-006 ships:** Champion/challenger operates on V2 contracts and recipes. Legacy path is dead code.
4. **Cleanup epic:** Remove `routeEndpoint()`, `computeFitness()`, `TaskRequirementContract` type, and the old `preferCheap`/`preferredMinScores` fields from `TaskRequirement`.

No timeline pressure on the cleanup — the old path costs nothing to keep around and serves as a safety net.
