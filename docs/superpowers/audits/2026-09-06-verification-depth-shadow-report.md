---
status: active
title: Verification-depth shadow report — what the depth binding would have decided
---

# Verification-Depth Shadow Report

- **Date:** 2026-09-06
- **Phase:** 2 of [`2026-08-28-verification-first-workroom-gates.md`](../plans/2026-08-28-verification-first-workroom-gates.md), step 2.3 (the report) and step 2.4 (the written decision per affected cell).
- **Design:** [`2026-08-28-verification-first-workroom-gates-design.md`](../specs/2026-08-28-verification-first-workroom-gates-design.md) §4.1.
- **Backlog:** BI-30165EB4 (Phase 2), BI-4FF872FB (the defect this report found).
- **Source of truth:** the canonical runtime's `BuildActivity` ledger, `tool = 'verification-depth-shadow'`. Live query, not seed data.

---

## 1. The report

Every shadow decision recorded since the seam landed (PR #4880, 2026-09-02) through 2026-09-06.

**Total shadow decisions: 3. Distinct builds: 1. Distinct cells: 1.**

Grouped by kind, processSize and declared depth, as the plan requires:

| kind | processSize | declared depth | transition | decisions | would block | would *newly* block |
| --- | --- | --- | --- | --- | --- | --- |
| `feature` | `medium` | `deep` | `ideate->plan` | 3 | 3 | 3 |

Every other cell is empty. No `shallow` decision was recorded. No decision was recorded at `plan->build`, `build->review` or `review->ship`.

The single reason string, identical across all three:

> `deep verification requires a passing typecheck.`

All three carry `actualAllowed: true` — the live gate allowed the transition, as Phase 2 requires. **Zero verdicts changed.**

## 2. Reading the numbers honestly

The plan's §10 offers two falsification branches. This report matches **neither cleanly**, and saying which it is matters more than filing it under one.

**It is not the "empty report" case.** §10 says an empty report means the depth derivation is not reaching real transitions, and the fix is upstream in `derive.ts`. The derivation *is* reaching real transitions. Depth resolved to `deep` on a live build through the stakes path — `deriveStakesBias` maps `deliverableSensitivity: "high"` to `deep`, and the ideate->plan gate evidence carries that sensitivity (`build-design-review-handler.ts:598`). The plumbing works end to end: posture resolved, requirement evaluated, decision recorded. No upstream fix is indicated.

**It is not the "enormous report" case either** — but not because depth is rarely declared. The ledger is small because **the Build Studio phase pipeline is nearly dormant**, not because the binding is narrow:

| Build phase | Builds |
| --- | --- |
| `abandoned` | 43 |
| `ship` | 2 |
| `failed` | 1 |
| `build` | 1 |
| `complete` | 1 |

48 builds total, 43 abandoned. Over the same four days the ledger covers, `BuildActivity` recorded 2,041 `ideate_dispatch` and 1,743 `design_fix_loop` rows against just 3 phase-gate evaluations. Work is churning inside the ideate phase and almost never crossing a phase boundary.

**So the sample is too small to calibrate the declaration, and that is itself the finding.** Three decisions from one build is not a blast radius measurement. The honest verdict on step 2.4's question — "is the block correct or is the declaration wrong?" — is answerable for the one observed cell, and unanswerable for the rest of the matrix because the matrix was never exercised.

## 3. The decision on the one affected cell

**The block is wrong, and the declaration is not wrong either. The requirement is being evaluated at a transition where its evidence cannot exist.**

`checkVerificationDepthSatisfied` demands `verificationOut.typecheckPassed` and `testsFailed === 0` at *any* transition. But `verificationOut` is produced during the build phase. At `ideate->plan` — the transition all three records describe — no build has run, so `verificationOut` is structurally absent, and a `deep` declaration blocks on evidence that could not have been produced yet.

The two halves that combine into this are each defensible alone:

- the design's depth table (§4.1) reads as if the requirement is evaluated once, at ship time;
- `evaluateVerificationDepthShadow` calls `checkRequirement` directly rather than through a policy cell's requirement list, so it runs on every transition.

Together they manufacture a false positive.

**This is why the report was worth running.** The moment Phase 3 adds this requirement to a policy cell, every high-sensitivity build deadlocks at its *first* transition, before it can ever produce the typecheck the gate is asking for. A shadow report that had simply been counted rather than read would have shown "3 blocks, small blast radius, safe to bind" — and binding it would have broken the deep path completely.

Filed as **BI-4FF872FB** with two candidate fixes (scope the requirement to transitions at or after `build->review`, or make the check phase-aware). Which one is an operator decision, not an agent default.

## 4. What this means for Phase 3

**Phase 3 is not ready to start.** Two preconditions, neither of which is a code change to the gate:

1. **BI-4FF872FB must land first.** Binding a check that false-positives on its most common transition is precisely the "gate people route around" failure the design's §4.2 ordering constraint exists to prevent.
2. **The report needs a real sample.** Three decisions from one build cannot calibrate anything. Either the build pipeline needs to move work across phase boundaries again, or the shadow window needs to run long enough to observe `shallow` declarations and the later transitions. The 43-abandoned-of-48 build population is a separate health problem that this report surfaces but does not own.

## 5. Method

- Ledger read directly from the canonical runtime Postgres (`dpf-postgres-1`, database `dpf`), table `BuildActivity`, `tool = 'verification-depth-shadow'`. Read-only.
- Phase distribution from `FeatureBuild`; room posture inputs from `WorkCapsule` (the `Workroom` Prisma model maps to that table).
- Code substrate verified at `433d90325`: `build-process-matrix.ts`, `verification-depth-requirement.ts`, `verification-depth-shadow.ts`, `work-posture/verification-depth-gate.ts`, `work-posture/derive.ts`, `work-posture/resolve.ts`.
- Acceptance re-run at the same SHA: 156 tests across 9 files, all passing, including the byte-identical back-compat invariant.
