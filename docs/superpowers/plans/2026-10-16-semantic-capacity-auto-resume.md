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

## Amendment 2026-10-26: PostgreSQL proof of capacity continuation

This amendment implements the test-only follow-up selected by WWMD
DI-F93FF6507327 (`extend-shared-integration-proof`) under the existing
BI-7CCCA696 / WC-82EAA947. AC-AUTO-1 through AC-AUTO-5 above remain verbatim
and unchanged. Genuine served capacity recovery and its final native receipt
remain UNRUN; a controlled test result cannot satisfy that native obligation.

### Source baseline and admission state

The governed source is `fix/semantic-capacity-auto-resume` at
`D:/DPF-worktrees/semantic-capacity-auto-resume`, commit
`3b875529fb150f3a545413af44d142c2e46174e3`, tree
`11ae817fa7e4fc6af5780e50aed7a28426d8c56c`. Its completed normal main
integration matches fixed source
`c17502c73e9ebdc35cfb3677f0a33b20da5cf192` exactly.

Design admission IRD-AD2694F90094 and exact two-path scope claim sequence 70
govern this amendment under the existing executor. The inspected capacity,
queue, request and evidence mechanisms remain unchanged from the design
assessment. Fresh coverage for the published amended-plan blob and subsequent
implementation admission remain required before test edits.

### Atomic edit scope and refactoring

Only these two paths are proposed:

- `apps/web/lib/change-review/semantic-review-capacity-recovery.postgres.test.ts`
  (new test).
- `docs/superpowers/plans/2026-10-16-semantic-capacity-auto-resume.md`
  (this existing plan).

One atomic proof joins immutable request persistence, capacity recovery CAS,
existing queue delivery and terminal receipt persistence. These are internal
steps of one deliverable, not separately accepted outcomes. Reserve about 20%
of effort for suite-local lifecycle/assertion consolidation and reuse of the
existing SQL and jobs helpers. No production helper, new runtime API, schema,
queue, scheduler, provider, grant or budget change is planned. Any required
additional edit path needs explicit scope reconciliation first.

### Existing flow and fixture boundary

Retain the broad mocked policy matrix in
`semantic-review-capacity-recovery.worker.test.ts`. The missing proof joins
its real database and queue boundaries:

1. Persist the original task and immutable request using
   `createPrismaSemanticReviewSingleFlightStore`.
2. Use actual `enqueueSemanticReview`, `reconcileSemanticReviews`,
   `reserveSubmittedTaskRunWorking`, branch checkpoints and
   `executePersistedSemanticReview`. Preserve the actual routed dispatcher
   and response parser, final ExternalEvidenceRecord writer and Workroom
   activity writer.
3. Bind the test jobs facade through actual
   `createRoutingJobsClient({ engine: "postgres", functions: null }, ...)`
   and `insertEvents(fixture.pool, events)`. Inngest must fail on call;
   a partial function allowlist would dual-send and is unsuitable here.
4. Register the existing execution/reconciliation module and give the existing
   PostgreSQL worker only those two exact functions. Use existing cron
   primitives and `drain()` for bounded deterministic pumping, without
   starting a daemon. Make only isolated fixture schedule/wait timing due;
   do not renew the original immutable request or deadline.

Use unchanged `createReviewPostgresFixture` with an explicit governed
`DPF_SQL_TEST_DATABASE_URL` or `DPF_LOCAL_CI_TEST_DATABASE_URL`, unique
review-prefixed UUID schema and no public-table fallback. Required existing
table copies are TaskRun, TaskArtifact, TaskNode, WorkCapsule,
ExternalEvidenceRecord, WorkCapsuleActivity, JobEvent, JobRun, JobStep, JobWait,
JobConcurrencySlot and JobCronState. Correctly distinguish internal task row
IDs from public TaskRun IDs.

The shared helper clones definitions, indexes, enums and checks, not foreign
keys or triggers. Do not claim full deployed database invariants or Workroom
sequence-trigger verification. Do not copy/import the destructive setup from
`jobs/postgres/engine.pg.test.ts`, use the installed `DATABASE_URL`, or
import `semantic-review-background.test-fixtures.ts` and thereby mock away
the mechanism under test.

Provider responses, authority/evidence observations, craft lookup, host
telemetry, quiescence, unrelated task/reviewer dispatch and external publication
remain explicit controlled ports. Use the actual capacity policy with a
fixture lease reader and its actual typed deferral error. No real host lease
is acquired or released by a case. Fail on unexpected provider, portal,
GitHub or external queue calls. A terminal receipt is genuinely persisted by
the real transaction but its semantic result is fixture data, not an
independent native review or full request/permission admission.

Register cleanup before asynchronous setup. Bound every setup/barrier/drain;
`drain()` has no built-in deadline. Release barriers, drain/stop all work and
await in-flight operations before truncation or schema teardown. A failed
drain fails verification and prevents teardown while work remains. Obtain
the existing governed SQL/cleanup authorization for this exact fixture.
Missing prerequisites or skipped SQL cases remain UNRUN.

### Three compositional verification cases

- **VC-CAPACITY-PG-CONTINUATION:** Start through the actual event/handler path
  with one passing sibling and one direct typed pre-dispatch capacity refusal.
  Require the worker to persist the complete proof and honest inconclusive
  evidence; do not seed an asserted successful outcome. Restore only fixture
  capacity, drive existing scheduled reconciliation/queue execution and use
  concurrent reconciler calls against real CAS. Assert one recovery
  generation/event, the same original TaskRun, unchanged request
  bytes/digest/deadline, retained consumed attempts, and no repeat of the
  passing sibling. Read back the real final task/checkpoint/EER/activity rows,
  preserve the original inconclusive record, and prove duplicate delivery
  adds no second final effect. Drain completion alone is not a result.
- **VC-CAPACITY-PG-BACKOFF:** Reconcile a worker-produced proven wait while
  fixture capacity remains unavailable. Assert persisted bounded backoff and
  exact reason, unchanged deadline and consumed attempts, no new execution
  event or completion call, and no terminal PASS. A check before the next due
  time must not consume another observation or dispatch.
- **VC-CAPACITY-PG-CANCEL-CAS:** Pause an existing observation port after the
  candidate read but before recovery CAS; commit cancellation in the isolated
  database, then release the barrier. Assert no resurrection, new generation,
  execution event or final PASS, with historical evidence retained. Do not
  refresh the row/retry admission to defeat the losing CAS.

Existing mocked tests remain responsible for the broader wrapped/unknown,
paid/failing/legacy, changed source/evidence, revoked authority, quiescence,
expiry and exhausted-budget matrix.

### Ordered verification and publication

1. Read back the completed branch/head/tree and matching Workroom binding
   before publishing the amended plan; preserve the exact two-path scope.
2. Publish the amended plan through the existing DCO plan-only procedure.
   Record/check atomic coverage for the actual two-path scope using the
   provider-verified immutable amended-plan blob. Consume every current
   change-impact test and guard obligation and obtain implementation
   admission before test edits. No coverage receipt is claimed here.
3. Add the three cases. Record observed red/green or already-passing behavior
   honestly; do not fabricate a failure for a coverage-only change. If real
   tests expose a production defect or require broader invariants/paths, retain
   the failure and amend the admitted repair scope before expanding.
4. With a governed SQL environment and cleanup authorization, run the focused
   suite and applicable impact tests, both web TypeScript programs, docs and
   source guards. Complete this slice's exact-source canonical gate in the
   normal coordinated resource window; another slice's evidence cannot
   transfer here.
5. Obtain applicable independent review and deliver one signed ready PR
   through protected CI/merge queue. Report controlled SQL verification,
   source delivery and genuine served acceptance separately. Retain all
   historical UNKNOWN, INCONCLUSIVE, failed and unrun evidence.

Planned focused commands, to run from the adopted checkout after admission:

```text
node scripts/host-resource-runner.mjs --class vitest -- pnpm --filter web exec vitest run lib/change-review/semantic-review-capacity-recovery.postgres.test.ts lib/change-review/semantic-review-capacity-recovery.worker.test.ts lib/change-review/semantic-review-capacity-recovery.test.ts lib/change-review/semantic-review-background.test.ts lib/queue/functions/mcp-task-run-execute.test.ts lib/queue/mcp-task-run-events.test.ts lib/change-review/semantic-review-request-store.test.ts
node scripts/host-resource-runner.mjs --class typescript -- pnpm --filter web typecheck:all
node scripts/gen-doc-index.mjs --check
```

Add actual impact-contract obligations. Record only observed counts, skips and
evidence IDs. No command above has been run as part of preparing this amendment.

### Coverage, boundaries and rollback

Atomic mapping: `semantic-capacity-continuation` to BI-7CCCA696.
Requirement references: AC-AUTO-1, AC-AUTO-2, AC-AUTO-3, AC-AUTO-4, AC-AUTO-5.
Contract references: CT-CAPACITY-PROOF, CT-CHECKPOINT-SET, CT-BOUNDED-RESUME,
CT-OBSERVED-RECOVERY.
Flow references: FLOW-SETTLE, FLOW-ELIGIBILITY, FLOW-RECONCILE, FLOW-READBACK.
Verification references: VC-TYPED-DEFERRAL, VC-NO-REPLAY,
VC-SINGLE-GENERATION, VC-TRUTHFUL-STATE, VC-CAPACITY-PG-CONTINUATION,
VC-CAPACITY-PG-BACKOFF, VC-CAPACITY-PG-CANCEL-CAS.

Fresh amended-plan coverage and implementation admission remain PENDING.
The genuine served capacity recovery obligation remains UNRUN. Writer
acceptance BI-F646BC4E, identity repair BI-CAP-437F7745, role/room configuration
BI-56E9CEC2 and expired-successor work BI-8ECEC429 remain separate.

Principal risks are mocked-away joins, unintended external calls, duplicate
work, budget renewal, teardown racing an executor, and overstated proof.
Contain them through real row readback, exact identity/counter assertions,
fail-on-call ports, bounded cleanup and explicit evidence labels. Roll back
through a signed revert of this test/plan change; no runtime deployment is
required for a test-only change. Never erase native history to close the slice.
