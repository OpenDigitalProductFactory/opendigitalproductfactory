# EP-INF-006: Adaptive Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the feedback loop — record outcomes per execution, aggregate recipe performance, enable champion/challenger exploration with promotion gates, and realign golden tests from primary authority to capability validation.

**Architecture:** RouteOutcome (per-execution record) → RecipePerformance (aggregated stats) → reward function → champion/challenger selection → promotion evaluation. All fire-and-forget (non-blocking to the request path).

**Tech Stack:** TypeScript, Vitest (globals: false), Prisma

**Spec:** `docs/superpowers/specs/2026-03-20-adaptive-loop-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `apps/web/lib/routing/reward.ts` | `computeReward()`, reward weight types |
| `apps/web/lib/routing/route-outcome.ts` | `recordRouteOutcome()`, cost computation |
| `apps/web/lib/routing/recipe-performance.ts` | `updateRecipePerformance()`, incremental aggregation |
| `apps/web/lib/routing/champion-challenger.ts` | `selectRecipeWithExploration()`, `evaluatePromotions()`, `promoteChallenger()` |
| `apps/web/lib/routing/golden-realignment.ts` | `shouldRunGoldenTests()`, confidence validation |
| `apps/web/lib/routing/reward.test.ts` | Reward computation tests |
| `apps/web/lib/routing/route-outcome.test.ts` | Outcome recording tests |
| `apps/web/lib/routing/recipe-performance.test.ts` | Aggregation tests |
| `apps/web/lib/routing/champion-challenger.test.ts` | Exploration + promotion tests |
| `apps/web/lib/routing/golden-realignment.test.ts` | Confidence validation tests |

### Modified Files

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add `RouteOutcome` + `RecipePerformance` tables |
| `apps/web/lib/routing/types.ts` | Add `explorationMode`, `challengerRecipeId` to RouteDecision |
| `apps/web/lib/routing/pipeline-v2.ts` | Replace champion-only loading with exploration selection |
| `apps/web/lib/routing/fallback.ts` | Record outcome after execution |
| `apps/web/lib/routing/index.ts` | Export new modules |

---

## Task 1: Reward Function

Pure function, no DB. Foundation for everything else.

**Files:**
- Create: `apps/web/lib/routing/reward.ts`
- Create: `apps/web/lib/routing/reward.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- Hard failure (providerErrorCode set) → reward 0
- Schema invalid on required schema (schemaValid === false) → reward 0
- Tool failure on required tool (toolSuccess === false) → reward 0
- All signals positive → weighted composite > 0
- Null graderScore → treated as 0.5 (neutral)
- Null humanScore → treated as 0.5 (neutral)
- High latency (30s) → latency component near 0
- Low latency (1s) → latency component near 1
- High cost ($0.10) → cost component near 0
- Zero cost → cost component at 1
- Null cost → treated as 0.5 (neutral)
- Default weights sum to 1.0

- [ ] **Step 2: Run tests, verify fail**
- [ ] **Step 3: Implement**

```typescript
export interface RewardWeights {
  quality: number;
  correctness: number;
  latency: number;
  cost: number;
  humanFeedback: number;
}

export const DEFAULT_REWARD_WEIGHTS: RewardWeights = {
  quality: 0.45,
  correctness: 0.25,
  latency: 0.10,
  cost: 0.10,
  humanFeedback: 0.10,
};

export interface OutcomeSignals {
  graderScore: number | null;
  humanScore: number | null;
  schemaValid: boolean | null;
  toolSuccess: boolean | null;
  latencyMs: number;
  costUsd: number | null;
  providerErrorCode: string | null;
}

export function computeReward(signals: OutcomeSignals, weights?: RewardWeights): number
```

- [ ] **Step 4: Run tests, verify pass**
- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/reward.ts apps/web/lib/routing/reward.test.ts
git commit -m "feat(routing): EP-INF-006 reward function with TDD"
```

---

## Task 2: Prisma Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add RouteOutcome and RecipePerformance tables**

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

- [ ] **Step 2: Run migration** (manual approach for drift)
- [ ] **Step 3: Regenerate Prisma client**
- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): EP-INF-006 add RouteOutcome and RecipePerformance tables"
```

---

## Task 3: Route Outcome Recording

**Files:**
- Create: `apps/web/lib/routing/route-outcome.ts`
- Create: `apps/web/lib/routing/route-outcome.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases (mock Prisma):
- Records outcome with all fields
- Computes costUsd from pricing × actual tokens
- Records error outcome with providerErrorCode, schemaValid=false, toolSuccess=false
- Generates unique requestId
- Fire-and-forget doesn't throw on DB failure (catches internally)
- Calls updateRecipePerformance after recording

- [ ] **Step 2: Run tests, verify fail**
- [ ] **Step 3: Implement**

```typescript
export async function recordRouteOutcome(outcome: {
  providerId: string;
  modelId: string;
  recipeId: string | null;
  contractFamily: string;
  taskType: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  schemaValid: boolean | null;
  toolSuccess: boolean | null;
  fallbackOccurred: boolean;
  providerErrorCode?: string;
}): Promise<void>
```

Generates `requestId` via `crypto.randomUUID()`. Inserts `RouteOutcome` row. Then calls `updateRecipePerformance()` if `recipeId` is set.

- [ ] **Step 4: Run tests, verify pass**
- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/route-outcome.ts apps/web/lib/routing/route-outcome.test.ts
git commit -m "feat(routing): EP-INF-006 route outcome recording with TDD"
```

---

## Task 4: Recipe Performance Aggregation

**Files:**
- Create: `apps/web/lib/routing/recipe-performance.ts`
- Create: `apps/web/lib/routing/recipe-performance.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases (mock Prisma):
- First observation sets initial values (not divide-by-zero)
- Incremental average correct after 5 observations
- EWMA: 0.7 × current + 0.3 × previous
- Schema valid rate tracks boolean outcomes
- Tool success rate tracks boolean outcomes
- Null schema/tool values don't affect rates
- Triggers promotion evaluation at sample count multiples of 50

- [ ] **Step 2: Run tests, verify fail**
- [ ] **Step 3: Implement**

```typescript
export async function updateRecipePerformance(
  recipeId: string,
  contractFamily: string,
  outcome: { latencyMs: number; costUsd: number | null; reward: number;
             schemaValid: boolean | null; toolSuccess: boolean | null },
): Promise<void>
```

Uses `prisma.recipePerformance.upsert()` with running average updates.

- [ ] **Step 4: Run tests, verify pass**
- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/recipe-performance.ts apps/web/lib/routing/recipe-performance.test.ts
git commit -m "feat(routing): EP-INF-006 recipe performance aggregation with TDD"
```

---

## Task 5: Champion/Challenger

**Files:**
- Create: `apps/web/lib/routing/champion-challenger.ts`
- Create: `apps/web/lib/routing/champion-challenger.test.ts`

- [ ] **Step 1: Write failing tests**

Exploration tests:
- Returns champion when no challengers exist
- Returns champion for sensitive contracts (confidential/restricted)
- Returns champion for quality_first budget
- Returns challenger at configured rate (mock Math.random)
- Returns champion when random roll doesn't hit exploration rate
- Global freeze → always champion

Promotion tests:
- Challenger promoted when all gates pass
- No promotion when insufficient samples (<20)
- No promotion when reward improvement below 5% threshold
- No promotion when cost increase exceeds 50%
- No promotion when hard metric regression (schema/tool rate drops)
- Challenger retired after 2× sample count without promotion
- Anti-thrash: max 1 promotion per 24h per family
- Global freeze blocks all promotions

- [ ] **Step 2: Run tests, verify fail**
- [ ] **Step 3: Implement**

```typescript
export async function selectRecipeWithExploration(
  providerId: string,
  modelId: string,
  contract: RequestContract,
): Promise<{ recipe: RecipeRow | null; explorationMode: "champion" | "challenger" }>

export async function evaluatePromotions(contractFamily: string): Promise<void>

export async function promoteChallenger(challengerRecipeId: string, championRecipeId: string): Promise<void>

// Anti-thrash state (in-memory)
export function _resetPromotionState(): void  // for tests
```

- [ ] **Step 4: Run tests, verify pass**
- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/champion-challenger.ts apps/web/lib/routing/champion-challenger.test.ts
git commit -m "feat(routing): EP-INF-006 champion/challenger with promotion gates and TDD"
```

---

## Task 6: Golden Test Realignment

**Files:**
- Create: `apps/web/lib/routing/golden-realignment.ts`
- Create: `apps/web/lib/routing/golden-realignment.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- High confidence model → shouldRunGoldenTests returns false
- Medium confidence model → returns false
- Low confidence model → returns true
- Model with no metadataConfidence (defaults to "low") → returns true

- [ ] **Step 2: Run tests, verify fail**
- [ ] **Step 3: Implement**

Simple function — this is a policy gate, not complex logic:

```typescript
export function shouldRunGoldenTests(metadataConfidence: string): boolean {
  return metadataConfidence === "low";
}
```

- [ ] **Step 4: Run tests, verify pass**
- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/golden-realignment.ts apps/web/lib/routing/golden-realignment.test.ts
git commit -m "feat(routing): EP-INF-006 golden test realignment with TDD"
```

---

## Task 7: Pipeline + Fallback Integration

**Files:**
- Modify: `apps/web/lib/routing/types.ts`
- Modify: `apps/web/lib/routing/pipeline-v2.ts`
- Modify: `apps/web/lib/routing/fallback.ts`

- [ ] **Step 1: Add exploration fields to RouteDecision**

Add to `RouteDecision` in `types.ts`:
```typescript
  explorationMode?: "champion" | "challenger";
  challengerRecipeId?: string;
```

- [ ] **Step 2: Update pipeline-v2.ts to use exploration selection**

Replace the current recipe loading with `selectRecipeWithExploration()`:

```typescript
import { selectRecipeWithExploration } from "./champion-challenger";

// Replace:
// const recipe = await loadChampionRecipe(...)
// With:
const { recipe, explorationMode } = await selectRecipeWithExploration(
  winner.endpoint.providerId, winner.endpoint.modelId, contract,
);
```

Add `explorationMode` and `challengerRecipeId` to the returned RouteDecision.

- [ ] **Step 3: Add outcome recording to fallback.ts**

After successful `callProvider()`, add fire-and-forget outcome recording:

```typescript
import { recordRouteOutcome } from "./route-outcome";

// After result = await callProvider(...)
recordRouteOutcome({
  providerId: entry.providerId,
  modelId: entry.modelId,
  recipeId: plan?.recipeId ?? null,
  contractFamily: plan?.contractFamily ?? decision.taskType,
  taskType: decision.taskType,
  latencyMs: result.inferenceMs,
  inputTokens: result.inputTokens,
  outputTokens: result.outputTokens,
  costUsd: null, // computed inside recordRouteOutcome from pricing
  schemaValid: null,
  toolSuccess: result.toolCalls ? true : null,
  fallbackOccurred: i > 0,
}).catch(err => console.error("[outcome] Failed to record:", err));
```

Also record error outcomes in the catch block.

- [ ] **Step 4: Update pipeline-v2.test.ts**

Mock `selectRecipeWithExploration` (already mocking `loadChampionRecipe`). Verify exploration fields appear in RouteDecision.

- [ ] **Step 5: Run all tests**

Run: `cd apps/web && npx vitest run lib/routing/`

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/routing/types.ts apps/web/lib/routing/pipeline-v2.ts apps/web/lib/routing/fallback.ts apps/web/lib/routing/pipeline-v2.test.ts
git commit -m "feat(routing): EP-INF-006 wire exploration + outcome recording into pipeline"
```

---

## Task 8: Update Exports + Final Verification

- [ ] **Step 1: Add exports to index.ts**

```typescript
// EP-INF-006: Adaptive loop
export type { RewardWeights, OutcomeSignals } from "./reward";
export { computeReward, DEFAULT_REWARD_WEIGHTS } from "./reward";
export { recordRouteOutcome } from "./route-outcome";
export { updateRecipePerformance } from "./recipe-performance";
export { selectRecipeWithExploration, evaluatePromotions, promoteChallenger } from "./champion-challenger";
export { shouldRunGoldenTests } from "./golden-realignment";
```

- [ ] **Step 2: Run full routing test suite**

Run: `cd apps/web && npx vitest run lib/routing/`
Expected: All tests pass.

- [ ] **Step 3: Run type check**

Run: `cd apps/web && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/routing/index.ts
git commit -m "feat(routing): EP-INF-006 export adaptive loop modules — routing redesign complete"
```
