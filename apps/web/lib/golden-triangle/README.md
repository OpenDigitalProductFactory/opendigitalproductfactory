# Golden Triangle — preference-to-policy compiler

`EP-GOLDEN-TRIANGLE` · Slice 1 (`BI-8FF4CE21`). Design: [`docs/design/golden-triangle-design.md`](../../../../docs/design/golden-triangle-design.md) · Plan: [`docs/superpowers/plans/2026-06-21-golden-triangle-implementation-plan.md`](../../../../docs/superpowers/plans/2026-06-21-golden-triangle-implementation-plan.md).

## What this is

A **pure, deterministic** function that turns a human Cost/Quality/Time posture into a concrete agent policy. No I/O, no `Date`/random — inputs in, policy out (snapshot-testable).

```ts
import { compileGoldenTrianglePolicy } from "@/lib/golden-triangle";

const decoded = compileGoldenTrianglePolicy({
  preference: { preset: "assured", costWeight: 0.1, qualityWeight: 0.8, timeWeight: 0.1 },
  taskClass: "code-gen",
  authorityScope: { kind: "wwmd" },
  policyConstraints: { residency: "local_only", minimumTierFloor: "strong" },
  modelAvailability: { tiers: ["frontier", "strong"], healthy: true },
});
// decoded.postureOverride     → feeds inferContract()'s routeContext (never a parallel pass)
// decoded.orchestrationBudget → JSON on the receipt / DecisionInteraction.outcomePayload
// decoded.adjustments         → why the posture was clamped (for the decode panel + receipts)
// decoded.state               → "ok" | "blocked" | "defer" (fail-closed is first-class)
```

## Outputs (two layers)

- **`postureOverride`** — routing-shaped (`budgetClass`, `reasoningDepth`, `effort`, `minimumTier`, `maxLatencyMs`, `residencyPolicy`). Fed into `inferContract()`'s existing `routeContext` caller-override slot. The compiler **feeds** routing; it never re-implements it.
- **`orchestrationBudget`** — workflow-shaped (`maxDurationMs`, `retryBudget`, `verificationDepth`, `deliberationPattern`). Persisted as JSON on the receipt path; biases the agentic-loop governors and selects a deliberation pattern.

## Invariants

- **Balanced = no deltas.** `balanced` (and near-balanced custom) emits empty overrides, so routing produces exactly the platform/task defaults — the cold-start pass-through (byte-identical to flag-off).
- **Precedence:** hard policy > scope/task floor > posture > model availability. Residency, tier floor, and latency ceiling clamp the posture and are recorded as `adjustments`; **residency is never relaxed**.
- **Fail-closed is first-class:** unmet hard floor → `state: "blocked"`; no healthy models → `state: "defer"`. It never throws and never silently routes to a weaker path.
- **`verificationDepth` is inert** until a verify step exists (no evaluator in the loop yet — design §0.1 / Slice 0).

## Composition → routing (Slice 3a)

`applyPostureToRouteContext(postureOverride)` ([compose.ts](compose.ts)) splits a compiled `PostureOverride` into:
- a `routeContext` object to spread into `inferContract()`'s caller-override argument (`budgetClass`, `reasoningDepth`, `minimumTier`, `minimumDimensions`, `maxLatencyMs`, `residencyPolicy`), and
- `effort`, returned separately because it is **not** a `RequestContract` field — it rides `AgentRouteConfig`/routeOptions.

`inferContract()` was extended **additively** to accept `reasoningDepth` / `minimumTier` / `minimumDimensions` as caller overrides (caller-wins for `reasoningDepth`; stricter-wins, per-dimension max, for the tier/dimension floor). When the caller supplies none, contract inference is byte-for-byte unchanged (asserted in `request-contract.golden-triangle.test.ts`).

## Scope / not-yet

Present: the compiler (Slice 1) and the routing composition + `inferContract` extension (Slice 3a). Still pending: the **receipt/telemetry join + predicted-vs-actual drift** (Slice 3b, `BI-CF28CCF0`) — needs schema additions and is the source of the *"see the difference in outcome"* comparison data; the **accessible posture-selector UI** (Slice 2, `BI-D48EB34C`); and the **WWMD/WWWD default editor** (Slice 4, `BI-85B2E96C`). Nothing here is wired into a live caller yet.
