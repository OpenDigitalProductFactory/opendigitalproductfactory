# EP-INF-001-P6: Continuous Evaluation Loop

**Date:** 2026-03-19
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Epic:** EP-INF-001 (Phase 6)

**Prerequisites:**
- EP-INF-001 Phases 1–4 (manifest-based routing with capability profiles) — complete
- Endpoint Test Runner (`endpoint-test-runner.ts`) — existing
- Orchestrator Evaluator (`orchestrator-evaluator.ts`) — existing

---

## Problem Statement

The manifest-based routing system (EP-INF-001) relies on 0–100 capability scores across 7 dimensions to select the best endpoint for each task. Currently these scores are populated from seed data (`profileSource: "seed"`, `profileConfidence: "low"`). Seed data is a starting estimate — it doesn't reflect actual endpoint performance, doesn't detect when a provider silently updates model weights, and doesn't adapt as endpoints degrade or improve.

Without a systematic evaluation mechanism:
1. Seed profiles go stale — a model that improves in a new version keeps its old scores
2. Silent model updates go undetected — providers change weights without changing model names
3. Degraded endpoints aren't discovered until users complain
4. Profile confidence stays "low" permanently — the routing system knows it's guessing but can't improve

---

## Terminology

- **Golden Test Set** — a deterministic set of prompts per capability dimension with verifiable expected outputs. The primary authority for capability scores.
- **Dimension Eval** — a full evaluation run across all 7 dimensions for one endpoint, using the golden test sets. Produces 0–100 scores.
- **Production Observation** — a secondary signal from real conversations. The orchestrator-evaluator's 1–5 score for a conversation is mapped to a small nudge on the relevant capability dimension.
- **Drift** — a significant drop in a dimension score between evaluations, indicating the endpoint's capabilities have changed (usually due to a silent model update).

---

## Design Summary

Two complementary feedback mechanisms keep capability profiles current:

1. **Golden test evaluations (on-demand)** — operators trigger dimension evals from the ops UI. Each eval runs ~10 deterministic prompts per dimension per endpoint, producing authoritative 0–100 scores. These are the primary profile authority.

2. **Production observation feedback (continuous)** — the existing orchestrator-evaluator scores every conversation. Those scores are mapped to small nudges on the relevant capability dimensions, keeping profiles responsive between formal evaluations.

Golden tests set the baseline. Production observations track the trend.

### Key Principles

- **On-demand, not autonomous** — operators decide when to evaluate. Cost is predictable. Scheduling infrastructure (`ScheduledJob`) exists for future automation.
- **Golden tests are authoritative** — production observations are secondary and can't override a golden test result within 24 hours.
- **Drift detection is built in** — if a dimension score drops significantly between evals, the endpoint is flagged and optionally degraded.
- **Everything is auditable** — every score change has a source, timestamp, and reason.

---

## Section 1: Dimension-Specific Golden Tests

### Golden Test Sets

Each of the 7 capability dimensions has a set of ~10 deterministic prompts with verifiable expected outputs:

| Dimension | Test Type | Scoring Method |
|---|---|---|
| `reasoning` | Multi-step logic problems with known answers | Correct answer = 10pts, partial = 5pts, wrong = 0pts. Sum and normalize to 0–100. |
| `codegen` | "Write function X" → run output against test cases | Pass rate across test cases × 100 |
| `toolFidelity` | Present tool schemas → validate call structure, correct arguments, correct abstention | Schema validity × argument correctness × abstention accuracy |
| `instructionFollowing` | Give specific format constraints → check compliance | % of constraints satisfied |
| `structuredOutput` | Request JSON matching a schema → validate against schema | Schema conformance rate × 100 |
| `conversational` | Multi-turn coherence prompts (orchestrator-graded 1–5, scaled) | Average orchestrator score × 20 |
| `contextRetention` | Needle-in-haystack at 25%, 50%, 75% of context window | Retrieval accuracy × 100 |

### Test Execution Flow

1. Operator triggers eval from ops UI — per-endpoint or all active endpoints
2. For each endpoint × dimension: run the golden test set
3. Score each response using the dimension-specific scoring method
4. Compute new dimension score using weighted rolling average: `newScore = 0.7 × evalScore + 0.3 × previousScore`
5. Update `ModelProvider` capability fields
6. Update provenance: `profileSource = "evaluated"`, increment `evalCount`, set `lastEvalAt`
7. Update confidence: `profileConfidence = "medium"` if evalCount < 5, `"high"` if >= 5
8. Persist an `EndpointTestRun` record with `taskType: "dimension-eval"` and full results in the `results` JSON field

### Drift Detection

After computing new scores, compare against previous values:

| Delta | Action |
|---|---|
| Drop ≤ 15 points | Normal variation, log only |
| Drop > 15 points | Flag as drift — log `ProfileDriftDetected`, show warning in ops UI |
| Drop > 25 points | Severe drift — mark endpoint `degraded`, flag in ops UI for human review |

Drift is per-dimension. An endpoint can drift on `toolFidelity` while remaining stable on `reasoning`.

### Golden Test Storage

Golden test sets are stored as a static registry in code (similar to how `TASK_TYPES` was originally a static array). Each entry:

```typescript
interface GoldenTest {
  dimension: BuiltinDimension;
  prompt: string;
  systemPrompt?: string;
  tools?: Array<Record<string, unknown>>;  // for toolFidelity tests
  expectedSchema?: object;                  // for structuredOutput tests
  scoring: "exact" | "partial" | "orchestrator" | "schema" | "tool_call";
  expectedOutput?: string;                  // for exact/partial scoring
  maxTokens?: number;
}
```

Tests are versioned — if a golden test is updated, the old version is retained for comparison (so drift detection isn't triggered by test changes).

---

## Section 2: Production Observation Feedback

### Task-to-Dimension Mapping

When the orchestrator evaluates a conversation, the task type determines which capability dimensions receive feedback:

| Task Type | Primary Dimension | Secondary Dimension |
|---|---|---|
| `reasoning` | `reasoning` | — |
| `code-gen` | `codegen` | `instructionFollowing` |
| `tool-action` | `toolFidelity` | — |
| `data-extraction` | `structuredOutput` | — |
| `summarization` | `instructionFollowing` | — |
| `greeting` | `conversational` | — |
| `creative` | `conversational` | `reasoning` |
| `web-search` | `toolFidelity` | — |
| `status-query` | `instructionFollowing` | — |

### Score Translation

Orchestrator scores (1–5) translate to small dimension nudges:

```
dimensionDelta = (orchestratorScore - 3) × 4
```

| Orchestrator Score | Delta | Meaning |
|---|---|---|
| 5 | +8 | Strong performance |
| 4 | +4 | Good |
| 3 | 0 | Neutral (met expectations) |
| 2 | -4 | Below expectations |
| 1 | -8 | Poor |

Applied: `newScore = clamp(currentScore + dimensionDelta, 0, 100)`

This is deliberately small — production observations shift scores slowly. Golden tests are the authority; production is the trend signal.

### Integration Point

`orchestrator-evaluator.ts` already calls `updatePerformanceProfile()` after every evaluation. A new function `updateEndpointDimensionScores(endpointId, taskType, orchestratorScore)` is called alongside it:

1. Look up the task-to-dimension mapping
2. Compute the delta
3. Update `ModelProvider` dimension fields
4. Set `profileSource` to `"production"` only if current source is `"seed"` (golden test results — `"evaluated"` — are not downgraded to production)

### Guardrails

- **Golden test recency protection:** Production observations do not update a dimension within 24 hours of a golden test eval on that dimension. The golden test result is authoritative during that window.
- **Score clamping:** All scores are clamped to [0, 100]. No runaway drift from a burst of bad conversations.
- **Minimum observation threshold:** At least 5 production observations on a dimension are required before feedback affects the `ModelProvider` profile. Until then, observations are accumulated in `EndpointTaskPerformance.dimensionScores` but not propagated.
- **Secondary dimensions receive half the delta:** For task types with a secondary dimension (e.g., `code-gen` → `instructionFollowing`), the secondary dimension receives `dimensionDelta / 2`.

---

## Section 3: Ops UI & Audit Trail

### Eval Controls

Add to the existing endpoint management in the ops UI:

- **"Run Evaluation" button** per endpoint — triggers a full dimension eval for that endpoint
- **"Evaluate All" button** — triggers dimension eval for all active/degraded endpoints
- **Eval status display** per endpoint — `lastEvalAt`, `profileConfidence`, drift warning if detected
- **Dimension score display** — the 7 scores as a compact row per endpoint, with trend indicators (↑/↓/= based on delta from last eval)

### Audit Records

**Per golden test eval:**
- `EndpointTestRun` record with `taskType: "dimension-eval"` containing:
  - Per-dimension results: which prompts passed/failed, raw scores, computed dimension score
  - Previous vs new score per dimension
  - Drift detection outcomes
  - Total tokens consumed

**Per production observation update:**
- The existing `TaskEvaluation` record (unchanged)
- Dimension update logged as: `"reasoning nudged: 82 → 83 (source: production, orchestrator score 4 on reasoning task, 2026-03-19 14:32)"`

**Per drift detection:**
- `"drift detected on toolFidelity: 85 → 62 (eval run #12, 2026-03-19). Endpoint marked degraded."`

All audit data is queryable from the ops UI via the existing `RouteDecisionLog` and `EndpointTestRun` tables.

### What This Doesn't Include (YAGNI)

- **No autonomous scheduling** — evals are on-demand. `ScheduledJob` infrastructure exists for future automation.
- **No custom eval dimensions** — built-in 7 only. The `CustomEvalDimension` table exists for future use.
- **No per-task-type golden tests** — dimension evals test endpoint capability broadly. Task-specific performance is tracked via `EndpointTaskPerformance`.
- **No eval cost budgeting** — all requested evals run to completion. Cost control is implicit in the on-demand trigger.

---

## Files Affected

| File | Change |
|---|---|
| `apps/web/lib/routing/eval-runner.ts` | **New** — dimension eval orchestration, golden test execution, drift detection |
| `apps/web/lib/routing/golden-tests.ts` | **New** — golden test registry (static test definitions per dimension) |
| `apps/web/lib/routing/eval-scoring.ts` | **New** — dimension-specific scoring functions (exact match, schema validation, tool-call validation, etc.) |
| `apps/web/lib/routing/production-feedback.ts` | **New** — `updateEndpointDimensionScores`, task-to-dimension mapping, guardrails |
| `apps/web/lib/orchestrator-evaluator.ts` | **Modified** — add call to `updateEndpointDimensionScores` after existing `updatePerformanceProfile` |
| `apps/web/lib/actions/ai-providers.ts` | **Modified** — add `runDimensionEval` server action for ops UI trigger |
| Ops UI components | **Modified** — eval trigger buttons, score display, drift indicators |
| `apps/web/lib/routing/eval-runner.test.ts` | **New** — tests for eval orchestration and drift detection |
| `apps/web/lib/routing/eval-scoring.test.ts` | **New** — tests for scoring functions |
| `apps/web/lib/routing/production-feedback.test.ts` | **New** — tests for observation feedback and guardrails |
