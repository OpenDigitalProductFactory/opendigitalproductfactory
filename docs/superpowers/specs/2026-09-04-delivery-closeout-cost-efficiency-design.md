---
status: draft
---

# Delivery closeout and cost efficiency

Date: 2026-09-04. Design owner: BI-154689E7. Epic: EP-WORKROOM-CLOSEOUT.
Workroom: WC-375F098A. Kernel recommendation: DI-619636A684B2.
Source inspected: f62c1edb4b (main after PRs #5050–#5053).
Status: source-grounded design; independent initiative review and implementation
coverage receipts remain required. This document is not evidence of deployment.

## Decision and scope

End an authoring execution when delivery and its durable acceptance handoff are
recorded. Run acceptance after deployment through the existing server orchestration.
Group compatible checks for the same served release so several PRs share one
verification execution. Preserve each outcome's individual acceptance requirements.
A failed check opens corrective work with a small evidence packet and a fresh
execution. It does not require resuming the original conversation.

This extends the [closeout design](2026-09-01-workroom-closeout-lifecycle-design.md),
[resilient process](2026-08-15-resilient-concurrent-development-process.md), and
[delivery throughput design](2026-09-03-local-first-agentic-delivery-throughput-design.md).
It preserves local capacity investment and shared runtime leases. It does not change
deployment authority, waive required acceptance, buy capacity, delete worktrees, or
introduce a scheduler, parallel backlog, or client-owned source of workflow state.

## Evidence and implementation reconciliation

The earlier September 4 live audit found 17 historical/reapable rooms among 27 late
stage rooms, and 45 among a capped sample of 50 working rooms. A janitor dry run
classified 25 of 72 decisions as clean merged Tier A. No worktrees were removed.
The capped 5,000-call MCP sample covered about six hours on August 28, despite a
seven-day request: 50.8% were lease claim/list/renew calls, 76.5% including quiescence
checks. These figures describe that sample, not seven-day averages. Local integration
telemetry reported 30% abandonment and 37-minute p95 wait; the queue was empty at
inspection. The platform cost ledger excludes external desktop subscription usage.

| Existing implementation | Finding and required change |
| --- | --- |
| `apps/web/lib/work-capsules/liveness.ts` | `hasOpenPr` tests URL/number presence. Add explicit observed PR state; unknown cannot count as open or as proof of abandonment. |
| `apps/web/lib/work-capsules/work-capsule-reaper.ts` | Delivered annotation depends on local branch-head ancestry and skips installed runtimes without Git. Squash merges replace the head SHA. Read verified provider merge observations from existing inventory/coordination records. |
| `apps/web/lib/work-capsules/work-capsule-reaper.ts` | Reconciliation has a fixed 500-row take and no cursor; archived delivery does not release authoring state through an explicit handoff. Use bounded cursor reconciliation and idempotent terminal transitions. |
| `apps/web/lib/work-capsules/delivery-task-hub.ts` | Recently merged Task Hub already has working/waiting/attention groups. Extend its projection; do not create another dashboard. |
| `apps/web/lib/build/git-promotion-intake.ts` | Push intake owns durable candidate identity. Candidate creation precedes event send; a failed send followed by duplicate intake returns without re-dispatch. Reconcile dispatch from durable state. |
| `apps/web/lib/queue/functions/git-promotion-sandbox-verification.ts` | Every queued default-branch candidate can run install/typecheck/full build in a serialized local sandbox. Reuse equivalent protected evidence or request the missing lane only. Supersede older queued builds without dropping their acceptance obligations. |
| `apps/web/lib/self-upgrade/notifications.ts` | `emitUpgradeEvent` is a no-op. `run-store.ts` separately publishes state on the agent event bus; that existing path must feed durable verification admission, rather than adding a second notification system. |
| `scripts/worktree-janitor.mjs` and existing session hooks | Cleanup has its own host safety checks. Room termination alone does not acknowledge thread archival or worktree removal. Record each actuator result separately. |

PR #5050 delivered adversarial recovery fixtures, #5051 the Task Hub, and #5053
durable one-shot inference. Their source availability does not establish served
version or live acceptance. Reuse these additions and their tests.

## Contracts and objectives

Each objective below is the scope baseline for one contract (CT-DC-*). The acceptance
table that follows binds every AC-DC-* criterion to the objectives it proves.

- **OBJ-DC-1:** Delivery evidence identifies repository, PR, authored head, merge commit, observed state/time, and verification provenance; a squash merge closes the correct delivery and a later unmerged head cannot inherit it (contract CT-DC-DELIVERY).
- **OBJ-DC-2:** Authoring ends only after a durable handoff records BI, Workroom, source revision, delivered scope, acceptance contracts, evidence links, unresolved risks, responsible controller, and next event; no full transcript is required to continue, and scope added after that receipt creates a new attempt (contract CT-DC-HANDOFF).
- **OBJ-DC-3:** Release membership uses the merge commit included in the served artifact, scoped to repository and installation; a passing pre-merge build never substitutes for operational acceptance (contract CT-DC-ACCEPTANCE).
- **OBJ-DC-4:** Waiting has a persisted identity and continuation; it holds no inference worker, client heartbeat, runtime lease, or required open client (contract CT-DC-WAIT).
- **OBJ-DC-5:** Archive and cleanup are acknowledged idempotent steps; dirty, pinned, active, conflicted, and unmerged source remains protected (contract CT-DC-CLEANUP).
- **OBJ-DC-6:** Execution, waiting, replay, cache use, and attention are measured separately; idle saved conversations are not counted as inference spending (contract CT-DC-COST).

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-DC-1 | OBJ-DC-1 | Squash merge, a new head after merge, stale or unknown provider state, an installed runtime without Git, and duplicate or out-of-order events all resolve to the correct delivery. |
| AC-DC-2 | OBJ-DC-2, OBJ-DC-5 | A crash between steps, an active dirty worker, a missing host, and a retry lose no acceptance and perform no unsafe deletion. |
| AC-DC-3 | OBJ-DC-4 | Waiting consumes no worker; a fresh task resumes from the handoff; unmerged source remains protected. |
| AC-DC-4 | OBJ-DC-4 | A canceled waiter is never admitted; a predecessor cannot kill its successor; a queued receipt actually executes. |
| AC-DC-5 | OBJ-DC-3 | Identical integration evidence is reused; a changed tree, lock, or check identity forces the appropriate verification. |
| AC-DC-6 | OBJ-DC-3 | Ten obligations with three compatible checks run three checks and keep ten results; tenant separation, duplicate dispatch, and rollback hold; a failure creates exactly one corrective item. |
| AC-DC-7 | OBJ-DC-6 | Billed, estimated, and unknown costs are distinguishable; a 10,000-row cursor fixture completes; no idle-task billing is assumed. |

## State, data, and ownership

Workroom remains the outcome coordination anchor. Its authoring attempt can archive
as delivered while linked acceptance remains pending. Backlog `done` continues to
require its actual acceptance contract. Archive does not manufacture that evidence.
Release the authoring claim without advertising delivered demand as new coding work.
The next-work selector must distinguish acceptance pending from implementation ready.

Use TaskRun for durable continuations and worker retries, RuntimeVerification for
acceptance obligations/results, GitPromotionCandidate for Git event identity, the
actual self-upgrade run and RuntimeTarget for served bytes. ReleaseBundle is used
when present; its current model primarily groups FeatureBuild rows, so external PR
delivery must not require a fabricated bundle membership.

RuntimeVerification already has optional Workroom, build, target, and candidate
relations and a unique verificationId. Preserve the writer's one-primary-attach-point
contract. Each obligation retains its own record. Shared execution evidence is
referenced by immutable ID in validated result data; never copy a pass to unrelated
requirements. TaskRun artifacts carry the compact handoff. Extend the existing
typed contracts; any new persisted closed axis must use the enum registry/migration
procedure. Do not expand free-form status strings ad hoc.

Provider observations must be authenticated, repository-bound, timestamped, and
version/fingerprint checked. Reuse contributor inventory for reconciliation and
Git intake for events. Unknown, stale, or unavailable provider state means
reconciliation required. It is neither open-PR proof nor permission to abandon.
Retain the previous known merge fact across an outage. Local Git is a useful
positive corroboration, with squash semantics explicitly accounted for.

## Event flow and failure recovery

FLOW-DC-1: verified merge observation -> persist acceptance handoff -> archive
authoring attempt and release execution ownership -> enqueue host closeout receipt.
Each step has an idempotency key and a retryable state. A client adapter can archive
the conversation when idle and acknowledge it; the server does not assume it did.
An actively writing process must first checkpoint and acknowledge release.

FLOW-DC-2: self-upgrade success + confirmed served SHA -> admit verification TaskRun
-> page pending obligations -> group compatible checks -> execute bounded campaign
-> attach evidence -> complete acceptance or capture corrective work.
Admission is keyed by installation, served SHA, and acceptance-plan digest. Duplicate
events reuse it. Persist before dispatch and reconcile undispatched work every five
minutes so a lost event or process restart cannot require a human retry message.

Check equivalence includes contract/version, route or capability, persona, tenant,
fixture/data preconditions, environment, and served SHA. Similar route names alone
are insufficient. A ten-change release with three equivalent checks executes three
checks and retains ten traceable acceptance decisions. Rollback or another upgrade
during execution invalidates results for the changed target; re-admit against the
new served SHA. Runtime verification must respect production data and authority.

FLOW-DC-3: infra failure -> bounded server retry with backoff -> durable attention if
the retry budget is exhausted. A behavior failure creates one corrective BI keyed
by acceptance contract + served SHA + failure fingerprint, using the existing
corrective intake. Repeated notifications coalesce; approvals and failures never
disappear into progress coalescing. A new implementation uses a fresh Workroom.

FLOW-DC-4: local capacity unavailable -> durable queue receipt -> caller ends ->
server admission wakes the execution once. Queue cancellation and supersession
remove the waiter atomically. Old lease holders cannot terminate successors. The
queue owns readiness; a future task does not depend on the old provider session.

## Verification lanes and refactoring

Fast affected tests/typecheck/lint provide early feedback before publication. The
protected integration build remains mandatory. Reuse a result only for the same
immutable integration tree, dependency lock, check definition, and relevant runtime
identity. A prior green branch build does not certify a different merged tree.
Use shared local runtime capacity for the evidence unavailable from that result.
Do not add a second exhaustive build simply because a default-branch push arrived.

Reserve 20% of implementation capacity for deletion/refactoring that reduces future
cost: unify PR-state readers, centralize handoff/closeout transitions, remove duplicate
dispatch/retry loops, reconcile gate-policy duplication, and replace misleading
retry instructions with one durable continuation contract. Measure eliminated calls
and duplicated checks. Do not use a lines-changed quota.

## Operator experience

Extend the current Task Hub to show Working, Waiting, and Needs attention. Waiting
states say what event owns progress, for example: "Delivered; acceptance will run
after the next upgrade. No worker is running." A release row summarizes included
changes, distinct checks, passed/failed/pending counts, and the next needed action.
Details expose individual obligations and evidence without expanding all tool calls.

Delivery complete and outcome verified are separate labels. Unknown runtime state
is visibly unknown. Use existing components and theme tokens, keyboard navigation,
text status labels, and narrow-screen layouts. Show cleanup pending/complete only
where it helps the operator; keep path and lease details in inspection views.

## Scale and metrics

All recovery scans use stable keyset cursors, bounded batches (initially 100), and
persisted continuation. No fixed first-500 sweep may starve later records. Index
access paths before increasing fleet size; measure query plans at 10,000 pending
obligations per installation. Events stay installation-scoped and do not fan out to
every peer. The owning closeout and throughput epics retain any measured scale gap.

Initial targets: close authoring within five minutes of acknowledged handoff; zero
client polls during durable waits; 95% reduction in sampled wait-management calls;
cleanup eligible source within 15 minutes of host release; start acceptance within
five minutes of served-version confirmation. These are targets, not measured gains.

Extend the existing outcome scorecard with p50/p95 queue, merge-to-deploy, and
deploy-to-acceptance times; abandoned admissions; duplicate executions; acceptance
deduplication; unreaped eligible worktrees; operator interventions; model calls per
outcome; input/output/cache-read/cache-write tokens and estimated/billed cost by
provider. Missing external billing is unknown, not zero. Provider cache TTL must
never define Workroom ownership or cleanup policy.

## Delivery boundaries and verification

Each row is independently shippable and needs its own governed plan/PR. The table
is design scope mapping, not a recorded implementation coverage receipt.

| Deliverable | Existing backlog | Verification |
| --- | --- | --- |
| Explicit PR state and squash-safe delivery observation | BI-9FF39058 | AC-DC-1: squash merge, new head after merge, stale/unknown provider state, installed runtime without Git, duplicate/out-of-order events |
| Durable closeout and host acknowledgement | BI-154689E7; BI-75565393 | AC-DC-2: crash between steps, active dirty worker, missing host, retry; no lost acceptance or unsafe deletion |
| Pause/ownership projection and bounded resumption | BI-33E1E5D7; BI-9A353411 | AC-DC-3: waiting consumes no worker; fresh task resumes from handoff; unmerged source remains protected |
| Capacity cancellation, successor fencing, durable gate execution | BI-9BDF9539; BI-2584792B; BI-2461C0B1 | AC-DC-4: canceled waiter never admitted; predecessor cannot kill successor; queued receipt actually executes |
| Evidence reuse and proportional checks | BI-282AE0BC; BI-8D56F777 | AC-DC-5: identical integration evidence reused; changed tree/lock/check identity forces appropriate verification |
| Release acceptance grouping and Task Hub projection | BI-E3B918C2 | AC-DC-6: ten obligations/three compatible checks; tenant separation; duplicate dispatch; rollback; failures create one corrective item |
| Cost and attention measurement | BI-69803ACC | AC-DC-7: billed/estimated/unknown costs distinguishable; 10,000-row cursor fixture; no idle-task billing assumption |

Order: delivery observations -> durable closeout/acceptance admission -> release
verification -> UI/metrics. Capacity defects can ship independently. Existing Task
Hub and async-operation work retain their owners; this successor extends their
published contracts. A governed reviewer must validate the final baseline and
coverage before implementation starts.

## Compatibility, rollout, and rollback

First run observation and cohort planning without closing tasks or running checks.
Compare proposed membership/dispositions with authenticated provider facts and the
served release. Then enable delivery handoff on newly merged work; historical rooms
require confirmed provenance. Finally enable verification execution and host cleanup
using their existing authority gates. Preserve dirty/active/unmerged protection.

Prefer additive contract data and readers that tolerate missing fields. Do not mass
rewrite statuses or introduce a database migration solely for a UI label. If indexes
or enums are required, add forward-only migrations tested on existing records.
Rollback disables the new actuator and preserves handoffs and pending obligations;
the existing runtime and source evidence remain readable. Never clear pending work
to make a queue look healthy.

## Research and benchmarking

- Temporal durable execution: adopt persisted continuation/replay semantics through
  existing Inngest/TaskRun; reject adding Temporal as another engine.
  <https://docs.temporal.io/workflow-execution>
- Argo Rollouts analysis: adopt release-scoped analysis with explicit outcomes and
  failure handling; reject per-PR live sessions as the analysis controller.
  <https://argo-rollouts.readthedocs.io/en/stable/features/analysis/>
- Kubernetes TTL-after-finished: adopt separate completion and cleanup with finalizer
  style acknowledgement; do not interpret an idle author as proof that source is safe
  to delete. <https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/>
- Provider caching is a request optimization with limited retention and matching
  requirements, not durable workflow state. Idle task storage alone does not establish
  a token charge. Use measured cache metadata instead of a universal one-hour claim.
  <https://developers.openai.com/api/docs/guides/prompt-caching>
  <https://platform.claude.com/docs/en/about-claude/pricing>
  <https://ai.google.dev/gemini-api/docs/generate-content/caching>

## Review readiness

The source audit found the schema/owners above and the kernel recommended this
option set. Independent initiative review runs through the server-issued reviewer
routes (request_coworker with the initiative-review binding from the readiness
recovery packet); authors do not hold the receipt writers directly, and that is
the intended authority split, not a blocker. Reviewer receipts are bound to the
immutable blob of this file at the reviewed commit, so any edit after a receipt
requires the affected gates to be re-recorded at the new head.
