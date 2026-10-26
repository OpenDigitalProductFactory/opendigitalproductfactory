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
