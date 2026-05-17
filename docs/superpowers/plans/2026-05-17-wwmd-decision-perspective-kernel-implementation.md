# WWMD Decision Perspective Kernel - Implementation Plan

> Status: ready for implementation after reviewed spec updates.
> Source spec: `docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md`.
> First product surface: Build Studio plan -> build advancement gate.

## Goal

Implement the first durable WWMD/WWWD kernel slice: a governed decision perspective service that can evaluate one Build Studio ambiguity point, persist a decision ledger record, and show the operator why the gate recommended, arbitrated, escalated, or deferred.

This is not the standalone Ask WWMD surface and not the marketing article. Those need real gate evidence first.

## Reviewed Decisions

- V1 profile is `Mark / DPF Platform`, scoped to DPF platform/product decisions.
- Customer WWWD profiles are isolated from Mark-specific doctrine by default.
- The profile model supports a fallback chain from day one: active profile -> DPF product doctrine -> DPF organizational principles -> defer.
- Plan advancement is the first Build Studio integration point.
- Outcomes are `recommend`, `arbitrate`, `escalate`, and `defer`.
- Rule-based confidence ships first. Model-assessed evidence fit waits until the ledger has enough human correction data.
- Build Studio owner is the first resolver. Mark is only the escalation target for platform doctrine beyond owner authority.
- Marketing/public article work is deferred until implementation evidence exists.
- **Failure semantics: fail-closed.** If the evaluator throws or the profile/material loader fails, advancement is blocked and a `DecisionInteraction` is written with `outcomeType: "escalate"` and `rationale` carrying the error class. The operator sees an escalation; the cause is logged. WWMD never silently allows advancement on its own failure — the whole point of the kernel is that a missing decision is a deferred decision, not an automatic yes.
- **Idempotency: keyed on `(featureBuildId, phaseFrom, phaseTo, profileVersionId)`.** Re-invoking the gate for the same build/phase transition within the same profile version returns the existing `DecisionInteraction` row rather than creating a duplicate, unless the operator has explicitly written an `EscalationCapture` clearing the prior outcome. This prevents double-write on accidental retries and preserves a single audit trail per advancement attempt.
- **Recent override window: rolling 30-day window scoped to the same `domainClass` and `profileId`.** The confidence formula's `recentOverrideCount` counts `EscalationCapture` rows where the human's resolution disagreed with the gate's recommendation. The window is a constant in `evaluator.ts` and changes require a deliberate code update with a test case.

## Existing Seams Verified

- Phase-gate policy is pure in `apps/web/lib/explore/feature-build-types.ts` via `checkPhaseGate`.
- The portal action path advances builds in `apps/web/lib/actions/build.ts`.
- The API path advances builds in `apps/web/app/api/agent/build/advance-phase/route.ts`.
- Build Studio derives visible actions in `apps/web/components/build/build-studio-workflow-actions.ts` and renders the control in `BuildStudioWorkflowActionCard.tsx`.
- Build rows are hydrated through `apps/web/lib/actions/build-read.ts` and `apps/web/lib/explore/feature-build-data.ts`.
- Deliberation evidence already exists as `DeliberationRun`, `DeliberationOutcome`, `ClaimRecord`, `EvidenceBundle`, and compact `FeatureBuild.deliberationSummary`.
- `TaskRun.buildId` can connect Build Studio work to deliberation and coworker task context.

## Architecture Shape

Keep the decision perspective kernel out of `checkPhaseGate`. The existing phase gate stays the deterministic prerequisite gate. WWMD is an autonomy/delegation gate layered after the deterministic gate says the build is mechanically eligible to advance.

New application module:

- `apps/web/lib/decision-perspective/types.ts`
- `apps/web/lib/decision-perspective/default-profile.ts`
- `apps/web/lib/decision-perspective/material.ts`
- `apps/web/lib/decision-perspective/evaluator.ts`
- `apps/web/lib/decision-perspective/build-studio-gate.ts`
- `apps/web/lib/decision-perspective/persistence.ts`

The refactoring target is deliberate: move shared plan-advancement context assembly into one module so the action path, API path, future MCP path, and UI inspector do not each reinterpret plan readiness, risk, profile version, and evidence context.

## Data Model Slice

Add the smallest schema that still preserves the profile boundary, version snapshot, and ledger audit trail required by the spec.

Models:

- `DecisionPerspectiveProfile`
  - `profileId`, `name`, `kind`, `scope`, `ownerOrganizationId`, optional `ownerPrincipalId`, optional `fallbackProfileId`, `defaultResolver`, `autonomyPolicy`, `currentVersionId`, status timestamps.
- `DecisionPerspectiveProfileVersion`
  - `versionId`, `profileId`, `versionNumber`, `materialFingerprint`, `changeSummary`, `promotedByPrincipalId`, timestamps.
- `PerspectiveMaterial`
  - `materialId`, `profileId`, optional `profileVersionId`, `sourceType`, `sourceRef`, `scope`, `domainClass` (the decision class this material applies to — e.g. `plan-readiness`, `architecture-tradeoff`, `risk-assessment`), `direction` (signed stance vector for principle conflict detection — see Slice 2), `evidenceGrade` (`A` | `B` | `C` | `D`, per the deliberation framework's grade scale), `freshness`, `confidenceWeight`, `reviewStatus`, `promotionState`, validation timestamps, summary.
- `DecisionInteraction`
  - `interactionId`, `profileId`, `profileVersionId`, optional `fallbackProfileId`, optional `featureBuildId`, optional `taskRunId`, optional `deliberationRunId`, `triggeredByUserId` (FK to the user/principal who caused the gate to fire), `routeContext`, `phaseFrom`, `phaseTo`, `domainClass`, `question`, `options`, `evidenceBundle`, `sources`, `rationale`, `riskTier`, `confidenceBefore`, `confidenceAfter`, `outcomeType`, `outcomePayload`, `humanOutcome`, `principleConflict` (boolean), timestamps. Composite unique index on `(featureBuildId, phaseFrom, phaseTo, profileVersionId)` to enforce idempotency.
- `EscalationCapture`
  - `interactionId`, resolver principal/user, prompt, answer, criteria, rationale, objectionsResolved, `domainClass` (string — the decision class that was escalated; required for drift detection in later backlog), candidateMaterial flag, timestamps.
- `DeferralCapture`
  - `interactionId`, domain, gapReason, suggestedSourceTypes, candidateMaterial flag, timestamps.

String-valued fixed domains get TypeScript constant arrays in `types.ts` and corresponding runtime guards. Do not add database enum types unless the repo already has a reason to promote them there.

## TDD Sequence

Write failing tests before production code.

1. Evaluator tests in `apps/web/lib/decision-perspective/evaluator.test.ts`
   - Returns `defer` when the active profile and fallback chain have no applicable material.
   - Returns `escalate` for high risk with medium or low confidence.
   - Returns `recommend` when coverage is sufficient but autonomy is not high enough to arbitrate.
   - Returns `arbitrate` only for high confidence, low risk, and allowed autonomy.
   - Gives `contradicted` material zero weight.
   - Discounts `stale` and `superseded` material below current material.
   - Records fallback profile usage when the active profile lacks coverage.
   - Confidence score for a set of all-`current` Grade A sources meets the `recommend` threshold.
   - Confidence score for a mix of `stale` and Grade C sources stays below `arbitrate` threshold.
   - Principle conflict where both sides are equally weighted produces `escalate`, not a synthetic recommendation.
   - Evaluator throwing on malformed input is caught by the gate service and produces a fail-closed `escalate` outcome with the error class recorded in `rationale` — never a thrown exception that bubbles to the operator without a ledger row.
2. Build Studio gate tests in `apps/web/lib/decision-perspective/build-studio-gate.test.ts`
   - Builds a plan-advancement question from `FeatureBuild` evidence.
   - Includes compact deliberation summary when present.
   - Persists a `DecisionInteraction` for every invocation.
   - Blocks phase advancement on `escalate` or `defer`.
   - Allows phase advancement on `recommend` or `arbitrate`, while preserving the ledger.
3. Action/API tests in `apps/web/lib/actions/build-governed.test.ts` and `apps/web/app/api/agent/build/advance-phase/route.test.ts`
   - `advanceBuildPhase` invokes WWMD only for `plan -> build` after deterministic phase prerequisites pass.
   - `advanceBuildPhase` does not invoke WWMD for any other phase transition in v1.
   - `/api/agent/build/advance-phase` returns a 422 with `decisionInteraction` when WWMD escalates or defers.
   - The existing Build Studio operator can view and accept a WWMD escalation, which then permits re-attempt; this is the only override path and it requires writing an `EscalationCapture` first.
4. UI tests
   - Build Studio action guidance renders a WWMD gate summary for plan advancement.
   - The workflow action card renders outcome type, confidence tier label, at least one source label, and the escalation/deferral action prompt.
   - The workflow action card does not render when WWMD has not yet been invoked for the current phase.
   - Decision ledger/inspector renders profile version, outcome type, confidence before/after, source count, and escalation or deferral status without crashing on null fields.

## Implementation Slices

### Slice 1 - Schema, generated client, and profile seed

Files:

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/<timestamp>_add_decision_perspective/migration.sql`
- `apps/web/lib/decision-perspective/types.ts`
- `packages/db/src/seed-decision-perspective.ts`
- focused type/runtime guard tests

The seed file follows the existing DPF convention: file-backed content seeded to DB rows, readable at runtime from DB with file fallback on miss. It creates the `Mark / DPF Platform` profile with an initial version snapshot and a starter set of `PerspectiveMaterial` rows drawn from DPF platform principles already in the wiki. The seed is idempotent (`upsert` on `profileId`).

The material fingerprint on the initial version is a deterministic hash of the seeded source refs so the first `DecisionInteraction` records link to a real, auditable snapshot rather than a null version.

Exit:

- Prisma migration creates the six required models and indexes.
- `pnpm --filter @dpf/db exec prisma validate` passes.
- `packages/db/src/seed-decision-perspective.ts` runs without error against a fresh DB and produces one profile, one version snapshot, and at least five `PerspectiveMaterial` rows for the `Mark / DPF Platform` profile.
- Re-running the seed is idempotent.

### Slice 2 - Pure evaluator

Files:

- `apps/web/lib/decision-perspective/default-profile.ts`
- `apps/web/lib/decision-perspective/material.ts`
- `apps/web/lib/decision-perspective/evaluator.ts`
- `apps/web/lib/decision-perspective/evaluator.test.ts`

#### Fallback chain resolution

`material.ts` exports `resolveProfileMaterial(profileId, domainClass, db)` which traverses the persisted fallback chain in order:
1. Active profile material for the domain
2. Fallback profile material (via `fallbackProfileId`) for the domain
3. DPF organizational principles (hard-coded sentinel profile, always last)
4. Returns empty array + `coverageGap: true` if all three levels have no applicable material

The Build Studio gate uses the resolver before calling the evaluator, so runtime chain traversal stays outside the scoring function. The evaluator remains pure and may evaluate an already-supplied in-memory profile chain for tests and future non-DB callers, but it does not query or mutate persistence.

#### Material selection logic

"Applicable material" for a question is determined by exact match on `domainClass`. Free-text matching of question content against `summary` is explicitly out of scope for v1 — it adds nondeterminism and makes the evaluator untestable. Material that does not declare a `domainClass` matching the current question's `domainClass` is not included in the resolved set, even if it lives in the active profile.

The Build Studio plan-advancement gate uses `domainClass: "plan-readiness"` as its single v1 class. Adding new gate sites adds new domain classes; the constant union lives in `types.ts` and is exported alongside the `RiskTier` and `OutcomeType` unions.

#### Confidence formula (v1 rule-based)

`confidenceScore` is a float in `[0, 1]` computed as:

```
baseScore = mean(materialWeight(m) for m in resolvedMaterial)
  where materialWeight(m) =
    freshnessMultiplier(m.freshness)          // current=1.0, stale=0.5, superseded=0.2, contradicted=0.0
    × evidenceGradeWeight(m.evidenceGrade)   // A=1.0, B=0.75, C=0.4, D=0.0
    × m.confidenceWeight                     // operator-set [0,1], default 1.0

riskPenalty = riskTierPenalty(riskTier)      // low=0, medium=0.1, high=0.25, critical=0.5
overridePenalty = min(0.3, recentOverrideCount × 0.1)   // capped at 0.3

confidenceScore = max(0, baseScore - riskPenalty - overridePenalty)
```

Outcome thresholds (v1 defaults, operator-overridable per profile):

| Score | Risk tier | Outcome |
| --- | --- | --- |
| `< 0.4` | any | `defer` if coverageGap, else `escalate` |
| `0.4–0.69` | any | `escalate` |
| `0.7–0.89` | low | `recommend` |
| `0.7–0.89` | medium–critical | `escalate` |
| `≥ 0.9` | low | `arbitrate` |
| `≥ 0.9` | medium–critical | `recommend` |

Principle conflict rule (v1): when two or more active principles in the resolved material have opposing `direction` vectors on the same `domainClass`, the evaluator forces `escalate` regardless of the score. The decision record labels this as `principleConflict: true`. The weighted vector aggregation from §5.7 of the spec is a v2 enhancement after the ledger has real conflict data to calibrate against.

The result payload always includes: `confidenceScore`, `coverageGap`, `principleConflict`, `resolvedProfileChain`, `materialCount`, `freshnessDistribution`, and `outcomeType`. The operator UI derives its display from these fields — there are no opaque verdict strings.

Exit:

- Pure tests pass without database access.
- Confidence formula is deterministic: same inputs produce the same score.
- Principle conflict test case produces `escalate` regardless of score.
- `coverageGap: true` on empty material produces `defer`.

### Slice 3 - Build Studio gate service and persistence

Files:

- `apps/web/lib/decision-perspective/build-studio-gate.ts`
- `apps/web/lib/decision-perspective/persistence.ts`
- `apps/web/lib/decision-perspective/build-studio-gate.test.ts`

The gate service is the orchestrator: it builds the question/context, calls `resolveProfileMaterial`, invokes the pure evaluator, persists the result, and emits `[tool-trace]` lines. It catches evaluator exceptions and converts them into fail-closed `escalate` outcomes (per Reviewed Decisions).

#### Idempotency check

Before invoking the evaluator, the service queries for an existing `DecisionInteraction` matching `(featureBuildId, phaseFrom, phaseTo, profileVersionId)`. If one exists and it does not have a clearing `EscalationCapture`, the service emits `wwmd.idempotent.hit` and returns the existing row's outcome — no second evaluation, no second ledger write. This handles double-clicks and retry storms cleanly.

If the matched row does have an `EscalationCapture` that the operator wrote to clear it, the service treats the current invocation as a fresh evaluation and writes a new row.

Exit:

- Service reads Build Studio plan context, current profile version, applicable material, and deliberation evidence.
- Service writes one ledger interaction per gate invocation, respecting the idempotency key.
- Re-invocation with the same key returns the existing row and emits `wwmd.idempotent.hit`.
- Re-invocation after `EscalationCapture` clearing produces a new row.
- Evaluator exception is caught, logged as `wwmd.evaluator.failed`, and persisted as fail-closed `escalate`.
- Service returns a typed gate result that the action and API can share.

### Slice 4 - Advance path integration

Files:

- `apps/web/lib/actions/build.ts`
- `apps/web/app/api/agent/build/advance-phase/route.ts`
- relevant tests near existing Build Studio action/API coverage

The current `advanceBuildPhase` server action and `/api/agent/build/advance-phase` endpoint do not expose a `skipPhaseCheck` parameter. If a future automated verification path adds a deterministic-gate bypass, that path must return before WWMD is invoked because automated verification is not a real advancement decision.

Exit:

- Deterministic phase gate runs first; WWMD only runs if `checkPhaseGate` returns eligible.
- WWMD runs only for `plan -> build` in v1. No other phase transition calls the kernel.
- `escalate` and `defer` stop advancement and return a structured operator message that includes `outcomeType`, `confidenceScore`, `rationale`, and the `interactionId` the operator needs to complete escalation/deferral capture.
- `recommend` and `arbitrate` allow advancement and persist the ledger row before returning success.
- Future deterministic-gate bypass paths bypass WWMD entirely — no ledger record is written for automated verification runs.

### Slice 5 - Operator-visible UI

Files:

- `apps/web/components/build/build-studio-workflow-actions.ts`
- `apps/web/components/build/BuildStudioWorkflowActionCard.tsx`
- `apps/web/components/build/DecisionPerspectiveGatePanel.tsx` — new component, locally scoped
- `apps/web/lib/actions/build-read.ts`
- `apps/web/lib/explore/feature-build-data.ts`

`DecisionPerspectiveGatePanel` is responsible for rendering the gate result. It receives a `DecisionInteraction` row (or null) and renders nothing when null. It does not fetch its own data — the build hydration path provides it.

Exit criteria (binary pass/fail):

- Panel renders outcome type as a labelled badge (`Recommended`, `Arbitrated`, `Escalation required`, `Coverage gap — deferred`).
- Panel renders confidence tier as a human label (`High`, `Medium`, `Low`) derived from `confidenceScore` ranges, not the raw float.
- Panel renders at least one source label when `sources` is non-empty; renders "No sources" otherwise.
- Panel renders an action prompt and a capture button for `escalate` and `defer` outcomes.
- Panel renders nothing (null) when the gate has not yet been invoked for the current phase.
- No hardcoded color values — all visual states use DPF CSS variables.
- No component wider than `BuildStudioWorkflowActionCard` imports `DecisionPerspectiveGatePanel` directly; it is assembled inside the card.

### Slice 6 - Escalation and deferral capture

Files:

- server action or route for capturing the human answer/gap decision
- persistence tests
- UI affordance in the gate panel

Exit:

- Human answer captures criteria, rationale, objections resolved, and candidate-material intent.
- Deferral captures gap domain, gap reason, and suggested source types.
- Capture writes are linked to the original interaction.

### Slice 7 - Verification and evidence

Run:

- `pnpm --filter web exec vitest run lib/decision-perspective/evaluator.test.ts`
- `pnpm --filter web exec vitest run lib/decision-perspective/build-studio-gate.test.ts`
- `pnpm --filter web exec vitest run app/api/agent/build/advance-phase/route.test.ts lib/actions/build-governed.test.ts`
- `pnpm --filter web exec vitest run apps/web/components/build/build-studio-workflow-actions.test.ts`
- `pnpm --filter @dpf/db exec prisma validate`
- `pnpm --filter web typecheck`
- `pnpm --filter web exec next build`

UX verification (manual, against Docker-served app):

- Authenticate to the portal.
- Open `/build`.
- Select a build in `plan` phase with passing plan review.
- Trigger Start Implementation (the plan→build advancement).
- Confirm the `DecisionPerspectiveGatePanel` renders with an outcome badge, confidence label, and at least one source label.
- Confirm the `DecisionInteraction` row was written (query the decision ledger inspector or admin DB view).
- Trigger an escalation scenario (use a build with thin plan material to force a low-confidence result) and confirm the phase does not advance until `EscalationCapture` is written.
- Confirm `skipPhaseCheck` builds do not appear in the ledger.

## Observability

Every WWMD invocation emits structured `[tool-trace]` log lines matching the platform-wide convention. The trace key is the `interactionId`. Required events:

| Event | When | Fields |
| --- | --- | --- |
| `wwmd.gate.invoked` | Gate fires (before evaluation) | `interactionId`, `profileId`, `profileVersionId`, `domainClass`, `riskTier`, `featureBuildId`, `triggeredByUserId` |
| `wwmd.profile.resolved` | After fallback chain traversal | `interactionId`, `resolvedProfileChain` (array of profile ids hit), `materialCount`, `coverageGap` |
| `wwmd.evaluator.complete` | After scoring | `interactionId`, `confidenceScore`, `outcomeType`, `principleConflict`, `freshnessDistribution` |
| `wwmd.evaluator.failed` | On evaluator throw | `interactionId`, `errorClass`, `errorMessage` (no stack to logs unless DEBUG) |
| `wwmd.ledger.written` | After `DecisionInteraction` insert | `interactionId`, `outcomeType` |
| `wwmd.idempotent.hit` | When the composite key matches an existing row | `interactionId` (existing), `featureBuildId`, `phaseFrom`, `phaseTo` |

These traces are the diagnostic substrate. Without them, debugging stuck advancement flows requires query-by-query DB inspection — exactly the pattern the `[tool-trace]` convention was created to eliminate. The gate service is responsible for emitting; the evaluator emits nothing (purity).

Counters for telemetry (no new stack — fold into whatever counter surface the portal already uses):

- Invocations per `outcomeType`, per `domainClass`
- Average `confidenceScore` per `outcomeType`
- Override rate per `domainClass` (computed from `EscalationCapture` rows)
- Fail-closed rate (evaluator errors / total invocations)

## MCP Future Seam

V1 does not add MCP tools. The evaluator's public contract is designed so that a future `evaluate_wwmd` MCP tool can call it directly without changes to the evaluator or persistence layer:

```ts
// Future MCP tool shape — do not implement in v1, but the evaluator must accept this call shape
evaluateDecisionPerspective({
  profileId: string,
  question: string,
  options: string[],
  domainClass: string,
  riskTier: RiskTier,
  evidenceBundle?: EvidenceBundle,
  deliberationRunId?: string,
  taskRunId?: string,
}) => Promise<DecisionGateResult>
```

Any change to the evaluator's parameter shape must be backward-compatible with this future surface. The persistence layer accepts `taskRunId` as nullable from day one so MCP-triggered invocations (which may not have a `featureBuildId`) write complete ledger records.

## Marketing Article Unlock Map

The Substack and LinkedIn drafts at `docs/superpowers/plans/2026-05-17-wwmd-article-drafts.md` have five `[PENDING IMPLEMENTATION]` markers. Each maps to a specific slice:

| Article marker | Unlocked by | Slice |
| --- | --- | --- |
| Decision Ledger screenshot | `DecisionPerspectiveGatePanel` and ledger inspector rendered in the portal | Slice 5 |
| Gate-in-action example | Real `DecisionInteraction` row from a live plan→build gate | Slice 4 + Slice 7 UX |
| Confidence delta example | A real session where the gate escalated after overrides | Slice 6 (EscalationCapture written) + ledger showing `confidenceBefore`/`confidenceAfter` |
| Principle conflict example | A real `principleConflict: true` interaction row visible in the ledger | Slice 2 evaluator + Slice 4 integration |
| Defer outcome example | A real `DeferralCapture` row from a coverage-gap build | Slice 6 |

When Slice 7 UX verification passes, the first two markers are resolvable. All five require at least one real use session after Slice 6 ships.

## Refactoring Budget

Use at least one meaningful refactor as part of the implementation, not as cleanup theater:

- Extract a shared Build Studio phase-advancement context builder so API, server action, and UI can share the same evidence shape.
- Keep `checkPhaseGate` deterministic and small.
- Keep WWMD evaluator pure and DB-free.
- Keep persistence behind a thin repository module so future MCP and standalone Ask WWMD surfaces reuse the ledger contract.

## Risks and Controls

- Risk: WWMD becomes another hidden blocker. Control: every block writes a ledger record and returns operator-facing evidence.
- Risk: Mark-specific doctrine leaks into customer WWWD. Control: profile owner, scope, and fallback chain are explicit schema fields.
- Risk: confidence looks like model certainty. Control: call it profile confidence and derive v1 from material coverage, freshness, evidence grade, risk, and override history.
- Risk: deliberation and WWMD duplicate each other. Control: deliberation produces structured debate evidence; WWMD consumes it and decides whether to recommend, arbitrate, escalate, or defer.
- Risk: marketing outruns truth. Control: article remains deferred until v1 evidence exists.

## Later Backlog

- Perspective material ingestion/review workflow (promote wiki principles and past decisions into `PerspectiveMaterial` rows via a governed UI).
- Profile version history UI in the decision ledger inspector.
- Profile drift alerts from repeated human overrides (requires `EscalationCapture.domainClass` — already in schema).
- Principle contradiction vector model (§5.7 v2 — requires real conflict data from v1 ledger).
- `evaluate_wwmd` MCP tool using the seam defined in the MCP Future Seam section above.
- Standalone Ask WWMD advisory surface (must use the same governed profile, evidence rules, and confidence model as the gate — not a forked chatbot).
- Customer WWWD profile onboarding and profile-material capture (fallback chain already supports it; needs customer-scoped seed workflow and UI).
