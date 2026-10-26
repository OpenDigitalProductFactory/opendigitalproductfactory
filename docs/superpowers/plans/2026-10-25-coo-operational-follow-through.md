---
status: active
---

# COO operational follow-through delivery plan

**Umbrella:** BI-4B48E7FE. **Workroom:** WC-D5FD489C.
**Design:** docs/superpowers/specs/2026-09-03-coordinated-workrooms-design.md,
October 25 amendment. **Decision:** DI-EE06CE5554D2, ratified by the founder.
**Current design status (October 26):** the prior design/strategy reconciliation
merged in PR #6599. Native design/spec approval at e48abd61281f established
baseline-fb4de98c-353a-4e89-98b6-23a455810cc1; plan approval and decomposed
coverage bind 297e69b44b0f. The new installation-aware objective and AC-COO-08
need independent review, baseline reconciliation and refreshed P2 coverage.
The amended scope stays with BI-4B48E7FE / WC-D5FD489C; P2 is BI-C43FD3E5.
Its implementation is not admitted.
Current architecture has no verdict after incomplete immutable source traversal;
BI-E8237EAE owns the reader repair. Runtime publication and live COO acceptance
remain pending. Delivery state and exact execution evidence live on the Workrooms.
For agentic workers: execute this plan one independently reviewable backlog item
at a time -- one BI, one branch, one PR. Use dpf-tdd for red-green implementation,
dpf-local-merge-ci-before-push plus the completion gate before any success claim,
and dpf-pr-with-dco for handoff.

## Design grounding

Extend the canonical coordinated/proactive Workroom designs, the existing
conclusive-stop invariant, common recoverability doctrine and Workroom cycle
continuity. BI-12A083B4 and BI-CB690D61 are delivered history, not missing
substrate. BI-IMP-9DA35549 and BI-BF20F828 retain their learning/review scope.
BI-65D75876 retains the operator composition. BI-D95FD249 separately owns the
scheduled-author mandate defect; route its blocker without duplicating it.

## Source and authority boundaries

Source begins at origin/main 64e03a9f504ff678807cb4e470b572a0b184441e.
The development runtime is authoritative through MCP and the paired peer is
read-only. No installed source, shared root clone or private memory is edited.
Current room admission, grants, action-specific policy, independent review,
budget and source identities must be revalidated. This plan adds no authority.

## Phase P1: truthful effective progress -- BI-756C899D

Independently shippable. Repair effective outcome before projection in
apps/web/lib/queue/functions/workroom-drive.ts and workroom-drive-graph.ts.
Consolidate conclusion/hold projection in existing shared work-management
owners; handle provider hold, lease contention, failed enqueue and reviewer
result without stale in-motion status. Preserve no-progress across retries
and reason changes and clear on confirmed completing evidence or verified
stage/marking advancement. Read legacy unknown age honestly.

Requirement refs: OBJ-COO-PROGRESS.
Acceptance refs: AC-COO-01; AC-COO-02.
Contract refs: apps/web/lib/work-management/drive-conclusion.ts;
apps/web/lib/work-management/workroom-drive-hold.ts.
Flow ref: plan -> observed dispatch outcome -> conclusion/hold -> persistence -> attention.
Verification refs: apps/web/lib/queue/functions/workroom-drive-conclusion.test.ts;
apps/web/lib/work-management/workroom-drive-hold.test.ts;
sequential and graph provider-hold served-runtime verification.

Write failing regressions for the sampled provider-hold pattern, capacity
wait/reason switching, a successful evidence transition, successful enqueue
without completion, legacy state and legitimate inactive/future-cycle waits.
Run affected tests and web typecheck, exact-tree gate, independent semantic
review, protected merge and canonical release. Verify actual served output.

## Phase P2: owned COO recovery -- BI-C43FD3E5

Independently shippable after P1. Extend the existing standing-room/task and
room recovery path; do not create a second scheduler. Use the canonical COO
identity, room coordinator, current governed recovery request and existing
checkpoint/activity/result identities. Persist the obligation before dispatch;
acknowledgement and verified result are separate states. Bound retry and
reconcile uncertain effects before any successor.

Requirement refs: OBJ-COO-RECOVERY; OBJ-COO-EXTERNAL; OBJ-COO-LEGIBILITY; OBJ-COO-PROGRESS; OBJ-COO-INSTALLATION.
Acceptance refs: AC-COO-03; AC-COO-04; AC-COO-05; AC-COO-06; AC-COO-07; AC-COO-08.
Contract refs: apps/web/lib/work-management/workroom-stall-notice.ts;
apps/web/lib/work-management/nested-room-coordination.server.ts;
apps/web/lib/operate/scheduled-jobs/coworker-standing-self-tasks.ts;
apps/web/lib/work-management/workroom-drive-checkpoint.ts;
docs/architecture/workroom-cycle-continuity.md;
apps/web/lib/work-management/federated-room.server.ts;
docs/superpowers/specs/2026-08-08-federated-a2a-gaid-coordination-design.md;
docs/architecture/federation-outbox-runbook.md.
Flow ref: due stalled room -> authorized COO recovery obligation -> acknowledged owner request -> reconcile result -> independent verification or necessary human decision.
Verification refs: apps/web/lib/work-management/workroom-stall-notice.test.ts;
apps/web/lib/operate/scheduled-jobs/coworker-self-tasks.test.ts;
canonical served-runtime fault/recovery pilot.

Before code, resolve exact persisted recovery ownership and current action
admission in the independent design/architecture review. No generic role grant
or prompt is a permit. Missing owner, admission or external adapter stays an
explicit routed blocker. The first implementation is bounded to 100 due
candidate rooms and 10 recovery requests per existing drive cycle; continuation
remains due, oldest first. State incompleteness and reuse current pagination.

Update COO persona and skill/task definitions with regression guards against
the stale Advisor-only, report-only contract. Update Workroom/operator guidance
using the existing read model and disclosures; do not add another dashboard or
private task list. Check cadence parity, alias identity and current grants.

### Installation and Phase E integration

1. Resolve canonical local COO identity together with installation identity,
   organization, declared purpose, runtime and existing authority. Qualify the
   conversation and scheduled paths against the same mandate and permitted tools.
2. Reuse Phase E PR #6609 / BI-63FB1683 for supervision visibility and local
   ask/ack. Resolve its destination-admission, undelivered-message replay and
   ACK-before-ask findings before using it as the recovery obligation's transport.
   Keep delivery and acknowledgement separate from verified outcome.
3. Read the existing paired-estate/federation state. Qualify the supported remote
   discovery/task/result path against its owning federation work; do not treat
   the presence of federated-room helpers as implemented inbound coordination.
4. Bind a remote context request to source/destination installations and COOs,
   the originating Workroom, permitted scope, task/receipt identity, due time and
   source/version/applicability. A production business question stays owned by
   its production authority when the relevant corpus is unavailable in DEV.
5. Use current projection and receiver-side policy. Preserve this install's
   read-only peer boundary; a peer action needs its existing control-scope gate.
   No universal remote execution, corpus replication or new identity registry.
6. Bind sandbox/test work to its parent run, admitted lease, actual identity and
   expiry. Recover or hand back obligations and uncertain effects before disposal;
   parent acknowledgement is required and test receipts remain test evidence.

Refactor shared identity/context resolution, request/result reconciliation and
operator projection rather than building separate loops per environment. Existing
federation and Phase E owners retain their implementations and acceptance.

## Operational acceptance

Run a controlled test on the canonical development runtime with the repaired
release. Exercise transient provider failure/recovery, interrupted external
executor with original conversation unavailable, dependency release and one
real human decision. Record beginning and end source identities, task/receipt
identity, acknowledgement time, last verified progress, owner, duplicate-effect
checks and human interventions. Add controls for revoked admission, canceled
work, independent gate, explicit pause and uncertain publication.

For AC-COO-08, exercise DEV requesting permitted production context that is not
in DEV, a denied or stale source, duplicate remote response and lost acknowledgement,
revoked peer trust, a cloned test identity, and sandbox expiry with unfinished work.
Record installation and COO identities, applicability, destination decision authority,
parent handoff and absence of duplicate effects. A supported refusal is an honest
result; missing federation execution is a named dependency, not a passing pilot.

No founder nudge may be part of a passing recovery. A genuine necessary decision
is expected and must be routed once. A valid refusal remains a valid refusal.
The pilot's observation window and incomplete cases must be disclosed; no
unit-only or completed-BI evidence closes this phase.

## Risks and rollback

False progress resets can conceal stalls; over-eager detection can nag on
legitimate waits; retrying unknown effects can duplicate publication; global
fan-out can exhaust capacity. Use current run/evidence identity, durable
continuations, bounded selection, exact admission and result reconciliation.

Rollback stands down new dispatch via the existing policy/release path while
preserving obligations, decisions, receipts and queue holds. Never clear a hold
or discard a checkpoint merely to make the system look healthy.

## Refactoring allocation

At least 20 percent of implementation effort consolidates shared effective
outcome, progress, recovery and operator projection paths. This is the explicit
task direction. It does not replace owner-scoped funding policy or resolve
missing investment authority.

## Backlog coverage

Decision: decomposed. P1 maps to BI-756C899D. P2 maps to BI-C43FD3E5 and depends
on P1. The design/strategy/guide reconciliation accompanies these deliveries.
Live decomposed coverage cmvol5jge0sr701o0xwelfc4l binds the plan at
297e69b44b0f116bb8e38e46c6878e61b0bf89c8 to baseline
baseline-fb4de98c-353a-4e89-98b6-23a455810cc1. Native plan approval is
initiative-review-v1-f016d738ee67c46249678f403792f4a296dc0dffd4539e3cdcb28fb626b9dc69.
These receipts cover their immutable artifacts, not later verification notes.
Revalidate live readiness and the exact source before implementing a slice.

The start-of-work change-impact contract is resolved for the design/doc paths:
no source tests or guard obligations were listed; regenerate/check doc-index,
doc-impact and diagram artifacts where affected, then check PR health.
Implementation claims must refresh exact source paths and carry every returned
testImpact and guardObligation into the appropriate phase.


## Delivery integration and evidence ownership

Execution history belongs on the canonical Workrooms and backlog evidence. The
old overlapping-document approval is resolved; do not replay it. Earlier uncertain
reviews and failed host observations remain preserved and do not become passes.

| Work | Existing owner | Current next outcome |
| --- | --- | --- |
| Truthful effective progress | BI-756C899D / WC-36F36351 | Publish and qualify tested source through exact-tree gate, independent review and served acceptance |
| Immutable reader recovery | BI-E8237EAE / WC-9255BE6F | Publish the bounded cursor-guidance fix, deploy normally, then recover the original eligible architecture execution |
| COO supervision surface and local broadcast | PR #6609 / BI-63FB1683 | Reuse Phase E; resolve recorded integration findings and complete its own served verification |
| Installation-aware recovery and onboarding | BI-C43FD3E5; parent scope WC-D5FD489C | Review this amended scope, reconcile baseline/coverage, then implement and verify the local/peer COO contract |
| Finite delivery completion acceptance | BI-A798975C / WC-5D6B124A | Continue the transferred completion/replay/changed-criteria/missing-evidence acceptance; a successful executor handoff does not close it |
| Learning and review continuity | BI-IMP-9DA35549 / BI-BF20F828 | Retain harness evaluation and review ownership; no second improvement engine |

PR #6600 delivered the existing Windows gate repair. Its merge removes the old
source dependency; only a fresh qualified result for the candidate can establish
publication readiness. PR #6599 delivered documentation, not runtime COO behavior.
Exact source/test identities and later changes are read from live evidence before
each publication; this plan does not maintain a second mutable build ledger.

The founder authorized coordination with “Prioritize DPF platform design” and
implementation of the agreed plan. Its archived handoff remains provenance:
coordinated-coo-implementation-handoff.json, SHA256
2404f9f247322c69b1ee78d81631a87f74a7da8ba109d200a4ee38a3e127d1b6.
This receiver completed the native finite-room transfer and one exact ACK replay;
RV-COO-FINITE-HANDOFF-20261026 covers that scoped outcome only. No source permission
or review authority is delegated by this coordination history.

Harness2 task-level Propose-Probe-Compose and the separate Meta-Harness candidate
promotion experiment remain design references. Keep incumbent/candidate identities,
isolated probes, regression/held-out cases, budget and rollback with the existing
learning owners. Optimizing execution does not change the delivery agreement or
authorize a peer action.

Finite delivery retains the existing capture and reader owners:
`apps/web/lib/work-capsules/delivery-agreement-capture.ts` captures the initial
objective and semantic acceptance digest;
`apps/web/lib/work-management/delivery-agreement.ts` owns typed reads and
projection. Retry, restart and recovery retain that agreement. Changed acceptance
requires explicit reconciliation; missing evidence blocks completion, completed
handoffs stay immutable, and separately owned follow-ons cannot reopen them.

## Amended review and coverage

The prior design/spec, baseline, plan and coverage receipts remain bound to their
immutable artifacts. Do not label the October 26 installation clarification as
already approved. Retain the original objective/criterion IDs and earned P1
evidence, add OBJ-COO-INSTALLATION / AC-COO-08 through the governed baseline change,
then refresh decomposed coverage: P1 remains AC-COO-01/02; P2 covers AC-COO-03..08
and depends on P1. No new parallel initiative or orchestration engine is required.

Canonical research/ownership grounding is in
../research/2026-10-26-coo-installation-coordination.md. Implementation admission,
exact-source publication and cross-install served acceptance remain separate gates.
