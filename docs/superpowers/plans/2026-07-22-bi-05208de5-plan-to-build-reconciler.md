# BI-05208DE5 — Plan→Build transition reconciler (stop the perpetual plan-phase resume flood)

**Backlog item:** BI-05208DE5 — "Build Studio builds strand in plan with a complete plan + cached WWMD 'advance' decision that never executes the plan→build transition"
**Type:** bug / build · **Date:** 2026-07-22
**Related:** BI-573A8EB3 (routed-phase ReferenceError that preceded + masked this), BI-9257CF19 (auto-resume), BI-A009313E (7-day stranded age-out), BI-8C44DB49 (deliberation flood / fail-fast — owns target #2, the orchestrator stall; **not built here**), BI-98B723C0 (per-build worktree isolation / `startBuildBranch`).

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

---

## 1. Root cause (evidence-grounded, live DB + sandbox verified)

The BI framed this as "a cached/idempotent WWMD 'advance' decision that never executes the transition." Live investigation refined it:

1. **The WWMD decision is NOT the blocker.** The cached `DecisionInteraction` rows for the stuck builds (`DI-5E60C0B9F97B` etc.) are `outcomeType = "recommend"`, `confidenceAfter = 0.9`, `gateKey = "build-studio"`, `phaseFrom=plan phaseTo=build`. The idempotent-hit branch (`apps/web/lib/decision-perspective/evaluator.ts:582`) therefore returns `allowed = true`. The transition **is** authorized. (`phaseTo:build` in the trace is the *transition being gated*, not the verdict — the verdict is `recommend`.)

2. **The transition is coupled to `startBuildBranch`, which failed.** In `reviewBuildPlan` (`apps/web/lib/mcp-tools.ts:1795–1910`) the plan→build advance runs: `checkPhaseGate` → `deriveFeatureBuildDependencyGate` → `evaluateBuildStudioPlanAdvancementGate` (WWMD, idempotent recommend → allowed) → **`isSandboxAvailable()` + `startBuildBranch(buildId)`** → only then flip `phase="build"`. The branch-init is deliberately done *before* the flip (so `buildBranch` is set before `phase=build`, preventing `deploy_feature` from running on leftover HEAD). `startBuildBranch` threw for these builds:
   `phase:gate-blocked — startBuildBranch failed: Command failed: docker exec 'dpf-sandbox-1' sh -c '…'` (the stored summary truncates at 200 chars, before the failing git subcommand). Earlier cycles show the precursor `Auto-advance to build blocked: sandbox not running` — i.e. the sandbox was down/churning during the self-upgrade wedge. **Live re-check (2026-07-22): the sandbox git tree is healthy, `git fetch origin main` succeeds, and the stuck builds' `build/FB-*` branches + worktrees do not exist — so the original failure was transient.**

3. **A failed transition loops forever with no escalation.** The `catch (branchErr)` at `mcp-tools.ts:1899` logs `phase:gate-blocked` and returns; the build stays in `plan`. The 30-minute auto-resume (`resumeStrandedBuildsOnBoot` → `resumePreBuildPhase`, phase `plan`) then re-runs the **entire expensive plan review** (two reviewer model calls + `runBuildReviewDeliberation`) and re-attempts the same transition — every 30 minutes, indefinitely. There is **no failure counter, no backoff, no escalation**.

4. **Epic children never self-clear.** `isStrandedPreBuildAbandonable` (`resume-pre-build-phase.ts:96`) returns `false` when `parentEpicId` is set, so the 7-day age-out (BI-A009313E) never fires for the 8 stuck builds (all epic-decomposed children). The flood is therefore **perpetual**, and it wedged routine self-upgrade (the `activity-in-flight` skip kept seeing live deliberation TaskRuns).

**Net root cause:** the routine plan→build transition is a fragile, un-bounded retry — coupled to a multi-step sandbox git op, re-minting an expensive (and separately-stalling) plan-review deliberation on every attempt, with no cap and no age-out for epic children.

**Out of scope (owned by BI-8C44DB49):** *why* the plan-review deliberation TaskRuns bootstrap, heartbeat once, then stall (`apps/web/lib/deliberation/orchestrator.ts` branch dispatch). This plan **starves** that stall by not minting the deliberation when the plan is already complete + reviewed + recommended; it does not fix the orchestrator itself.

## 2. Fix shape

A **reconciler**: on resume of a plan-phase build that already has a complete plan **and** a cached advance-readiness decision, perform the transition **directly** — no fresh plan-review deliberation — and cap+escalate repeated transition failures so an age-out-exempt epic child stops flooding.

Single source of truth: extract the transition side-effect from `reviewBuildPlan` into one shared executor used by both `reviewBuildPlan` and the reconciler.

## 3. Substrate the plan touches (verified via code graph / reads)

- `apps/web/lib/mcp-tools.ts:1795–1912` — `reviewBuildPlan` advance block (source of the extract).
- `apps/web/lib/integrate/resume-pre-build-phase.ts:409–475` — `resumePreBuildPhase` phase `plan` (reconciler wiring).
- `apps/web/lib/decision-perspective/persistence.ts:159` — `findExistingDecisionInteraction` (cached-decision lookup).
- `apps/web/lib/decision-perspective/build-studio-gate.ts` — `evaluateBuildStudioPlanAdvancementGate`.
- `apps/web/lib/integrate/sandbox/build-branch.ts` — `startBuildBranch`, `isSandboxAvailable`.
- `apps/web/lib/feature-build-types` — `checkPhaseGate`, `canTransitionPhase`, `normalizeHappyPathState`.
- `apps/web/lib/build/feature-build-dependencies` — `deriveFeatureBuildDependencyGate`, `FEATURE_BUILD_DEPENDENCY_GATE_SELECT`.
- `apps/web/lib/integrate/build-on-plan-approval.ts` — `dispatchBuildForApprovedPlan`.
- `FeatureBuild.buildExecState` (Json, additive — **no migration**) — stores the advance-attempt tracker.

## 4. Phases

### Phase 1 — Extract `performPlanToBuildTransition` (single source of truth)  *(ships independently)*
**Deliverable:** new `apps/web/lib/integrate/plan-to-build-transition.ts`:
- `performPlanToBuildTransition({ buildId, userId, context? }): Promise<PlanAdvanceOutcome>` — loads the build, guards `phase==="plan"` + `canTransitionPhase`, runs `checkPhaseGate` → dependency gate → WWMD gate (fail-**open** on evaluator error, as today), then `isSandboxAvailable` + `startBuildBranch` + phase-run bookkeeping + flip to `build` + `dispatchBuildForApprovedPlan`. Returns a typed outcome: `advanced | gate-blocked | wwmd-withheld | transition-failed | escalated | not-ready`.
- On `startBuildBranch` throw or sandbox-down: record an attempt on `buildExecState.planAdvance` (`{ failures, lastError, lastAt, escalatedAt? }`) and return `transition-failed` (or `escalated` once `failures >= threshold`).
- **Pure, DB-free helpers** (the unit-test core): `recordPlanAdvanceAttempt(prev, error, now)` and `shouldEscalatePlanAdvance({ failures, threshold })`. Threshold default `3`, env-override `BUILD_PLAN_ADVANCE_ESCALATE_AFTER`.
- Refactor `reviewBuildPlan`'s advance block to call `performPlanToBuildTransition` after a passing/advisory review — deleting the duplicated inline transition logic.

**Verification (functional):** `vitest` on the new pure helpers; a test proving `performPlanToBuildTransition` flips `phase→build` on success (mocked `startBuildBranch`) and records/escalates on repeated failure without flipping; existing `mcp-tools` review-advance tests stay green (behavior-preserving extraction).

### Phase 2 — Reconciler on resume (skip the stalling re-review)  *(depends on Phase 1)*
**Deliverable:** in `resume-pre-build-phase.ts` phase `plan`, after the child-intake heal and before the `executeTool("reviewBuildPlan")` fallback:
- If `hasPlanTasks(buildPlan)` **and** a cached WWMD plan→build advance decision exists (`recommend`/`arbitrate`, via `findExistingDecisionInteraction`) **and** the plan review is not a hard `fail` → call `performPlanToBuildTransition` **directly** and return its outcome. No `reviewBuildPlan`, no fresh deliberation.
- Once the outcome is `escalated`, the resume returns `{ kind: "skipped", reason: "plan-advance escalated to operator after N failed transitions" }` so the caller stops re-attempting — **this is what stops the epic-child flood** that the age-out cannot.
- All other states (no plan / review failed / no cached decision) keep today's behavior exactly.
- Helper `hasCachedPlanAdvanceDecision(buildId)`.

**Verification (functional):** `vitest` regression test reproducing the BI's stranded state — build `phase="plan"`, `buildPlan` with tasks, `designDoc` present, `planReview="pass"`, and a cached `recommend` `DecisionInteraction` — asserts the resume performs the transition (`performPlanToBuildTransition` invoked / phase flips) and does **not** invoke `reviewBuildPlan`; a second test asserts that after `threshold` transition failures the resume returns `skipped` (escalated) rather than looping.

### Phase 3 — Durable knowledge + evidence
**Deliverable:** this plan (process-spine artifact); PR body carries `Process-Spine-Decision:` / `Docs-Impact-Decision:` (internal build-pipeline fix, no documented user route changes) and the root-cause evidence. Update the incident memory note. No AGENTS.md change required (no new durable contract for contributors).

**Verification:** Spec/Plan/Doc gate satisfied by this plan file; UX-Fit gate N/A (no UI surface).

## 5. Risks & rollback

- **Hot-path risk (reviewBuildPlan advance).** Extraction must be behavior-identical on the happy path (sandbox up → advances exactly as before). Mitigation: the shared function mirrors the current block 1:1; existing review-advance tests are the safety net; run `mcp-tools.test.ts` + `resume-pre-build-phase.test.ts`.
- **Premature escalation.** Too low a threshold could park healthy builds. Mitigation: default `3` (~90 min of retries), env-overridable; escalation only on repeated *hard* transition failures, never first attempt; escalated builds stay in `plan`, fully re-promotable and manually advanceable.
- **Reconciler over-firing.** It only short-circuits when a cached `recommend`/`arbitrate` decision already exists — the precise BI state — so no behavior change for builds still needing a real review.
- **Rollback:** revert the PR. `buildExecState.planAdvance` is additive Json (no migration), so rollback is clean; the resume path returns to re-running `reviewBuildPlan`.

## 6. Definition of done

- Build gate (§5 AGENTS.md): unit tests (Phase 1 + 2), production build (via shared local-CI sandbox lease), **no migration**.
- Regression test reproduces the stranded-with-complete-plan state and asserts it advances (and bounded-escalates).
- After deploy via governed self-upgrade: re-promote the 8 builds whose `abandonReason` starts "Ops-abandoned to stop perpetual plan-phase resume flood" and confirm they advance out of `plan` — the BI's gating acceptance.

## Backlog coverage

- Decision: atomic
- Parent: BI-05208DE5
- Receipt: cmrvgaj4403w101p8dljox040
- Rationale: Phase 2 (the resume reconciler) has no value without Phase 1 (the shared performPlanToBuildTransition executor it calls); both ship in one PR as one behavioral fix, so no phase is independently shippable.
- Dependencies: none
