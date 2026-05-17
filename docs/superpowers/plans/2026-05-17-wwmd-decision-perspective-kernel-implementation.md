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
  - `materialId`, `profileId`, optional `profileVersionId`, `sourceType`, `sourceRef`, `scope`, `freshness`, `confidenceWeight`, `reviewStatus`, `promotionState`, validation timestamps, summary.
- `DecisionInteraction`
  - `interactionId`, `profileId`, `profileVersionId`, optional `fallbackProfileId`, optional `featureBuildId`, optional `taskRunId`, optional `deliberationRunId`, `routeContext`, `phaseFrom`, `phaseTo`, `question`, `options`, `evidenceBundle`, `sources`, `rationale`, `riskTier`, `confidenceBefore`, `confidenceAfter`, `outcomeType`, `outcomePayload`, `humanOutcome`, timestamps.
- `EscalationCapture`
  - `interactionId`, resolver principal/user, prompt, answer, criteria, rationale, objectionsResolved, candidateMaterial flag, timestamps.
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
2. Build Studio gate tests in `apps/web/lib/decision-perspective/build-studio-gate.test.ts`
   - Builds a plan-advancement question from `FeatureBuild` evidence.
   - Includes compact deliberation summary when present.
   - Persists a `DecisionInteraction` for every invocation.
   - Blocks phase advancement on `escalate` or `defer`.
   - Allows phase advancement on `recommend` or `arbitrate`, while preserving the ledger.
3. Action/API tests
   - `advanceBuildPhase` invokes WWMD only for `plan -> build` after deterministic phase prerequisites pass.
   - `/api/agent/build/advance-phase` returns a 422 with `decisionInteraction` when WWMD escalates or defers.
   - Existing UX override behavior remains limited to UX verification and cannot bypass WWMD.
4. UI tests
   - Build Studio action guidance can show a WWMD gate summary for plan advancement.
   - The workflow action card shows outcome, confidence, evidence labels, and escalation/deferral wording without hardcoded colors.
   - Decision ledger/inspector shows profile version, sources, confidence, outcome, and escalation/deferral status.

## Implementation Slices

### Slice 1 - Schema and generated client

Files:

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/<timestamp>_add_decision_perspective/migration.sql`
- `apps/web/lib/decision-perspective/types.ts`
- focused type/runtime guard tests

Exit:

- Prisma migration creates the six required models and indexes.
- `pnpm --filter @dpf/db exec prisma validate` passes.

### Slice 2 - Pure evaluator

Files:

- `apps/web/lib/decision-perspective/default-profile.ts`
- `apps/web/lib/decision-perspective/material.ts`
- `apps/web/lib/decision-perspective/evaluator.ts`
- `apps/web/lib/decision-perspective/evaluator.test.ts`

Exit:

- Pure tests pass without database access.
- Confidence math is deterministic and explainable in the result payload.

### Slice 3 - Build Studio gate service and persistence

Files:

- `apps/web/lib/decision-perspective/build-studio-gate.ts`
- `apps/web/lib/decision-perspective/persistence.ts`
- `apps/web/lib/decision-perspective/build-studio-gate.test.ts`

Exit:

- Service reads Build Studio plan context, current profile version, applicable material, and deliberation evidence.
- Service writes one ledger interaction per gate invocation.
- Service returns a typed gate result that the action and API can share.

### Slice 4 - Advance path integration

Files:

- `apps/web/lib/actions/build.ts`
- `apps/web/app/api/agent/build/advance-phase/route.ts`
- relevant tests near existing Build Studio action/API coverage

Exit:

- Deterministic phase gate still runs first.
- WWMD runs only for `plan -> build` in v1.
- `escalate` and `defer` stop advancement and surface a useful operator message.
- `recommend` and `arbitrate` allow advancement and persist the ledger.

### Slice 5 - Operator-visible UI

Files:

- `apps/web/components/build/build-studio-workflow-actions.ts`
- `apps/web/components/build/BuildStudioWorkflowActionCard.tsx`
- new `DecisionPerspectiveGatePanel` or similarly scoped component
- `apps/web/lib/actions/build-read.ts`
- `apps/web/lib/explore/feature-build-data.ts`

Exit:

- Build Studio shows the WWMD result near the plan-advancement control.
- Text is compact, evidence-first, and does not explain the feature to the user.
- Styling uses DPF CSS variables only and keeps cards at the local component boundary.

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

- `pnpm --filter web exec vitest run apps/web/lib/decision-perspective/evaluator.test.ts`
- `pnpm --filter web exec vitest run apps/web/lib/decision-perspective/build-studio-gate.test.ts`
- `pnpm --filter web exec vitest run apps/web/lib/actions/build-governed.test.ts`
- `pnpm --filter web exec vitest run apps/web/components/build/build-studio-workflow-actions.test.ts`
- `pnpm --filter @dpf/db exec prisma validate`
- `pnpm --filter web typecheck`
- `pnpm --filter web exec next build`

UX verification:

- Authenticate to the Docker-served app.
- Open `/build`.
- Select a build in `plan` phase with passing plan review.
- Trigger Start Implementation.
- Confirm the WWMD gate output appears and the result is persisted.
- Confirm escalation/deferral states do not advance the phase until captured.

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

- Perspective material ingestion/review workflow.
- Profile version history UI.
- Profile drift alerts from repeated human overrides.
- Principle contradiction vector display.
- Standalone Ask WWMD advisory surface.
- Customer WWWD profile onboarding and profile-material capture.
