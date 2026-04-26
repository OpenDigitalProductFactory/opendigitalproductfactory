# Local LLM Grading — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the hardcoded `return 5` orchestrator-scoring stub with a real LLM grader, add 3× repetition stability scoring, and capture per-call operational metrics (tokens/sec, TTFT, VRAM where available) — without changing any routing math or fallback decisions.

**Architecture:** All work lands inside `apps/web/lib/routing/` and `packages/db/prisma/`. The orchestrator scorer becomes a real cross-endpoint LLM call that returns 0–10; existing `scoreDimension` math is unchanged. Stability score is derived during eval by re-running each `orchestrator`-scored test 3× at temp=0 and measuring response divergence. Operational metrics piggyback on the existing `callProvider` `InferenceResult` (`outputTokens`, `inferenceMs`) and any TTFT/VRAM the adapter can supply.

**Tech Stack:** TypeScript, Prisma 7.x, Vitest, Inngest (for the existing `eval-background` function — no new triggers).

**Spec:** `docs/superpowers/specs/2026-04-26-local-llm-grading-incremental-design.md` (PR #296), Phase 1 in §5.

---

## Top-level constraints (apply to every task)

1. **Routing must not regress.** `routeTask()` in `apps/web/lib/routing/task-router.ts`, `computeNewScore()` in `eval-runner.ts:24`, `scoreDimension()` in `eval-scoring.ts:101`, and the production-feedback nudge in `production-feedback.ts:36` are **untouched** by this phase. We change *what number `scoreResponse` returns for the `orchestrator` case*, not how dimension scores are computed, blended, or consumed by routing.
2. **Score-shape compatibility.** The orchestrator scorer returns `0–10` (matches the `TestResult.score` field on `eval-runner.ts:56` and the `ScoringMethod` contract on `golden-tests.ts:11`). No callers see a new shape.
3. **Migration safety.** All new DB fields are nullable / additive. No backfill. Older `EndpointTaskPerformance` and `ModelProfile` rows continue to read with `null` for the new metric fields.
4. **No provider pinning.** The grader-of-record is selected at call-time by reusing the existing endpoint-loading logic with `minimumTier: "frontier"`. Never hardcode a providerId/modelId for the grader.
5. **Self-grading guard.** A model must never grade its own output (introduces a positive bias loop). If the resolved frontier grader is the same `(providerId, modelId)` as the model being evaluated, fall back to the next-best frontier endpoint; if none exists, persist `score = null` and a `gradingSkippedReason = "no-eligible-grader"` flag rather than fabricating a score.
6. **Cost ceiling.** A single `runDimensionEval()` invocation must not trigger more than (3 × N orchestrator-scored tests) grader calls. Today that's 3 × 3 = 9 grader calls per model per eval — verify this in the cost-ceiling test.
7. **Commit cadence.** One commit per task (after the test passes). DCO sign-off (`git commit -s`) required.
8. **Heads-up on stale doc comment.** `golden-tests.ts:11` says `"orchestrator"` is "LLM-graded 1-5, scaled to 0-100". That comment is **stale** — the actual contract enforced by `eval-scoring.ts:101-106` and `TestResult.score` (`eval-runner.ts:56`) is **0-10**. The orchestrator scorer in this plan returns 0-10. Update the stale comment in Task 7 (it's near the file you're touching anyway).

---

## Pre-flight: branch + worktree

- [ ] **Step 1:** Create a worktree off `origin/main` so this work is isolated from concurrent sessions:
  ```sh
  git fetch origin main
  git worktree add -b feat/local-llm-grading-phase-1 D:/DPF-llm-grading-p1 origin/main
  ```
- [ ] **Step 2:** All subsequent file paths are relative to `D:/DPF-llm-grading-p1/`. **PR #296 merge status is not blocking** — it is a docs-only PR. Proceed with implementation regardless. If #296 merges during implementation and you want the spec on this branch, `git fetch origin && git rebase origin/main` between tasks (between commits, never mid-task).

---

## Task 1: DB migration — add stability and operational metric fields

**Why first:** All downstream code references these fields. Migration is reversible (additive nullable columns).

**Files:**
- Modify: `packages/db/prisma/schema.prisma:1214-1281` (ModelProfile)
- Modify: `packages/db/prisma/schema.prisma:1310-1332` (EndpointTaskPerformance)
- Create: `packages/db/prisma/migrations/<timestamp>_phase1_local_llm_grading_metrics/migration.sql` (Prisma generates)

**Schema changes:**

Add to `model ModelProfile` (after line 1244 `profileConfidence`):
```prisma
  // Phase 1: stability — proportion of identical outputs across 3× temp=0 runs (0-100)
  stabilityScore            Int?
  lastStabilityCheckAt      DateTime?
```

Add to `model EndpointTaskPerformance` (after line 1324 `avgTokensUsed`):
```prisma
  // Phase 1: operational metrics from eval calls
  tokensPerSecondAvg        Float?
  ttftMsAvg                 Float?
  peakVramMbAvg             Float?
```

- [ ] **Step 1: Edit schema.prisma** — add the five fields above. No defaults (nullable).
- [ ] **Step 2: Generate the migration:**
  ```sh
  pnpm --filter @dpf/db exec prisma migrate dev --name phase1_local_llm_grading_metrics
  ```
  Per CLAUDE.md: never `npx prisma`. Verify the generated `migration.sql` only contains `ALTER TABLE ... ADD COLUMN ... NULL` statements (no drops, no defaults that backfill). If anything else appears, abort and investigate.
- [ ] **Step 3: Verify the Prisma client regenerated** — `grep -E "stabilityScore|tokensPerSecondAvg" node_modules/.prisma/client/index.d.ts` from `packages/db/` should show the new fields.
- [ ] **Step 4: Commit:**
  ```sh
  git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
  git commit -s -m "feat(db): add stability + operational metric fields for LLM grading (phase 1)"
  ```

---

## Task 2: Grader-of-record selector

**Why:** The orchestrator scorer needs a frontier-tier model that is **not** the model under test. This selector encapsulates that policy in one place so routing tests can validate it.

**Files:**
- Create: `apps/web/lib/routing/grader-selector.ts`
- Create: `apps/web/lib/routing/grader-selector.test.ts`

**Contract:**
```ts
export interface GraderSelection {
  providerId: string;
  modelId: string;
}
export interface GraderSelectionFailure {
  reason: "no-frontier-available" | "only-frontier-is-subject";
}
export type GraderSelectionResult = GraderSelection | GraderSelectionFailure;

/**
 * Pick a frontier-tier endpoint to grade outputs from `subjectProviderId/subjectModelId`.
 * Returns a failure object (NOT throwing) when no eligible grader exists, so callers can
 * persist the skip reason rather than fabricating a score.
 *
 * NOTE: This function does NOT call routeTask() (which requires a TaskRequirement and policy
 * context); it does a focused DB query for active frontier ModelProfile rows. Routing math
 * is unchanged.
 */
export async function selectGrader(
  subjectProviderId: string,
  subjectModelId: string,
): Promise<GraderSelectionResult>;
```

**Selection rules** (in order):
1. Query `ModelProfile` where `qualityTier = "frontier"`, `modelStatus = "active"`, `provider.status IN ("active", "degraded")`, `provider.endpointType = "llm"`, `provider.authMethod != "oauth2_authorization_code"` (per the existing eval-runner restriction at lines 268-273).
2. Exclude `(providerId, modelId) == (subjectProviderId, subjectModelId)`.
3. Order by `lastEvalAt DESC NULLS LAST, profileConfidence DESC` (prefer recently-evaluated, high-confidence).
4. Return the first row; if none, return `{reason: "no-frontier-available"}` (or `"only-frontier-is-subject"` if pre-exclusion result was the subject itself).

- [ ] **Step 1: Write `grader-selector.test.ts`** with three test cases (all using `vi.mock("@dpf/db")` to stub `prisma.modelProfile.findMany`):
  - `selects the highest-confidence frontier endpoint that isn't the subject`
  - `returns {reason: "only-frontier-is-subject"} when the only frontier model is the subject itself`
  - `returns {reason: "no-frontier-available"} when no frontier models exist`
- [ ] **Step 2: Run test, verify all three fail:**
  ```sh
  pnpm --filter @dpf/web exec vitest run apps/web/lib/routing/grader-selector.test.ts
  ```
- [ ] **Step 3: Implement `grader-selector.ts`** to satisfy the contract. ~40 lines.
- [ ] **Step 4: Re-run tests, verify all pass.**
- [ ] **Step 5: Commit:**
  ```sh
  git add apps/web/lib/routing/grader-selector.ts apps/web/lib/routing/grader-selector.test.ts
  git commit -s -m "feat(routing): add grader-of-record selector for orchestrator scoring"
  ```

---

## Task 3: Orchestrator scorer — real LLM call

**Why:** This is the core change. Replaces `eval-runner.ts:88 return 5` with a graded call.

**Files:**
- Create: `apps/web/lib/routing/orchestrator-scorer.ts`
- Create: `apps/web/lib/routing/orchestrator-scorer.test.ts`

**Contract:**
```ts
export interface OrchestratorScoreResult {
  /** 0-10 scaled score, or null when grading was skipped. */
  score: number | null;
  /** Populated when score === null. */
  skippedReason?: "no-frontier-available" | "only-frontier-is-subject" | "grader-error";
  /** Free-text grader rationale; truncated to 500 chars. Empty string when skipped. */
  rationale: string;
  /** Provider/model that did the grading. Null when skipped. */
  graderProviderId: string | null;
  graderModelId: string | null;
}

export async function scoreOrchestrator(args: {
  subjectProviderId: string;
  subjectModelId: string;
  prompt: string;
  expectedOutput?: string;     // rubric hint, may be undefined for free-form prompts
  modelResponse: string;
}): Promise<OrchestratorScoreResult>;
```

**Grader prompt (literal, do not paraphrase):**

System prompt:
```
You are an impartial grader. You will receive a user prompt, optional expected-output guidance,
and a candidate response from another AI model. Score the candidate response from 0 to 10 where:
- 0 = completely fails the prompt or is empty
- 5 = partially correct but missing key elements
- 10 = fully correct, well-formed, addresses the prompt directly
You must respond ONLY with a JSON object: {"score": <integer 0-10>, "rationale": "<one short sentence>"}
Never include any other text. Never wrap in markdown. The "rationale" must be under 200 characters.
```

User message template:
```
PROMPT:
${prompt}

${expectedOutput ? `EXPECTED OUTPUT GUIDANCE:\n${expectedOutput}\n\n` : ""}CANDIDATE RESPONSE:
${modelResponse}
```

**Behavior:**
- **In-process cache (per spec §5).** Module-level `Map<string, OrchestratorScoreResult>` keyed by `sha1(subjectProviderId + subjectModelId + prompt + (expectedOutput ?? "") + modelResponse)`. Cache hits short-circuit the grader call entirely. Cache lives only for the lifetime of the Node process — no DB persistence in Phase 1 (deferred). Cap at 1000 entries with FIFO eviction to bound memory.
- Call `selectGrader(subjectProviderId, subjectModelId)`. If failure, return `{score: null, skippedReason: <reason>, rationale: "", graderProviderId: null, graderModelId: null}`. Cache failures too — same skip will recur within the eval run.
- Call `callProvider(graderProviderId, graderModelId, [{role:"user", content: <userMessage>}], <systemPrompt>)`. No tools. Hardcode no temperature override — use the provider's default at temp=0 path (the eval runner already runs deterministically).
- **Inherit rate-limit retry from `runGoldenTest` semantics** (`eval-runner.ts:122-130`): on `InferenceError` with `code === "rate_limit"`, wait 10 s and retry once. On other inference errors, fall through to skip.
- Parse the response as JSON. On parse failure, retry once with the same call. If still unparsed, return `{score: null, skippedReason: "grader-error", rationale: "<error message truncated>", graderProviderId, graderModelId}`.
- Clamp the parsed score to `[0, 10]` and `Math.round` it.
- Cache the final result (score or skip) before returning.

- [ ] **Step 1: Write `orchestrator-scorer.test.ts`** with five test cases (mock `selectGrader` and `callProvider`):
  - `returns parsed score when grader returns valid JSON` (grader returns `{"score": 8, "rationale": "good"}` → result.score === 8)
  - `clamps out-of-range scores` (grader returns `{"score": 15}` → result.score === 10)
  - `retries once on JSON parse failure, succeeds on second try`
  - `returns null with skippedReason='grader-error' when both attempts fail to parse`
  - `returns null with skippedReason='no-frontier-available' when selectGrader fails`
- [ ] **Step 2: Run test, verify all fail.**
- [ ] **Step 3: Implement `orchestrator-scorer.ts`.** ~80 lines.
- [ ] **Step 4: Re-run tests, verify all pass.**
- [ ] **Step 5: Commit:**
  ```sh
  git add apps/web/lib/routing/orchestrator-scorer.ts apps/web/lib/routing/orchestrator-scorer.test.ts
  git commit -s -m "feat(routing): implement orchestrator LLM grader (replaces 5/10 stub)"
  ```

---

## Task 4: Wire orchestrator scorer into eval-runner

**Why:** Replace the stub. Carefully — this is the routing-impact moment.

**Files:**
- Modify: `apps/web/lib/routing/eval-runner.ts:80-91` (the `scoreResponse` switch case for `"orchestrator"`)
- Modify: `apps/web/lib/routing/eval-runner.ts` — also need to thread `providerId, modelId, prompt, expectedOutput` into `scoreResponse` (today it only receives `test, content, toolCalls`).
- Modify: `apps/web/lib/routing/eval-runner.test.ts` (existing)

**Implementation notes:**
- `scoreResponse` is currently sync. The orchestrator case is now async. Make `scoreResponse` async; await it from `runGoldenTest` (line 109).
- When the scorer returns `score === null`, treat the test as **inconclusive for this single test only** — push to `testResults` with `error: "grader-skipped: <reason>"` and `score: 0`. The existing inconclusive-dimension logic (`>50% errors`) at `eval-runner.ts:198-211` then preserves the previous score correctly. **Do not** invent a fake score.
- Add a comment on the orchestrator branch citing this plan and the spec.

**Critical: routing-impact behavior**

The conversational dimension (`golden-tests.ts:284-310`) currently scores 50/100 for every model (3 tests × `return 5` × `scoreDimension` math). After this change:
- Models that genuinely score conversationally well will rise above 50; weak ones will drop below.
- The `computeNewScore` rolling average (`eval-runner.ts:24`) already smooths a single eval's impact: 70% new + 30% previous. So a model with `evalCount > 0` won't see a dramatic single-step jump.
- For models with `evalCount === 0`, this change *will* set their first real conversational score. That's the intended outcome — Phase 1 acceptance.

**Routing-fallback safety check:** Before commit, grep for any code that *requires* `conversational >= 50`:
```sh
grep -rn "conversational" apps/web/lib/routing/ --include="*.ts" | grep -v ".test.ts"
```
Expected results today (verified 2026-04-26): `adapter-registry.ts:101` (reads from a known-model registry, not from the eval result), `eval-runner.ts` (writes), `eval-scoring.ts` (math). None of these gate routing on a numeric threshold; the score is *one of many* inputs to the dimension fitness ranking. The scorer change therefore moves scores but does not flip a binary gate.

- [ ] **Step 1: Write a new test in `eval-runner.test.ts`** — `runGoldenTest with orchestrator scoring calls the orchestrator scorer and propagates the score`. Mock `scoreOrchestrator` to return `{score: 7, ...}`. Verify the resulting `TestResult.score === 7`.
- [ ] **Step 2: Write a second test** — `when orchestrator scorer returns null, the test is recorded as errored with grader-skipped reason`.
- [ ] **Step 3: Run tests, verify both fail.**
- [ ] **Step 4: Refactor `scoreResponse`** to be async and accept `{ providerId, modelId, test, content, toolCalls }`. Update its single caller (`runGoldenTest` line 109) to await and pass the extra args. **Heads-up:** existing tests in `eval-runner.test.ts` may construct a `TestResult` directly or stub `scoreResponse`/`runGoldenTest` — when those break in Step 6, update mock signatures to match the new async contract; do NOT change call shapes elsewhere.
- [ ] **Step 5: Replace `case "orchestrator": return 5;`** with a call to `scoreOrchestrator(...)`. Handle the null-result case as documented above.
- [ ] **Step 6: Run the FULL eval-runner test file** — every existing test must still pass:
  ```sh
  pnpm --filter @dpf/web exec vitest run apps/web/lib/routing/eval-runner.test.ts
  ```
- [ ] **Step 7: Run the full routing test suite** as a regression net:
  ```sh
  pnpm --filter @dpf/web exec vitest run apps/web/lib/routing/
  ```
- [ ] **Step 8: Commit:**
  ```sh
  git add apps/web/lib/routing/eval-runner.ts apps/web/lib/routing/eval-runner.test.ts
  git commit -s -m "feat(routing): wire orchestrator scorer into eval-runner (replaces 5/10 stub)"
  ```

---

## Task 5: Stability scoring — 3× repetition for orchestrator-scored tests

**Why:** Quantization-unstable models (common at Q4) produce different outputs at temp=0. We measure that.

**Files:**
- Create: `apps/web/lib/routing/stability-scorer.ts`
- Create: `apps/web/lib/routing/stability-scorer.test.ts`
- Modify: `apps/web/lib/routing/eval-runner.ts` — call stability scorer once per orchestrator-scored test, accumulate per-dimension stability, write to `ModelProfile.stabilityScore` at the end of `runDimensionEval`.

**Contract:**
```ts
/**
 * Returns a 0-100 stability score: percentage of byte-identical responses across the runs.
 * 3 identical responses → 100. 2 same + 1 different → 67. 3 different → 33.
 * (We use "fraction of responses matching the modal response" rather than pairwise; cleaner.)
 */
export function computeStabilityFromResponses(responses: string[]): number;
```

**Implementation:**
- Group responses by exact string equality (after `.trim()`).
- Find the largest group's size; return `Math.round((largestGroupSize / responses.length) * 100)`.
- Edge case: empty responses array → return 0 (caller's responsibility to not call with []).

**Eval-runner integration:**
- For each `orchestrator`-scored test in `evalDimension`, call the model 3 times instead of 1. Score the *first* response with the orchestrator scorer (don't grade three times — that's 3× cost without benefit). Compute stability from all 3 responses.
- Aggregate per-dimension stability as the mean across all orchestrator-scored tests in that dimension.
- After all dimensions complete in `runDimensionEval`, compute model-level stability as the mean across dimension stabilities. Write to `ModelProfile.stabilityScore` and `ModelProfile.lastStabilityCheckAt = new Date()`.
- If a dimension has zero orchestrator-scored tests, contribute nothing to the model-level mean (don't write 0).
- If the model has zero orchestrator-scored tests across all dimensions, leave `stabilityScore` unchanged (do not overwrite with null).

**Cost-ceiling test:** A new test in `eval-runner.test.ts` must mock `callProvider` with a counter and assert that `runDimensionEval` calls it at most `(N_non_orchestrator_tests + 3 × N_orchestrator_tests)` times — proves we don't accidentally 3× every test.

- [ ] **Step 1: Write `stability-scorer.test.ts`** with five cases:
  - `3 identical responses → 100`
  - `2 same + 1 different → 67`
  - `3 different responses → 33` (each in a group of 1; largest group is 1 of 3)
  - `whitespace-only differences are normalized away (trim before compare)`
  - `empty array → 0`
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `stability-scorer.ts`** (~15 lines).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit:**
  ```sh
  git add apps/web/lib/routing/stability-scorer.ts apps/web/lib/routing/stability-scorer.test.ts
  git commit -s -m "feat(routing): add stability score computation"
  ```
- [ ] **Step 6: Write the cost-ceiling test in `eval-runner.test.ts`** with TWO assertions:
  - **(a) Subject-call ceiling:** mock `callProvider` with a counter, run a small synthetic dimension with 1 orchestrator + 1 exact test, assert counter === 4 (1 exact + 3 orchestrator-repetitions).
  - **(b) Grader-call ceiling:** mock `scoreOrchestrator` with a counter, run the same synthetic dimension, assert counter === 1 (we grade only the **first** of the 3 repetitions, per Task 5 design — the other two responses are used solely for stability comparison).
  - Together these pin the production ceiling: 3 conversational orchestrator-tests × (3 subject calls + 1 grader call) = 9 subject calls + 3 grader calls per `runDimensionEval` for the conversational dimension.
- [ ] **Step 7: Write a second new test** — mocked 3× orchestrator runs return `["X", "X", "Y"]`; assert `ModelProfile.stabilityScore` is updated to ~67 after `runDimensionEval` completes.
- [ ] **Step 8: Run, verify fail.**
- [ ] **Step 9: Modify `evalDimension` to run orchestrator-scored tests 3× and collect responses; modify `runDimensionEval` to compute and persist model-level stability. Keep all other test runs at 1×.**
- [ ] **Step 10: Run the full routing suite again** (regression net):
  ```sh
  pnpm --filter @dpf/web exec vitest run apps/web/lib/routing/
  ```
- [ ] **Step 11: Commit:**
  ```sh
  git add apps/web/lib/routing/eval-runner.ts apps/web/lib/routing/eval-runner.test.ts
  git commit -s -m "feat(routing): persist stability score from 3x orchestrator-scored repetition"
  ```

---

## Task 6: Operational metrics capture

**Why:** Routing decisions for local models need to know "fast enough" — today we have nothing.

**Files:**
- Modify: `apps/web/lib/routing/eval-runner.ts` (capture per-call metrics from `InferenceResult`, aggregate, persist)
- Modify: `apps/web/lib/routing/eval-runner.test.ts`

**Available data:**
- `InferenceResult.outputTokens` and `InferenceResult.inferenceMs` already exist on every `callProvider` return (`apps/web/lib/inference/ai-inference.ts:48-56`). Compute `tokensPerSecond = outputTokens / (inferenceMs / 1000)` per call.
- `timeToFirstTokenMs` is **not** on `InferenceResult` today. Phase 1 persists it as `null` for every call (we capture the field shape but don't have a value to write). Add a TODO note that adapters can populate this in a later phase via streaming hooks.
- `peakVramMb` is **not** available from any current adapter. Phase 1 writes `null`. Add a TODO note that the Ollama adapter could query `/api/ps` to estimate VRAM; out of scope for Phase 1.

**Aggregation:**
- Within `runDimensionEval`, accumulate `tokensPerSecond` across every successful call (any scoring method, not just orchestrator). Compute the arithmetic mean.
- **Important — separate row from production-feedback rows.** `EndpointTaskPerformance` is keyed by `(endpointId, taskType)` (`schema.prisma:1331`). Today the rows are written by `production-feedback.ts:88-97` keyed by *production* task types (e.g., `"code-generation"`, `"reasoning"`). The `taskType: "dimension-eval"` value at `eval-runner.ts:284` is on a different table — `EndpointTestRun`, not `EndpointTaskPerformance`. We are **intentionally creating a parallel row** with `taskType: "dimension-eval"` to hold eval-call metrics; we are NOT enriching the production-feedback rows. This keeps the two metric pipelines independent (production observations vs. eval observations measure different things).
- Persist via `prisma.endpointTaskPerformance.upsert({ where: { endpointId_taskType: { endpointId: providerId, taskType: "dimension-eval" } }, create: { endpointId: providerId, taskType: "dimension-eval", tokensPerSecondAvg, ttftMsAvg: null, peakVramMbAvg: null }, update: { tokensPerSecondAvg, ttftMsAvg: null, peakVramMbAvg: null } })`. Other fields (`evaluationCount`, `successCount`, `dimensionScores`, `recentScores`, etc.) keep their schema defaults on create and are not touched on update.
- **Implication for Task 8 (admin UI):** the operations page must read `EndpointTaskPerformance.tokensPerSecondAvg` from the `taskType: "dimension-eval"` row specifically, not from production-feedback rows.

**Edge cases:**
- If `inferenceMs === 0` (synthetic / cached), skip that call's contribution to the mean (don't divide by zero).
- If zero successful calls, do not upsert — leaves the row's existing values untouched.

- [ ] **Step 1: Write a test in `eval-runner.test.ts`** — mock `callProvider` to return `{outputTokens: 100, inferenceMs: 1000, ...}` for one call and `{outputTokens: 50, inferenceMs: 500, ...}` for another. Run a synthetic dimension. Assert `prisma.endpointTaskPerformance.upsert` was called with `tokensPerSecondAvg === 100` (both calls were 100 tok/s).
- [ ] **Step 2: Write a second test** — `inferenceMs === 0` calls are excluded from the mean.
- [ ] **Step 3: Run, verify fail.**
- [ ] **Step 4: Implement metric accumulation in `runDimensionEval`** and the upsert at the end of the function (just before the return statement, after the EndpointTestRun completion update).
- [ ] **Step 5: Run, verify pass.**
- [ ] **Step 6: Run the full routing suite** (regression net).
- [ ] **Step 7: Commit:**
  ```sh
  git add apps/web/lib/routing/eval-runner.ts apps/web/lib/routing/eval-runner.test.ts
  git commit -s -m "feat(routing): capture tokens-per-sec from eval calls into EndpointTaskPerformance"
  ```

---

## Task 7: Selection-by-id query mode for golden tests

**Why:** Re-grade a single failed prompt without re-running the suite.

**Files:**
- Modify: `apps/web/lib/routing/golden-tests.ts:382-384` (existing `getTestsForDimension`)
- Modify: `apps/web/lib/routing/golden-tests.test.ts` (or create if absent)

**Add:**
```ts
/** Get a single golden test by ID. Returns undefined if not found. */
export function getTestById(id: string): GoldenTest | undefined {
  return GOLDEN_TESTS.find((t) => t.id === id);
}
```

That's it. No indexed Map needed — the array has < 100 entries; linear scan is fine. (YAGNI on the Map.)

- [ ] **Step 1: Write tests** — `returns the test with matching id` and `returns undefined for unknown id`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Add `getTestById` and re-export from `routing/index.ts:25` block.**
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit:**
  ```sh
  git add apps/web/lib/routing/golden-tests.ts apps/web/lib/routing/golden-tests.test.ts apps/web/lib/routing/index.ts
  git commit -s -m "feat(routing): add getTestById for single-test re-grading"
  ```

---

## Task 8: Admin UI — surface new metrics on /platform/ai/operations

**Why:** Acceptance criterion in spec §5 requires metrics be visible.

**Files:**
- Read first (verified to exist): `apps/web/app/(shell)/platform/ai/operations/page.tsx` (`page.test.ts` is alongside).
- Modify: that page + any data-loading function it calls (likely in `apps/web/lib/actions/`).

**Behavior:**
- Add three columns to the existing per-endpoint metrics table:
  - **Stability** — from `ModelProfile.stabilityScore`, render as "—" when null.
  - **Tokens/sec** — from `EndpointTaskPerformance.tokensPerSecondAvg` **on the row where `taskType === "dimension-eval"`** (per Task 6). Render as `123 tok/s` or "—".
  - **Last stability check** — from `ModelProfile.lastStabilityCheckAt`, relative time or "never".
- TTFT and peak VRAM columns: skip in Phase 1 (they're always null today). A TODO comment in the JSX is sufficient.

- [ ] **Step 1: Read the operations page** to understand its current structure. If the page renders rows from a server action, identify the action.
- [ ] **Step 2: Extend the server action's selected fields** to include the new columns. Type-check.
- [ ] **Step 3: Add the new table columns** with appropriate empty-state rendering.
- [ ] **Step 4: Manually verify in the running portal** (per `feedback_manual_testing_coworker`):
  ```sh
  pnpm --filter @dpf/web dev
  # Navigate to /platform/ai/operations; confirm columns render with "—" for fresh data.
  ```
  If the dev server is already running, use it; do not restart unnecessarily.
- [ ] **Step 5: Commit:**
  ```sh
  git add apps/web/app/(shell)/platform/ai/operations/ apps/web/lib/actions/
  git commit -s -m "feat(admin): surface stability + tokens/sec on AI operations page"
  ```

---

## Task 9: Final verification, typecheck, push, PR

- [ ] **Step 0: Live smoke check.** Unit tests prove plumbing; only a live call proves the grader prompt produces parseable JSON across actual frontier models. Manually trigger one `ai/eval.run` Inngest event against an active cloud model (e.g., the one already configured in dev), then query: `select "conversational", "stabilityScore", "lastStabilityCheckAt" from "ModelProfile" where "providerId" = '<active>' and "modelId" = '<active>'`. Confirm `conversational` moved off 50 (proves grader returned a real number) and `stabilityScore` is non-null. If the grader returns malformed JSON consistently, fix the prompt in Task 3 before push.
- [ ] **Step 1: Typecheck the full monorepo** (the merge-blocking gate per CLAUDE.md):
  ```sh
  pnpm typecheck
  ```
  Any error blocks. Fix in place; no `// @ts-ignore`.
- [ ] **Step 2: Production build** (the second merge-blocking gate):
  ```sh
  pnpm --filter @dpf/web build
  ```
- [ ] **Step 3: Run all routing + eval tests once more:**
  ```sh
  pnpm --filter @dpf/web exec vitest run apps/web/lib/routing/ apps/web/lib/queue/functions/
  ```
- [ ] **Step 4: Push the branch:**
  ```sh
  git push -u origin feat/local-llm-grading-phase-1
  ```
- [ ] **Step 5: Open the PR** against `main`:
  ```sh
  gh pr create --base main --head feat/local-llm-grading-phase-1 --title "feat(routing): local LLM grading phase 1 — real orchestrator scorer + stability + ops metrics" --body "$(cat <<'EOF'
  ## Summary
  - Phase 1 of the [local LLM grading spec](docs/superpowers/specs/2026-04-26-local-llm-grading-incremental-design.md) (PR #296).
  - Replaces the hardcoded `return 5` orchestrator stub at `eval-runner.ts:88` with a real LLM grader that selects a frontier-tier endpoint via `selectGrader` (no provider pinning, self-grading guard).
  - Adds stability scoring via 3× temp=0 repetition for orchestrator-scored tests.
  - Captures `tokensPerSecond` per eval call and persists to `EndpointTaskPerformance`.
  - Surfaces new metrics on `/platform/ai/operations`.

  ## Routing-impact statement
  - `routeTask`, `computeNewScore`, `scoreDimension`, and the production-feedback nudge logic are **unchanged**.
  - The conversational dimension previously hardcoded to 50/100 for every model now reflects real grading. Models with `evalCount > 0` are smoothed by the existing 70/30 rolling average; models with `evalCount === 0` get their first measured score (intended).
  - Cost ceiling: orchestrator-scored tests run 3× per eval (currently 3 tests × 3 = 9 grader calls per model per eval). Cost-ceiling test enforces this.

  ## Test plan
  - [ ] CI typecheck + production build green
  - [ ] `vitest run apps/web/lib/routing/` all green (existing + 9 new tests)
  - [ ] Manual: `/platform/ai/operations` renders three new columns with sensible empty states on a fresh install
  - [ ] Manual: trigger one `ai/eval.run` Inngest event, confirm `ModelProfile.stabilityScore` and `EndpointTaskPerformance.tokensPerSecondAvg` get populated

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

---

## Known minor risks accepted in Phase 1

- **Concurrent eval race on `stabilityScore`.** `runDimensionEval` writes `ModelProfile.stabilityScore` once per `(providerId, modelId)`. If two `ai/eval.run` Inngest events fire concurrently for the same model (rare but possible with manual + scheduled triggers overlapping), the last writer wins. Acceptable in Phase 1 — neither value is "wrong"; both reflect a real measurement seconds apart. A Phase 3+ calibration orchestrator can add lock semantics if it becomes a problem.
- **Migration timestamp collisions.** Per CLAUDE.md, migration timestamps must be unique. Prisma generates the timestamp by second; if a concurrent worktree session lands a migration in the same second, regenerate (`prisma migrate dev` will refuse to apply, surfacing the conflict immediately — not silent).

## Deferred / explicitly out of scope (Phase 2-4 will pick up)

- Hidden-trap prompt suite (Phase 2). Phase 1 keeps the existing thin fixtures.
- New `EvalPrompt` table + file-sourced prompts (Phase 2).
- Cold-start calibration trigger on provider activation (Phase 3).
- TTFT and VRAM measurement (Phase 4 — needs adapter changes).
- Quantization-matrix and context-degradation grading (Phase 4).
- `getTestById`-driven admin "re-grade this prompt" button (next phase; the helper is added now to unblock it).

---

## Rollback plan

If Phase 1 causes routing instability in production:
1. Revert the PR. The migration is additive nullable — no down-migration needed; the new columns simply stay null.
2. The orchestrator stub returns to `return 5` and conversational scores re-stabilize at 50/100.
3. Open a follow-up issue with the specific routing decision that regressed (route-decision-log query).
