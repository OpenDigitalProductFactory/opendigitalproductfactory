---
status: active
---

# Workroom effective progress -- ordered fix design

**Backlog:** BI-756C899D. **Workroom:** WC-36F36351.
**Profile / shape:** fix / delivery-medium@1.0.0.
**Baseline:** origin/main 3c26cf55bcdbbd9d5f8adf6a1c037069b6ab72d5.
**Related:** BI-4B48E7FE, BI-12A083B4. Broader COO supervision remains separately
owned by BI-C43FD3E5 and is not implemented or approved by this repair.

## Problem and authority boundary

WC-03D88204 retained a provider hold from October 19 while snapshots alternated
between provider_held and awaiting_agent_capacity. A provider-held snapshot kept
an agent_stage/in-motion conclusion. The drive calculated conclusion and hold
before learning the effective dispatch result, then changed only reason.
Only pause/escalate counted as stuck, so attempts and capacity waits erased
the clock. Existing source tests passed without covering this sequence.

Repair the existing drive projection, not the authorization or execution engine.
Keep lease-fenced writes, same-task reviewer recovery, stage receipt validity,
independent gates, explicit pauses and legitimate waits. No new table, provider,
permission, task owner or autonomous recovery action is added.

## Ordered implementation

1. Claim the exact source/test paths and consume their changeImpactContract.
   Add first-failing regressions for the live provider-held conclusion mismatch,
   repeated active waits across reason changes, real receipt advancement,
   graph held/partial dispatch and stale lease observation.
2. Consolidate final observation projection at the existing drive persistence
   boundary so sequential, graph and reviewer outcomes derive conclusion and
   hold from the final action/reason/committed marking, not an earlier plan.
   Resolve accountability only when the effective observation needs it.
3. Retain the stall clock through active capacity/provider/lease waits and
   dispatch attempts. Verified completing receipts or accepted stage/marking
   advancement reset the active no-progress spell. Quiet posture, future-cycle,
   inactive delivery and actual human-decision waits remain distinct.
   Legacy state has no fabricated last-progress timestamp; its first new
   observation starts a measured window and preserves known prior stalls.
4. Never overwrite the current holder's snapshot on a failed/stale scheduling
   fence. If a dispatch did not schedule, retain an explicit observation with
   an owned blockage rather than claiming dispatch. Graph state restores
   undispatched tokens exactly as today. Emit no stall notification from an
   uncommitted observation.
5. Reuse the same stalled predicate in the attention projection and database
   selection so capacity/provider-held stalls cannot remain invisible.
   Preserve the existing bounded scan and disclosure surface. User copy says
   what is waiting, not that every waiting tick was a refused execution.
6. Run affected source tests, web typecheck, required guards and exact-tree
   local integration; obtain independent semantic review, protected merge and
   canonical deployment. Verify the actual served snapshot and attention
   result. The broader no-founder-nudge COO pilot is not this slice's receipt.

## Acceptance

- AC-PROGRESS-01: Queue holds, lease contention, enqueue refusal and reviewer dispatch results are projected from their effective outcome, with matching conclusion and no-progress hold.
- AC-PROGRESS-02: Waiting and attempted dispatch do not erase no-progress age; confirmed evidence-bearing stage/marking advancement does. Legitimate quiet, future-cycle and inactive work remain distinct.
- AC-PROGRESS-03: Sequential and graph rooms retain equivalent semantics, and persisted legacy hold data is read safely without backdating unknown progress.
- AC-PROGRESS-04: Regression scenarios include the sampled October 19 provider-hold pattern; relevant tests, exact-tree typecheck and served-runtime verification are recorded.

## Design grounding and research

Extend the existing Coordinated Workrooms and Proactive Workrooms designs,
docs/architecture/workroom-cycle-continuity.md, drive-conclusion.ts,
workroom-drive-hold.ts, stage-evidence-receipts.ts and graph restoration.
BI-D95FD249 owns scheduled-author evidence authorization and BI-7CCCA696 owns
semantic-review pre-dispatch capacity recovery; neither is implemented here.

The parent research compared current official Kubernetes controller,
Temporal history, BMAD delivery-loop, Camunda job-worker and AWS Step Functions
retry/catch contracts on October 25. This defect adopts observed-result
reconciliation and separates enqueue acknowledgement from completed work.
It rejects another engine, blind uncertain-effect replay and activity-based
progress. No dependency is adopted. Primary references:
- https://kubernetes.io/docs/concepts/architecture/controller/
- https://docs.temporal.io/encyclopedia/event-history
- https://docs.bmad-method.org/
- https://docs.camunda.io/docs/components/concepts/job-workers/
- https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html

## Atomic coverage and verification references

This is one independently shippable repair. The projection, clock and attention
reader changes are inseparable parts of making one persisted observation true;
shipping a counter whose reader ignores it or a reason whose conclusion is stale
would preserve the reported defect. Internal phases are implementation ordering.

Requirement refs: AC-PROGRESS-01; AC-PROGRESS-02; AC-PROGRESS-03; AC-PROGRESS-04.
Contract refs: apps/web/lib/work-management/drive-conclusion.ts;
apps/web/lib/work-management/workroom-drive-hold.ts;
apps/web/lib/queue/functions/workroom-drive.ts;
apps/web/lib/queue/functions/workroom-drive-graph.ts;
apps/web/lib/attention/sources/workroom-stall.ts.
Flow refs: effective dispatch observation -> conclusion and no-progress clock -> fenced persistence -> bounded attention projection.
Verification refs: apps/web/lib/queue/functions/workroom-drive-conclusion.test.ts;
apps/web/lib/work-management/workroom-drive-hold.test.ts;
apps/web/lib/attention/sources/workroom-stall.test.ts;
canonical served-runtime provider-held snapshot verification.

## Compatibility, risks and rollback

Existing JSON and legacy holds remain readable. Unknown progress age stays
unknown; do not use scheduler-written updatedAt as a completion timestamp.
No migration or grant change. Bound attention reads retain their current limit.
Long legitimate execution/waits must not be classified as failed merely because
no receipt arrived yet; alerts describe no verified advancement, not failure.

Rollback through the canonical release path preserves all evidence and holds.
Do not clear provider holds or stale reviewer tasks to make tests pass.
At least 20 percent of implementation effort consolidates the duplicated
final-outcome projection. Current funding authority is separately governed.

## Backlog coverage

Atomic BI-756C899D. Immutable source publication and live
record_plan_backlog_coverage receipt are pending; this document is not that
receipt. Broader parent design review remains separately tracked.
