---
status: active
backlogItem: BI-7CCCA696
workroom: WC-82EAA947
---

# Resume proven semantic-review capacity waits

For agentic workers: execute this plan as one independently reviewable backlog
item, one branch and one PR. Use the existing DPF test, verification and DCO
publication procedures. Source delivery and deployed acceptance are separate.

## Design grounding

Extend the recovery repair in
`docs/superpowers/specs/2026-07-27-shared-change-reviewer-control-design.md`.
The existing `semantic-review-background.ts` owns durable execution and
reconciliation, `semantic-review-request.ts` owns immutable request identity,
`semantic-review-recovery-policy.ts` owns budget/readback, and
`routing/local-provider-capacity.ts` owns the cheap capacity observation.
TaskRun and TaskNode remain the only execution/checkpoint records. No new
scheduler, queue, table, provider, identity or permission is proposed.

At base `86e552f4d8ebc6dae30e22438c35293b6bef023b`, the worker recognizes a
capacity exception by its name, records an inconclusive completed checkpoint,
then parks the task input-required. Reconciliation selects submitted, working
and stalled tasks, so capacity recovery cannot resume that parked request.
This is source evidence; the behavior regression must fail before the fix.

## Acceptance criteria from the live item

- AC-AUTO-1: A direct typed pre-dispatch capacity refusal followed by capacity recovery resumes through the existing reconciler without a client, retaining the immutable request, original deadline and consumed attempts.
- AC-AUTO-2: Completed passing sibling checkpoints are reused; all required branches must be durably settled before automatic recovery. Concurrent reconciliation admits one generation and preserves its final native receipt.
- AC-AUTO-3: Unknown, wrapped, paid-provider, actual failing or legacy unproven outcomes never auto-replay. Revoked authority, changed source or gate evidence, quiescence, expiry and exhausted counters remain blocked with an exact reason and canonical action.
- AC-AUTO-4: Capacity remaining unavailable uses bounded persisted backoff without inference or attempt consumption. Existing task and Workroom readbacks expose the wait and final result without a new ledger or scheduler.
- AC-AUTO-5: Meaningful worker/reconciler failure-injection regressions and applicable verification precede protected source delivery. Canonical deployed acceptance is recorded separately, and historical failures are retained.

## Ordered implementation and verification

One atomic outcome: recognizing a wait without safe continuation still strands
the task; continuation without proof may repeat paid work. The phases below
are internal sequencing, not separately accepted deliverables.

1. **CT-CAPACITY-PROOF / FLOW-SETTLE / VC-TYPED-DEFERRAL.** Resolve the
   Workroom's graph-linked test obligations and reproduce the parked-task
   behavior in the existing worker/reconciler mocks. A real
   LocalProviderCapacityDeferredError is required; a name, message, wrapped
   cause or model response is insufficient. Persist a versioned request-bound
   no-provider-started proof in the completed branch checkpoint. Unknown
   outcomes keep their stopped/uncertain evidence. Do not repeat inference
   to repair a checkpoint transaction.
2. **CT-CHECKPOINT-SET / FLOW-ELIGIBILITY / VC-NO-REPLAY.** Refactor the existing
   bounded checkpoint/budget checks into a small shared helper where useful.
   Require the complete expected branch set, valid request and current source,
   passing sibling verdicts, at least one proven capacity refusal, and no
   unfinished/failed/foreign/unsupported checkpoint. Old records lacking proof
   stay manual. Reserve at least20% of this repair for this consolidation and
   removal of duplicate eligibility/readback reasoning.
3. **CT-BOUNDED-RESUME / FLOW-RECONCILE / VC-SINGLE-GENERATION.** Extend the
   existing reconciler's bounded/fair query for exactly proven capacity waits.
   Observe capacity cheaply before admission. Persist bounded backoff while
   unavailable, without dispatch or budget consumption. Before admitting work,
   revalidate requester/grants, immutable packet, current Workroom source,
   resolved failure evidence, quiescence and original budget. CAS the observed
   task version; increment recovery attempts without resetting the deadline or
   consumed dispatch attempts. Existing outbox admission and generation fences
   remain authoritative. Reuse completed passing siblings, then persist the
   genuine final receipt through the existing completion path.
4. **CT-OBSERVED-RECOVERY / FLOW-READBACK / VC-TRUTHFUL-STATE.** Extend the
   existing task recovery observation for the proven automatic wait, its next
   observation and final result. Readback never authorizes recovery. Preserve
   existing explicit operator retry and expired-successor behavior. Exercise
   concurrent reconciliation, cancellation, changed evidence/source, revoked
   authority, quiescence, deadline, exhausted counters, fake/wrapped capacity,
   uncertain execution, actual fail and unavailable capacity. Verify denied
   cases make zero provider calls and never publish PASS.
5. Run affected worker, routing, recovery-policy, checkpoint and projection
   suites, applicable package typechecks and source guards. Independent review,
   DCO, protected CI and merge queue precede source delivery. Canonical
   deployment then verifies automatic continuation and its final receipt on
   the actual served containing build; no live paid failure injection or
   replay of historical uncertain tasks is authorized by this plan.

## Scope, dependencies and stop conditions

BI-DB4E6F81 owns endpoint eligibility recovery and currently claims the shared
worker, its test, recovery policy and canonical design. Coordinate its exact
release/handoff before editing; never force a claim. BI-CAP-21C511CA owns
Workroom review visibility. BI-8ECEC429 owns explicit expired successors.
Canonical identity repair BI-CAP-437F7745 and role/room configuration
BI-56E9CEC2 remain separate dependencies, with no scope absorbed here.

Initial design claim IRD-4E838A9D82AD allowed WC-82EAA947. A normal sequential
handoff now permits the worker/test, recovery policy, capacity helper/test and
canonical design paths. The existing owner still holds the policy test; do not
edit it. Resolve all graph-linked tests and run the style-drift obligation.
The error-name-lookalike regression failed against the current worker as
expected; baseline three suites passed110 tests. Automatic-resume reproduction
and implementation remain pending. Missing authority or failed planning coverage stops implementation;
infrastructure uncertainty remains unrun/inconclusive.

## Risks and rollback

Duplicate paid work, stale consent, incomplete siblings and budget renewal are
the principal risks. Require positive persisted proof and prefer manual recovery
when any input is unknown. Retain all historical requests, nodes and receipts.
Rollback through a signed revert; unsupported proof versions must remain
ineligible rather than re-open an old generation. Runtime advances use the
canonical deployment controls and their recovery point.

## Backlog coverage

Planned atomic mapping: `semantic-capacity-continuation` to BI-7CCCA696.
Requirement references: AC-AUTO-1, AC-AUTO-2, AC-AUTO-3, AC-AUTO-4, AC-AUTO-5.
Contract references: CT-CAPACITY-PROOF, CT-CHECKPOINT-SET, CT-BOUNDED-RESUME,
CT-OBSERVED-RECOVERY. Flow references: FLOW-SETTLE, FLOW-ELIGIBILITY,
FLOW-RECONCILE, FLOW-READBACK. Verification references: VC-TYPED-DEFERRAL,
VC-NO-REPLAY, VC-SINGLE-GENERATION, VC-TRUTHFUL-STATE.
Live coverage must bind the immutable pushed plan and actual declared scope
before implementation. Coverage pending; these words are not a receipt.
