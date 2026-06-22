# Golden Triangle — Slice 0 Substrate Audit & Delta

*Companion to [`golden-triangle-design.md`](golden-triangle-design.md) · 2026-06-21*

This is the **Slice 0 exit artifact** the design doc requires ("a one-page substrate delta naming every schema addition and every reused table"). It is the result of a read-only, field-level audit of the substrate the preference-to-policy compiler will target. It unblocks Slice 1 (the pure compiler) by fixing exact read/write targets, and it records the one genuinely new surface plus two corrections to fold into the next design revision.

Citations are `file:line`; schema = `packages/db/prisma/schema.prisma`.

## 1. Reuse map (what the compiler reads/writes — no new entity)

| Layer | Substrate (reused) | Exact fields the compiler touches | R/W |
| --- | --- | --- | --- |
| Model | `ModelProfile` (schema.prisma:1568) | `costTier`, `qualityTier`, `inputPricePerMToken`, `outputPricePerMToken`, capability scores (`reasoning`/`codegen`/`toolFidelity`/…), `maxContextTokens`, `supportsToolUse`, `modelStatus` | R |
| Per-call posture | `RequestContract` + `inferContract()` (apps/web/lib/routing/request-contract.ts:19, 105) | WRITE through the existing `routeContext` caller-override slot (110–121): `budgetClass`, `maxLatencyMs`, `residencyPolicy`, `minimumDimensions`; READ tier-floor merge | W→infer |
| Per-call posture | `AgentRouteConfig.effort` (apps/web/lib/tak/agentic-loop.ts:266) + `chat-adapter.ts` (180–198, 319–328) | WRITE `effort` (`low`/`medium`/`high`/`max`) → Anthropic thinking budget / OpenAI `reasoning_effort`. The primary Quality↔Cost lever; **runtime param, not persisted** | W |
| Task floor / cold-start | `TaskRequirement` (schema.prisma:7001) + code-side `BUILT_IN_TASK_REQUIREMENTS` | READ `budgetClassDefault`, `reasoningDepthDefault`, `residencyPolicy`, and **`minimumTier` (code-side only)** for the Balanced pass-through | R |
| Agent floor | `AgentModelConfig` (schema.prisma:8853) | READ `minimumTier`, `minimumCapabilities`, `budgetClass` as the per-agent floor the posture cannot undercut | R |
| Orchestration (perspectives) | Deliberation engine — `DeliberationPattern` (9625, `defaultRoles[].count`), `DeliberationRun` (9665, `strategyProfile`/`diversityMode`/`maxBranches`/`budgetUsd`), `activation.resolve()` (apps/web/lib/deliberation/activation.ts:171) | WRITE a `patternSlug`/`strategyProfile` **selection** (perspective/review count is a pattern choice, not a raw integer). Selection today keys on risk+stage only — the triangle adds a posture input | W (selection) |
| Cost ledger (actuals) | `RouteOutcome` (2444, `requestId @unique`, `costUsd`, `latencyMs`, tokens, `fallbackOccurred`, `humanScore`), `TokenUsage` (1655), `AdapterRunTelemetry` (2528, `userAccepted`) | READ realized cost/latency/tokens/acceptance | R |
| Defaults + per-run snapshot | `DecisionInteraction` (9879) → `DecisionPerspectiveProfile` (9791) + `…ProfileVersion` (9825) | WRITE the per-run preference snapshot via the `DecisionInteraction` path; READ profile `scope`/`kind`/version for authority (WWMD/WWWD) + cold-start | R/W |

## 2. Gap findings

- **A — Orchestration budget: NO existing home.** Loop/duration ceilings are static phase constants (`MAX_DURATION_*`, agentic-loop.ts:55–59, selected by tool-set at 1270–1275); retry/nudge budgets are hardcoded (one-nudge cap 558–560, `MAX_PLAN_NUDGES=2` at 1104); **verification depth has no field and no governor at all** (no evaluator step in the loop); deliberation-pattern selection exists but is risk/stage-driven, never posture-driven. Schema grep for `orchestrationBudget|verificationDepth|retryBudget|maxDurationMs|loopBudget` = 0 hits.
- **B — Saved-defaults home: YES, extend it.** `DecisionInteraction.profileId` → `DecisionPerspectiveProfile` (relation 9907). It is org/principal-scoped (`ownerOrganizationId` 9797, `ownerPrincipalId` 9798), typed by `kind`+`scope` (9795–96), **versioned** (9825 — gives the receipt's profile-version stamp for free), and already carries `autonomyPolicy Json` (9802). It has **no** cost/quality/time field yet → extend the profile, don't add `DecisionPreferenceProfile`.
- **C — Predicted-vs-actual drift: NO.** `RouteOutcome.costUsd` (2456) / `TokenUsage.costUsd` (1663) store actuals only. `RequestContract.estimatedInputTokens/estimatedOutputTokens` (44–45) are computed at infer-time but never persisted. `AdapterRunTelemetry.estimatedCostUsd` (2559) is the adapter's self-estimate, not a triangle forecast paired with the actual. No `predicted*` column anywhere (grep = 0).
- **Correlation id: NO single id threads the chain.** `RouteOutcome.requestId` is the receipt key, but `RouteDecisionLog` joins via `agentMessageId`, `TokenUsage` via `contextKey`, `AdapterRunTelemetry` via `threadId`/`agentMessageId`, and `DecisionInteraction` has no route-receipt FK. The §8 minimum-fields correlation id must be propagated.
- **D — Existing posture/weights field: NO.** Closest are the coarse 3-value `budgetClass` enum and `DeliberationRun.strategyProfile`; no `costWeight`/`qualityWeight`/`timeWeight` vector or preset enum exists.

## 3. Substrate delta

**REUSE** — everything in §1 (ModelProfile, RequestContract/inferContract `routeContext`, `effort` + chat-adapter, TaskRequirement + BUILT_IN, AgentModelConfig, the deliberation engine, RouteOutcome/TokenUsage/AdapterRunTelemetry, DecisionInteraction + DecisionPerspectiveProfile + ProfileVersion).

**NEW** — minimal, biased to projection/extension:
1. **`OrchestrationBudget`** — a TS type `{ maxDurationMs?, retryBudget?, verificationDepth?: "none"|"shallow"|"deep", deliberationPattern? }`, persisted as **JSON on the receipt / `DecisionInteraction.outcomePayload`** (9903), not a new table. It *biases* existing governors (`MAX_DURATION_*`, nudge caps, `activation.resolve()`). The only truly unhomed levers (gap A).
2. **Triangle preference on `DecisionPerspectiveProfile`** — a typed `goldenTriangle` field/sub-key (preset + cost/quality/time weights + compiler/preset version) on the existing profile, plus a per-run `GoldenTrianglePreferenceSnapshot` on the `DecisionInteraction` path (gap B/D; resolves Open Decision 1 → extend).
3. **Predicted-cost capture** — `predictedInputTokens`/`predictedOutputTokens`/`predictedCostUsd` + the decoded-policy snapshot on the receipt/benchmark projection (gap C; enables the Decision 6 / §9 cost-calibration loop).
4. **One correlation id** — propagate `RouteOutcome.requestId` (or a new `receiptId`) onto `TokenUsage`, `AdapterRunTelemetry`, and `DecisionInteraction`. Wiring/columns, not a new entity (highest-effort item).
5. **`GoldenTriangleReceiptView`** — a read model/view joining preference snapshot → contract → `RouteOutcome` → telemetry → feedback. Start as a projection; materialize only if query cost or hive export demands.

**REJECT** — `ModelRegistryEntry` (ModelProfile is canonical); a detached `TrianglePosition` table (use the DecisionInteraction path); a parallel cost ledger (add predicted columns to the existing ones); a new `DecisionPreferenceProfile` table in v1 (extend DecisionPerspectiveProfile); a raw perspective-count field/new deliberation surface (compile to a pattern selection); a second routing/contract resolver (feed `inferContract`'s `routeContext`).

## 4. Orchestration-budget go/no-go

**GO — as a typed object persisted as JSON on the existing receipt / `DecisionInteraction` path; NOT columns on `AgentModelConfig`, NOT a new canonical table.**

- The levers are genuinely unhomed (gap A) — real missing substrate, not a reflexive new concept.
- Not `AgentModelConfig`: that model is keyed `agentId @id` (8853) — a per-agent floor, one row per coworker. The orchestration budget is **per-decision / per-phase** (set at phase boundaries per the design's HITL rule), so it cannot hang off a per-agent singleton without conflating lifetimes.
- Not a new table: the receipt/`DecisionInteraction` path already exists with versioning and `outcomePayload Json` (9903); the budget is read transiently by the loop + deliberation orchestrator and needs no queryable entity in v1.
- It biases existing machinery (`MAX_DURATION_*`, nudge caps, `activation.resolve()`), keeping it "one modest new object on the receipt."

## 5. Corrections to fold into the next design revision

1. **`TaskRequirement.minimumTier` is not a DB column** (7001–7027). The cold-start text in §7 should source the Balanced tier floor from the code-side `BUILT_IN_TASK_REQUIREMENTS` read by `inferContract` (request-contract.ts:294), not the DB row.
2. **`verificationDepth` has no consuming governor today** — there is no evaluator-optimizer in the agentic loop. The field can be defined and recorded now, but a `"deep"` value is inert until a verify step is wired. Slice 1 must not let the compiler promise verification the runtime cannot execute yet.

## 6. What this unblocks

Slice 1 (the pure `compileGoldenTrianglePolicy()`) can begin with fixed contracts: it **reads** the §1 substrate, **writes** a posture override into `inferContract`'s `routeContext` plus an `OrchestrationBudget` and a `deliberationPattern` selection, and emits a decoded-policy snapshot for the receipt. Balanced compiles to no deltas (cold-start pass-through). No new canonical tables; the only schema additions are predicted-cost columns + a propagated correlation id + a `goldenTriangle` extension on `DecisionPerspectiveProfile`.
