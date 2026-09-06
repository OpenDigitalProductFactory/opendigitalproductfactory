---
status: draft
---

# Build-resume review-incomplete backoff

Backlog: BI-96885B6B. Workroom: WC-F8400101.

This fix is the narrow recovery boundary for a Build Studio design review that did not produce a verdict because no provider completed the review. It does not change the design-review rubric, provider routing, model selection, build ownership, quiescence policy, or the seven-day stranded-build age-out.

## Problem and live evidence

**OBJ-BRB-1:** A provider/infrastructure failure that leaves `designReview.reviewIncomplete=true` must remain recoverable without being treated as a defect in the design.

**OBJ-BRB-2:** Repeated automatic recovery of the same review-incomplete build must consume a bounded, progressively delayed amount of inference instead of resetting global quiescence on every resume sweep.

**OBJ-BRB-3:** The backoff must not suppress a genuine design verdict or permanently strand the build: a due retry still uses the canonical review/fix path, a real failed review still enters repair, and a completed outcome ends the incomplete streak.

The live occurrence is `FB-FCAC756D`, the Build Studio build for `BI-43D6B9DC`. The build remained in `ideate` while the periodic boot reconciler repeatedly re-entered `dispatchDesignReviewFixLoop`. On 2026-09-05 the activity trail recorded overlapping `attempt 1/2`, `attempt 2/2`, and terminal `No reviewer could complete a design review` entries. Fresh terminal entries at `09:59:27Z` and `10:00:51Z` followed retry entries at `09:54:38Z` and `09:55:01Z`. The work did not advance, but every cycle spent provider calls and reset the global activity clock that self-upgrade correctly treats as in-flight work.

The failure is a scheduling loop, not a reason to weaken quiescence. `dispatchDesignReviewFixLoop` already preserves the design and writes a durable terminal activity row when the review is incomplete. `resumePreBuildPhase` ignored that outcome and re-entered the same loop whenever the stale-build sweep ran.

## Acceptance manifest

| Acceptance | Objectives | Required outcome |
| --- | --- | --- |
| AC-BRB-1 | OBJ-BRB-1 | A persisted `reviewIncomplete=true` result is classified as provider/infrastructure non-completion; the existing design is not regenerated or rejected. |
| AC-BRB-2 | OBJ-BRB-2 | Consecutive terminal incomplete outcomes produce delays of 30 minutes, 1 hour, 2 hours, 4 hours, then a 6-hour cap. |
| AC-BRB-3 | OBJ-BRB-2 | While the window is closed, resume returns a typed `skipped` outcome with the streak and next retry time and dispatches no reviewer or fix loop. |
| AC-BRB-4 | OBJ-BRB-2, OBJ-BRB-3 | The streak is derived from bounded, newest-first `design_fix_loop` activity; retry-progress lines do not count as outcomes and any real outcome breaks the streak. |
| AC-BRB-5 | OBJ-BRB-3 | When the window has elapsed, the existing canonical `dispatchDesignReviewFixLoop` path runs unchanged. |
| AC-BRB-6 | OBJ-BRB-3 | A real `decision=fail` without `reviewIncomplete=true` is never backed off and continues through design repair. |
| AC-BRB-7 | OBJ-BRB-1, OBJ-BRB-3 | No schema, tool, authority, provider-routing, quiescence, or age-out contract changes; failures reading history remain fail-closed through the existing `resumePreBuildPhase` error result. |

## Design

Add one pure backoff decision and one pure activity-streak reducer inside the existing `resume-pre-build-phase` module.

The reducer consumes at most 60 `BuildActivity` rows already scoped to the build and `tool="design_fix_loop"`, ordered newest first. A terminal summary beginning `No reviewer could complete a design review` counts as one incomplete outcome. Intermediate `Design review could not be completed — re-reviewing` rows belong to an attempt and are ignored for counting. The first other fix-loop outcome—pass, regeneration, escalation, error, or another terminal classification—ends the consecutive streak. Pages or records from different builds are never combined.

The pure scheduler computes `min(6h, 30m * 2^(streak-1))` from the newest terminal incomplete row. Before `nextAt`, the resumer returns `skipped` and performs no expensive call. At or after `nextAt`, it invokes the existing fix loop; no second dispatcher, queue, or retry state machine is introduced. The durable activity ledger is the retry history, so no schema migration or mutable counter can drift from what actually ran.

This check is gated by both `designReview.decision === "fail"` and `designReview.reviewIncomplete === true`. A genuine negative review therefore bypasses backoff and retains the current repair semantics. Any subsequent non-incomplete fix-loop outcome terminates the streak naturally. The existing seven-day age-out remains the terminal safety ceiling.

## Existing substrate and alternatives

DPF already uses bounded retry budgets in the build pipeline, capped provider backoff in the provider-capacity design, and a seven-day age-out for genuinely stranded pre-build work. This fix composes those patterns at the smallest existing decision boundary.

- A fixed 30-minute retry was rejected because a multi-hour outage still spends and blocks on every tick.
- Immediate abandonment was rejected because provider non-completion says nothing about the design and would discard genuine work.
- A new database counter was rejected because `BuildActivity` is already the durable audit of completed attempts.
- Changing self-upgrade quiescence was rejected because the activity is real; the producer must stop creating useless activity.

## Risks, verification, and rollback

The primary risk is delaying recovery after a provider returns. The six-hour cap guarantees continued probes, and operator-driven work remains outside this periodic resumer. The primary false-positive risk is mistaking another activity line for a terminal incomplete outcome; exact prefix classification plus streak reset on every other outcome bounds that risk.

Verification requires the live-shaped interleaved activity fixture, pure schedule/cap cases, the skip/no-dispatch path, due re-entry, and a real-failure non-regression. Run the full colocated pre-build resume suite and linked ideate/review-fix suites plus web typecheck and source guards before any PR. Runtime acceptance, after a protected deployment, is that a terminal incomplete occurrence produces no new automatic provider work inside its computed backoff window while an explicitly due occurrence still resumes.

Rollback is one revert of the two implementation files and this design/plan pair. It restores the previous eager retry cadence without deleting build, review, or activity evidence.
