---
status: active
---

# COO operational follow-through delivery plan

**Umbrella:** BI-4B48E7FE. **Workroom:** WC-D5FD489C.
**Design:** docs/superpowers/specs/2026-09-03-coordinated-workrooms-design.md,
October 25 amendment. **Decision:** DI-EE06CE5554D2, ratified by the founder.
**Current status (October 25):** the design and strategy are reconciled in source.
The parent design/spec approvals remain blocked by uncertain original reviewer
execution, tracked under BI-7906C73E; architecture review passed. P2 is not
implemented. P1 has its own atomic plan/admission and tested source repair,
with no merge, deployment or unattended operational acceptance claimed.

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

Requirement refs: AC-COO-01; AC-COO-02.
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

Requirement refs: AC-COO-03; AC-COO-04; AC-COO-05; AC-COO-06; AC-COO-07.
Contract refs: apps/web/lib/work-management/workroom-stall-notice.ts;
apps/web/lib/work-management/nested-room-coordination.server.ts;
apps/web/lib/operate/scheduled-jobs/coworker-standing-self-tasks.ts;
apps/web/lib/work-management/workroom-drive-checkpoint.ts;
docs/architecture/workroom-cycle-continuity.md.
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

## Operational acceptance

Run a controlled test on the canonical development runtime with the repaired
release. Exercise transient provider failure/recovery, interrupted external
executor with original conversation unavailable, dependency release and one
real human decision. Record beginning and end source identities, task/receipt
identity, acknowledgement time, last verified progress, owner, duplicate-effect
checks and human interventions. Add controls for revoked admission, canceled
work, independent gate, explicit pause and uncertain publication.

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
Live coverage receipt: pending immutable plan publication and independent
scope baseline. This document is not a receipt. Implementation remains held
until record_plan_backlog_coverage and current readiness authorize the slice.

The start-of-work change-impact contract is resolved for the design/doc paths:
no source tests or guard obligations were listed; regenerate/check doc-index,
doc-impact and diagram artifacts where affected, then check PR health.
Implementation claims must refresh exact source paths and carry every returned
testImpact and guardObligation into the appropriate phase.


## Current delivery evidence and resume conditions

P1 is independently admitted by IRD-E06F5E4974CA, with atomic coverage receipt
cmvo7c1zh050601mqxwgivlxg against its companion design at
b433583daddc4f77dd83a616782c3e8170e677e0. Its governed branch is
`fix/workroom-effective-progress`, WC-36F36351. Local signed source ends at
4bb9f306765d2fe3d39c5b9941eed00c85885e2f and is not yet published as code.
301 affected tests and six additional notification/reader/UI checks passed;
three opt-in PostgreSQL tests skipped. A separate source-derived, read-only
PostgreSQL SELECT qualification passed. Typecheck passed.

P1 publication awaits approval of an overlapping claim on the canonical
`docs/architecture/work-shapes-and-the-decision-gate.md` correction. The existing
owner is WC-5D6B124A / BI-A798975C; the proposed edit only updates stale stall
semantics and does not change that owner's finite-delivery agreement scope.
The exact proposed patch is retained with the installation evidence. No edit
was made through the refused claim, and no documentation exception hides it.
Shared exact-tree integration, independent publication review, protected PR
and served-runtime acceptance remain outstanding.

The documentation branch's 126 readiness checks all passed, but its final
qualification was inconclusive after origin/main changed during the run;
head/tree stayed unchanged. The existing host-preflight performance item
BI-5E4BB7CA carries that reproduction. Preserve the receipt and requalify under
the existing procedure; do not edit evidence or call it ready.

For P2, reconcile the original design/spec review executions through their
current launcher, process-supervisor and effect-owner authority before resuming
those exact reviews. Do not dispatch replacements or treat the completed
architecture review as the missing design/spec receipts. No founder status
nudge is an acceptance test, and no passing source suite closes P2.


## Design-only follow-up: COO onboarding and harness comparison

The founder asks to establish the design before implementation. The canonical
design now includes an explicit COO mandate, live tool/grant readiness matrix,
alias-resolution requirement, and an onboarding rehearsal that proves actual
read/request/result/verification capability. The running persona and standing
task have not been updated, and no COO acknowledgement is claimed.

Google Research Harness2 and Joel Niklaus's Meta-Harness experiment inform the
comparison in that design. Operational follow-through remains the COO's job;
measured harness improvement stays with the existing improvement and review
owners. Add candidate/incumbent identity, isolated probes, regression and
held-out acceptance cases, budgets and rollback to P2's relevant repair path.
These clarify AC-COO-03/06 and existing learning boundaries; they do not create
another optimization engine or authorize live grant changes. Existing review
requests remain bound to their original artifacts. This revised design needs
normal independent review after original execution settlement; no old receipt
is claimed to cover the new text.


## Coordinated implementation handoff accepted October 25

The founder now authorizes coordination with "Prioritize DPF platform design"
and implementation of the agreed design and plan. That chat confirmed the
ownership split and supplied a bounded handoff rather than another design.
This chat coordinates P1/P2. BI-A798975C retains finite completion acceptance;
BI-IMP-9DA35549 and BI-BF20F828 retain learning/review; Rationalize approval list
retains approval-policy ownership. No source permission or review is delegated
by this paragraph.

Handoff provenance: coordinated-coo-implementation-handoff.json supplied by chat
01a173c1-2a8e-74d2-a14b-bad35032d891. The receiver read the actual file and verified
SHA256 2404f9f247322c69b1ee78d81631a87f74a7da8ba109d200a4ee38a3e127d1b6.
It is coordination evidence, not a native review, coverage or acceptance receipt.
Its original native recording was refused during an upgrade drain; record this
same identity through Workroom evidence when normal writes return.

### Adopted order and completion boundaries

| Order | Existing delivery | Concrete next outcome | Dependencies and ownership |
| --- | --- | --- | --- |
| 1 | BI-756C899D | Publish and verify truthful effective dispatch/progress | This chat; independent of the optimization program |
| 2 | BI-C43FD3E5 under BI-4B48E7FE | Server-owned COO recovery and onboarding | Current design/plan review, valid coverage/admission, P1 and existing finite agreement contract |
| 3 | BI-34999E95, BI-B93E9C6E, BI-69803ACC | Correct schema-valid true/false/null attribution; join existing outcomes; fixed-cohort quality, throughput, cost and human-attention scorecard | Existing measurement owners; verify BI-58A9FC76 delivered resolver before replacing anything |
| 4 | BI-1B7BB954, BI-6DB95601, then BI-A472354E | Qualification/integrity gates followed by one bounded versioned candidate/incumbent pilot | Existing learning/review owners; scorecard and each BI's current prerequisites |

Orders 3/4 are separately owned follow-ons, not added acceptance criteria for
P1 or P2. They cannot prevent ordinary authorized recovery or silently reopen a
completed finite agreement. Their current live readiness still controls start.

### Concrete finite-agreement integration for P2

Consume the already merged finite contract from PR 6575, merge
909f8eebaffa6e5c1eb2a9e40c53f7580546c64b. Its plan coverage is
cmvo6frnw171d01qhgu1aznxj and implementation admission IRD-5F9E819B30BA.
Those facts do not establish a native independent semantic-review verdict.

- apps/web/lib/work-capsules/delivery-agreement-capture.ts owns capture of the
  initial objective, semantic acceptance digest and scoped guidance context.
  Recovery retains that agreement; it does not capture a replacement objective.
- apps/web/lib/work-management/delivery-agreement.ts owns typed readers and
  projectDeliveryAgreement. Legacy rooms keep unknown initial history, and
  standing rooms retain cycle semantics.
- apps/web/lib/work-capsules/workroom-detail-read.server.ts exposes capsule.delivery;
  apps/web/lib/work-management/room-read-model.ts shares the operator projection.
  The COO consumes that projection alongside effective progress and next action.
- apps/web/lib/backlog/initiative-readiness/work-capsule-terminal-transition.ts
  remains the completion authority: readiness, objective reconciliation and CAS,
  then one immutable handoff in the successful transaction. The COO never writes
  deliveryHandoff or PASS directly.
- Existing evidence result.followOnRefs carries separately owned BI references.
  Later learning or a new request goes there; it cannot rewrite current acceptance.

### Implementation and acceptance sequence for P2

1. Obtain classification, independent current design/plan receipts and coverage.
   The latest native design/spec requests at design head 14ee8608dd4d ended with
   unknown execution outcomes again. Preserve their identities and reconcile;
   no replacement, stale pass or downgraded delivery shape is a remedy.
2. Claim only actual P2 source paths in its own governed worktree; consume the
   returned testImpact and guard obligations before red tests. Reuse the above
   merged contract and existing room/task recovery owners.
3. Add failing cases for immutable agreement through retry/restart, changed
   acceptance, dependency release, provider recovery, cancelled work, denied
   authority and result acknowledgement without verified advancement.
4. Implement durable owner/action/acknowledgement/next-check/result state through
   existing Workroom/task/checkpoint facilities with revision fencing. Keep
   uncertain external effects on their original reconciliation path.
5. Align canonical COO persona, standing task, skills and reachable tool context;
   qualify any actual permission change through its own authority gate. Prove
   direct and scheduled paths resolve the same canonical principal.
6. Run affected tests/typecheck, exact-tree shared integration, independent review,
   protected publication and canonical served acceptance. Finite closeout tests
   remain with BI-A798975C's owner; record the integration evidence and its limits.

The acceptance replay must show provider hold -> owned permitted recovery ->
verified advancement, external interruption without the old conversation,
dependency continuation, and one deduplicated genuine human decision. Completion
must retain the agreed outcome and produce a durable handoff; separately owned
follow-ons do not reopen it. Preserve explicit unavailable peer guidance rather
than assuming a trusted pairing means that guidance was read.

### Current unblocking evidence

The finite-delivery owner normally released all thirty idle path claims. A fresh
ordinary claim for the canonical shape architecture page succeeded, so the old
forced shared-edit approval is no longer needed for this work. P1 now includes
the real canonical documentation correction and current main's provider-hold
capacity fix. Integrated source head f1ed74cb48f6416ea32da6f48f569abb334bf4d3 passed
311 affected tests with three PostgreSQL skips and typecheck; documentation-impact
and design-grounding guards pass. Shared integration has not run: an upgrade
drain first refused admission, and the sanctioned waiter's Windows child spawn
then failed before pregate started. No lease or gate record exists, and no
passing runtime verification is inferred. Resume the supported foreground gate
when the drain clears; do not duplicate a queued claim or edit receipts.
