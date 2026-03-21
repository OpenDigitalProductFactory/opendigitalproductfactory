# EP-INF-006: Adaptive Loop & Evaluation Realignment

**Date:** 2026-03-20
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (COO/design partner)
**Epic:** EP-INF-006

**Prerequisites:**
- EP-INF-003 (Provider Model Registry) — implemented
- EP-INF-004 (Rate Limits & Capacity) — implemented
- EP-INF-005a (Contract-Based Selection) — implemented
- EP-INF-005b (Execution Recipes) — implemented

**Related:**
- [2026-03-20-adaptive-model-routing-design.md](2026-03-20-adaptive-model-routing-design.md) — master vision (Sections 5-7)
- [2026-03-20-execution-recipes-design.md](2026-03-20-execution-recipes-design.md) — EP-INF-005b (ExecutionRecipe foundation)

---

## Problem Statement

The routing pipeline now selects models intelligently (EP-INF-005a) and calls them with correct parameters (EP-INF-005b), but there is no closed feedback loop. The system cannot learn which model+recipe combinations actually work best for specific contract families.

Current state:

1. **No unified outcome recording.** When a routed execution completes, the result (cost, latency, schema validity, tool success) is not captured in a structured record tied to the recipe that produced it.

2. **No recipe performance tracking.** There's no aggregated view of how well each recipe performs over time. The `EndpointTaskPerformance` table tracks per-endpoint/task-type stats, but not per-recipe stats.

3. **No evolution mechanism.** All recipes are static champions created by the seeder. There's no way for the system to discover that a different model or different parameters would work better for a contract family.

4. **Golden tests are the primary authority for capability scores.** But EP-INF-003 already provides provider-declared capabilities. Golden tests should validate provider claims, not replace them.

5. **Production feedback is fragmented.** `production-feedback.ts` nudges dimension scores based on orchestrator grades. This is separate from recipe performance and separate from golden test results. Three partial feedback loops instead of one coherent one.

---

## Goals

1. Record a `RouteOutcome` for every routed execution — unified feedback record.
2. Aggregate outcomes into `RecipePerformance` — per-recipe stats that feed ranking.
3. Add champion/challenger exploration — bounded experimental traffic to alternative recipes.
4. Add promotion gates — evidence-based recipe evolution with anti-thrash guardrails.
5. Realign golden tests from "primary score authority" to "capability validation."
6. Keep the system stable — conservative exploration, no wild swings.

## Non-Goals

1. Autonomous recipe mutation (generating new recipes from failure analysis). Recipes are seeded or manually created. Evolution means promoting existing challengers, not inventing new ones.
2. Multi-armed bandit or Thompson sampling. The champion/challenger system is simpler and more auditable.
3. Removing the legacy routing path (`routeEndpoint`). It stays as fallback.
4. Real-time promotion. Promotion checks run periodically, not on every request.

---

## Section 1: RouteOutcome Recording

### Table

```prisma
model RouteOutcome {
  id                String    @id @default(cuid())
  requestId         String    @unique
  providerId        String
  modelId           String
  recipeId          String?
  contractFamily    String
  taskType          String

  latencyMs         Int
  inputTokens       Int
  outputTokens      Int
  costUsd           Float?

  schemaValid       Boolean?
  toolSuccess       Boolean?
  fallbackOccurred  Boolean   @default(false)

  graderScore       Float?
  humanScore        Float?
  providerErrorCode String?

  createdAt         DateTime  @default(now())

  @@index([recipeId, contractFamily])
  @@index([providerId, modelId])
}
```

### Recording Flow

After `callProvider()` returns (success or failure), in `callWithFallbackChain()`:

1. **Compute `costUsd`:** Use `estimateCost()` from `cost-ranking.ts` with actual token counts (not estimated).
2. **Determine `schemaValid`:** If `contract.requiresStrictSchema`, attempt to parse the output as JSON and validate. Otherwise null.
3. **Determine `toolSuccess`:** If `contract.requiresTools`, check if tool calls were returned and matched expected tools. Otherwise null.
4. **Insert `RouteOutcome` row.**
5. **Update `RecipePerformance`** incrementally.

`graderScore` and `humanScore` are filled asynchronously — a separate process (orchestrator evaluator, human feedback UI) updates the outcome row later.

### Cost Computation

Uses actual tokens (from `InferenceResult`), not estimated:
```typescript
const costUsd = pricing.inputPerMToken !== null && pricing.outputPerMToken !== null
  ? (result.inputTokens / 1_000_000) * pricing.inputPerMToken
    + (result.outputTokens / 1_000_000) * pricing.outputPerMToken
  : null;
```

### Error Outcomes

When the call fails (provider error, timeout), still record an outcome with:
- `costUsd: null` (no tokens consumed, or unknown)
- `schemaValid: false`, `toolSuccess: false`
- `providerErrorCode` from InferenceError
- `latencyMs` from the failed attempt
- This ensures failures count against recipe performance.

---

## Section 2: RecipePerformance Aggregation

### Table

```prisma
model RecipePerformance {
  id                 String    @id @default(cuid())
  recipeId           String
  contractFamily     String
  sampleCount        Int       @default(0)
  successCount       Int       @default(0)
  avgLatencyMs       Float     @default(0)
  avgCostUsd         Float     @default(0)
  avgGraderScore     Float?
  avgHumanScore      Float?
  avgSchemaValidRate Float?
  avgToolSuccessRate Float?
  ewmaReward         Float     @default(0)
  lastObservedAt     DateTime?

  @@unique([recipeId, contractFamily])
}
```

### Incremental Update

After each outcome:

```typescript
function updateRecipePerformance(
  recipeId: string,
  contractFamily: string,
  outcome: RouteOutcome,
): Promise<void>
```

Running average update:
```
newAvg = ((oldAvg * oldCount) + newValue) / (oldCount + 1)
```

For boolean rates (schemaValid, toolSuccess):
```
newRate = ((oldRate * oldCount) + (newValue ? 1 : 0)) / (oldCount + 1)
```

### Reward Function

```typescript
const DEFAULT_REWARD_WEIGHTS = {
  quality: 0.45,
  correctness: 0.25,
  latency: 0.10,
  cost: 0.10,
  humanFeedback: 0.10,
};
```

**Computing reward for a single outcome:**

```typescript
function computeReward(outcome: RouteOutcome, weights: RewardWeights): number {
  // Hard failure → 0
  if (outcome.providerErrorCode) return 0;
  if (outcome.schemaValid === false) return 0; // required schema failed
  if (outcome.toolSuccess === false) return 0; // required tool failed

  const quality = outcome.graderScore ?? 0.5;  // neutral when no grade yet
  const correctness = (
    (outcome.schemaValid === true ? 1 : 0.5) +
    (outcome.toolSuccess === true ? 1 : 0.5)
  ) / 2;
  const latencyScore = Math.max(0, 1 - (outcome.latencyMs / 30_000)); // 0-30s normalized
  const costScore = outcome.costUsd !== null
    ? Math.max(0, 1 - (outcome.costUsd / 0.10))  // $0-0.10 normalized
    : 0.5;
  const human = outcome.humanScore ?? 0.5;

  return (
    weights.quality * quality +
    weights.correctness * correctness +
    weights.latency * latencyScore +
    weights.cost * costScore +
    weights.humanFeedback * human
  );
}
```

**EWMA update:**
```
newEwma = 0.7 * currentReward + 0.3 * previousEwma
```

---

## Section 3: Champion/Challenger

### Exploration Decision

In `routeEndpointV2()`, after loading the champion recipe:

```typescript
async function selectRecipeWithExploration(
  providerId: string,
  modelId: string,
  contract: RequestContract,
): Promise<{ recipe: RecipeRow | null; explorationMode: "champion" | "challenger" }>
```

**Logic:**
1. Load champion recipe
2. If no champion → return `{ recipe: null, explorationMode: "champion" }`
3. Check if exploration is allowed:
   - `contract.sensitivity === "confidential" || "restricted"` → no
   - `contract.budgetClass === "quality_first"` → no
   - Global `FREEZE_PROMOTIONS` flag → no
4. Load active challengers: `ExecutionRecipe` rows with `status: "candidate"` for same (providerId, modelId, contractFamily)
5. If no challengers → return champion
6. Roll dice: `Math.random() < explorationRate`
   - If exploration → pick a random challenger
   - If not → return champion

### Exploration Rates

```typescript
function getExplorationRate(contractFamily: string, contract: RequestContract): number {
  if (contract.sensitivity === "confidential" || contract.sensitivity === "restricted") return 0;
  if (contract.budgetClass === "quality_first") return 0;
  // Could be per-contract-family in future; default for now
  return 0.02; // 2%
}
```

### RouteDecision Extension

Add to `RouteDecision`:
```typescript
  explorationMode?: "champion" | "challenger";
  challengerRecipeId?: string;
```

---

## Section 4: Promotion Gates

### Gate Definition

```typescript
interface PromotionGate {
  minSampleCount: number;
  noHardMetricRegression: boolean;
  rewardImprovement: number;
  maxCostIncrease: number;
}

const DEFAULT_PROMOTION_GATE: PromotionGate = {
  minSampleCount: 20,
  noHardMetricRegression: true,
  rewardImprovement: 0.05,   // 5% better EWMA reward
  maxCostIncrease: 1.5,      // max 50% cost increase
};
```

### Promotion Evaluation

```typescript
async function evaluatePromotions(contractFamily: string): Promise<PromotionResult[]>
```

For each contract family:
1. Load champion's `RecipePerformance`
2. Load each challenger's `RecipePerformance`
3. For each challenger, check gates:
   - `challenger.sampleCount >= gate.minSampleCount`
   - `challenger.avgSchemaValidRate >= champion.avgSchemaValidRate` (no regression)
   - `challenger.avgToolSuccessRate >= champion.avgToolSuccessRate` (no regression)
   - `challenger.ewmaReward >= champion.ewmaReward * (1 + gate.rewardImprovement)`
   - `challenger.avgCostUsd <= champion.avgCostUsd * gate.maxCostIncrease`
4. If challenger passes all gates → promote
5. If challenger has `sampleCount >= gate.minSampleCount * 2` but fails gates → retire (it had its chance)

### Promotion Execution

```typescript
async function promoteChallenger(
  challengerRecipeId: string,
  championRecipeId: string,
): Promise<void>
```

1. Set old champion `status: "retired"`, `retiredAt: now()`
2. Set challenger `status: "champion"`, `promotedAt: now()`
3. Log promotion event (console.log for now, structured events in future)

### Anti-Thrash Guardrails

```typescript
interface ThrashGuard {
  maxPromotionsPerFamilyPerDay: number;  // default: 1
  cooldownAfterFailedPromotionMs: number; // default: 24h
  globalFreezeFlag: boolean;              // emergency stop
}
```

- Before promoting, check: was there already a promotion for this contract family in the last 24h? If so, skip.
- After a challenger fails promotion (enough samples, didn't pass gates), set a cooldown — don't re-evaluate that challenger for 24h.
- `FREEZE_PROMOTIONS` global flag: when true, no automatic promotions happen. Manual promotions still allowed.

### When Promotion Runs

Not on every request. Options:
- After every N outcomes for a contract family (e.g., every 50)
- On a scheduled interval (e.g., every hour)
- Manually triggered

For this epic: **after every N outcomes.** The outcome recorder checks if `sampleCount % 50 === 0` and triggers `evaluatePromotions()`. Simple, no scheduler needed.

---

## Section 5: Golden Test Realignment

### New Role

Golden tests shift from "primary authority for capability scores" to "capability validation."

### Confidence-Based Triggering

```typescript
function shouldRunGoldenTests(modelProfile: ModelProfile): boolean {
  if (modelProfile.metadataConfidence === "high") return false;  // provider API data
  if (modelProfile.metadataConfidence === "medium") return false; // curated or baseline-verified
  return true;  // "low" — inferred, needs verification
}
```

### What Golden Test Results Do

**Old behavior:** Golden test scores → update `ModelProfile` dimension scores (reasoning, codegen, etc.) via IIR filter.

**New behavior:** Golden test results → validate that the model can actually do what its ModelCard says.
- If model claims `capabilities.toolUse === true` and fails tool-calling golden tests → flag as mismatch, log warning
- If model passes all golden tests for its declared capabilities → upgrade `metadataConfidence` from `"low"` to `"medium"`
- Dimension score updates still happen for `metadataConfidence: "low"` models (backward compat), but the scores carry less weight now that cost-per-success ranking is the primary path

### What Does NOT Change

- `golden-tests.ts` — test definitions unchanged
- `eval-scoring.ts` — scoring methods unchanged
- `eval-runner.ts` — runner unchanged, just its output interpretation shifts
- Tests can still be triggered manually for any model regardless of confidence

---

## Section 6: Integration Points

### Outcome Recording in fallback.ts

After successful `callProvider()` (inside the try block):

```typescript
// EP-INF-006: Record outcome
await recordRouteOutcome({
  requestId: generateRequestId(),
  providerId: entry.providerId,
  modelId: entry.modelId,
  recipeId: plan?.recipeId ?? null,
  contractFamily: plan?.contractFamily ?? decision.taskType,
  taskType: decision.taskType,
  latencyMs: result.inferenceMs,
  inputTokens: result.inputTokens,
  outputTokens: result.outputTokens,
  costUsd: computeActualCost(entry.providerId, result),
  schemaValid: null,  // determined by caller if schema was required
  toolSuccess: result.toolCalls ? true : null,
  fallbackOccurred: i > 0,
}).catch(err => console.error("[outcome] Failed to record:", err));
```

Recording is fire-and-forget (`.catch()`) — it must not slow down the response.

### Challenger Selection in pipeline-v2.ts

Replace the current recipe loading:

```typescript
// OLD (EP-INF-005b):
const recipe = await loadChampionRecipe(winner.providerId, winner.modelId, contract.contractFamily);

// NEW (EP-INF-006):
const { recipe, explorationMode } = await selectRecipeWithExploration(
  winner.providerId, winner.modelId, contract,
);
```

Add `explorationMode` and `challengerRecipeId` to the returned RouteDecision.

### Promotion Trigger in route-outcome.ts

After updating RecipePerformance:

```typescript
if (performance.sampleCount % 50 === 0) {
  evaluatePromotions(contractFamily).catch(err =>
    console.error("[promotion] Evaluation failed:", err)
  );
}
```

Fire-and-forget — promotion is async, doesn't block the request.

---

## Section 7: Testing Strategy

### `route-outcome.test.ts` — Outcome recording
- Records outcome with all fields
- Computes costUsd from pricing × actual tokens
- Records error outcome with providerErrorCode
- Fire-and-forget doesn't throw on DB failure
- requestId uniqueness enforced

### `recipe-performance.test.ts` — Aggregation
- Incremental average correct after N updates
- EWMA: 0.7 × current + 0.3 × previous
- Schema valid rate tracks boolean outcomes
- Tool success rate tracks boolean outcomes
- First observation sets initial values (no divide by zero)

### `reward.test.ts` — Reward computation
- Hard failure (providerError) → 0
- Schema invalid on required schema → 0
- Tool failure on required tool → 0
- All signals positive → weighted composite
- Null graderScore treated as neutral (0.5)
- Null humanScore treated as neutral (0.5)

### `champion-challenger.test.ts` — Exploration + promotion
- Champion only when no challengers exist
- Champion only for sensitive contracts
- Champion only for quality_first budget
- Challenger selected at configured rate (mock Math.random)
- Promotion when all gates pass
- No promotion when insufficient samples
- No promotion when reward improvement below threshold
- Challenger retired after 2× sample count without promotion
- Anti-thrash: max 1 promotion per 24h per family
- Global freeze blocks all promotions

### `golden-realignment.test.ts` — Confidence validation
- High confidence → skip golden tests
- Low confidence → run golden tests
- Passing tests → upgrade to medium confidence
- Capability mismatch → flag warning

### Backward compatibility
- All 473 existing routing tests unchanged
- Legacy routeEndpoint path unaffected
- Production-feedback.ts still works alongside new system

---

## Section 8: Files Summary

### New Files

| File | Responsibility |
|---|---|
| `apps/web/lib/routing/route-outcome.ts` | `recordRouteOutcome()`, cost computation |
| `apps/web/lib/routing/recipe-performance.ts` | `updateRecipePerformance()`, incremental aggregation |
| `apps/web/lib/routing/reward.ts` | `computeReward()`, reward weights |
| `apps/web/lib/routing/champion-challenger.ts` | `selectRecipeWithExploration()`, `evaluatePromotions()`, `promoteChallenger()`, anti-thrash |
| `apps/web/lib/routing/golden-realignment.ts` | `shouldRunGoldenTests()`, confidence validation |
| Test files for each module |

### Modified Files

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add `RouteOutcome` + `RecipePerformance` tables |
| `apps/web/lib/routing/types.ts` | Add `explorationMode`, `challengerRecipeId` to RouteDecision |
| `apps/web/lib/routing/pipeline-v2.ts` | Replace champion-only loading with exploration selection |
| `apps/web/lib/routing/fallback.ts` | Record outcome after execution |
| `apps/web/lib/routing/index.ts` | Export new modules |

### Unchanged Files

| File | Why |
|---|---|
| `apps/web/lib/routing/golden-tests.ts` | Test definitions unchanged |
| `apps/web/lib/routing/eval-scoring.ts` | Scoring methods unchanged |
| `apps/web/lib/routing/eval-runner.ts` | Runner unchanged |
| `apps/web/lib/routing/scoring.ts` | Legacy path |
| `apps/web/lib/routing/production-feedback.ts` | Coexists with new system |

---

## Section 9: Relationship to Master Vision

This epic completes the routing redesign initiative (EP-INF-003 through EP-INF-006).

| Master Vision Section | Implemented By |
|---|---|
| Section 1: Canonical Routing Objects | EP-INF-005a (RequestContract), EP-INF-005b (ExecutionRecipe) |
| Section 2: Data Model Changes | EP-INF-003 (ModelCard), EP-INF-005a (TaskRequirement extension), EP-INF-005b (ExecutionRecipe), EP-INF-006 (RouteOutcome, RecipePerformance) |
| Section 3: Routing Pipeline | EP-INF-005a (routeEndpointV2, cost-per-success) |
| Section 4: Provider-Guided Execution | EP-INF-003 (ModelCard capabilities), EP-INF-005b (recipe seeder) |
| Section 5: Adaptive Improvement Loop | EP-INF-006 (this spec) |
| Section 6: Changes Over Time | EP-INF-003 (drift detection), EP-INF-004 (auto-recovery), EP-INF-006 (promotion) |
| Section 7: Leveraging Existing Assets | EP-INF-006 (golden test realignment, production feedback coexistence) |

After EP-INF-006, the system can:
- Route requests using structured contracts and cost-per-success ranking
- Call models with provider-specific parameters from versioned recipes
- Track how well each recipe performs
- Explore challenger recipes with bounded traffic
- Promote challengers that outperform champions
- Detect provider metadata drift and model degradation
- Validate capability claims against golden tests
- Auto-recover from rate limits

### Future Work (Beyond This Initiative)

- Recipe mutation (generating new challengers from failure clustering) — requires AI-driven recipe creation
- Operator dashboard for champion/challenger standings
- Per-contract-family reward weight customization
- Scheduled promotion evaluation (instead of sample-count-triggered)
- Remove legacy `routeEndpoint()` path and `computeFitness()`
