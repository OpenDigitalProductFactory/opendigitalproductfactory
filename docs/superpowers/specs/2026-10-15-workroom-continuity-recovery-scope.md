---
status: draft
date: 2026-10-15
backlog_item: BI-BF20F828
workroom: WC-1ABA2F71
decision_scope: wwmd
---

# Workroom continuity: child scope and populated migration recovery

## Scope and reason for this artifact

BI-BF20F828 is the continuity delivery child of BI-IMP-9DA35549. Its live body
and the existing delivery graph assign AC-04, AC-05, AC-06, AC-10, AC-11 and
AC-12 to this child. Those obligations remain intact. The parent
[common design](2026-09-06-cross-workroom-learning-review-design.md) and
[delivery plan](../plans/2026-09-12-cross-workroom-learning-delivery-plan.md)
remain authoritative for the wider campaign and the other owners.

The first child spec approval bound the entire shared parent artifact and minted
baseline-e414c445-31b8-475a-908b-d2105ba6b25f. The subsequent plan-coverage
write refused because it requires all baseline acceptance cases, including cases
assigned to other children. This document corrects that artifact boundary. It
does not rename a review request, evade an exhausted review, discard findings,
reduce the child's existing criteria or change its feature/large classification.
The old artifact, receipts and baseline remain immutable historical evidence.
Independent approval and explicit baseline supersession are required.

Retain the parent source's common/profile contract, versions, independence,
bounded operation and no parallel registry/ledger rules. Extend WorkroomActivity,
room-cycle-store, existing TaskRun dispatch and recovery owners. A conversation
cannot own the canonical cursor, next step or evidence. No new scheduler,
workflow engine, counter or findings backlog is introduced here.

## Existing child requirements

**OBJ-RECOVERY:** Preserve fresh evidence and safe continuation across executor loss, interrupted publication, missing workspaces and missed review cycles without relying on conversation memory.

**OBJ-LEARNING:** Turn correctly attributed cross-workroom observations into independently assessed, governed improvements whose effects are verified on comparable subsequent work.

**OBJ-OPERATION:** Make the review and recovery process understandable to its owner and bounded in resource use, with honest coverage, remaining work and one actionable next step.

| Acceptance | Objectives | Observable proof |
| --- | --- | --- |
| AC-04 | OBJ-RECOVERY | Fresh context survives: kill executor and reviewer with conversation unavailable; replacement reconstructs exact safe next step from durable artifacts |
| AC-05 | OBJ-RECOVERY | Recovery safety: missing/dirty paths, competing claims, crash around publication and terminal-parent/stalled-child fixtures preserve evidence and prevent blind replay |
| AC-06 | OBJ-LEARNING | Honest trends: retry replay, late events, denominator changes, sparse cohorts and a 5,000-record cap produce correct recurrence/coverage labels |
| AC-10 | OBJ-OPERATION | Bounded operation: pilot-scale delta/load test meets declared budgets, resumes cursor after interruption and exposes remaining backlog without starvation |
| AC-11 | OBJ-LEARNING | Authority: read-only reviewer cannot repair, publish, expand grants, inspect another tenant or treat transcript instructions as authority |
| AC-12 | OBJ-RECOVERY | Reviewer continuity: missed cadence and reviewer failure produce visible due work; replacing executor does not start duplicate cycles |

Contract `contract:durable-review-cycle` and flow `flow:capture-to-safe-resume`
remain the implementation homes. Budgets remain 200/page, 1,000/cycle, 20
proposals and 30 minutes, with persisted carry-forward and round-robin fairness.
Qualify 10,000 rooms and 100,000 daily evidence records, including tenant
boundaries, replay, unknown coverage, cursor interruption and competing recovery.
Reserve 20% for the shared identity, lifecycle, deduplication and projection
refactoring already required by the parent plan.

## Migration incident and selected forward design

SUR-5B92E384 failed on 2026-10-14 at 19:22:15 UTC while advancing to
8f84efd877f1ccdb3108129f796a2859708fda76. The canonical install still served
c4b60a729b7d58c433e34abbb607395060d032f1 at the last observation. Evidence
cmv95kew2kls501o9uxmusntz retains the actual first PostgreSQL error:
`initiative governance activities are append-only`, raised by
`refuse_initiative_governance_activity_mutation`. The later aborted-transaction
error occurred while Prisma tried to save the failure log.

Migration 20261014012000_workroom_activity_ingestion_hardening backfills NULL
sequence values including protected work-intent-declared activities; the existing
initiative_work_intent_immutable trigger rejects their UPDATE. Empty-schema
verification did not exercise this population. The shared design section 14 at
1e6de76fc77c9252f49fcdba8d025484c2cbb0c4 has independent architecture and
spec approval for the reviewable recovery proposal, not runtime proof.

DI-A43F9A0E6826 selected transaction-contained preparation over a skip-update
trigger committed across two migrations: 8.119 versus 7.153, margin 0.966,
high confidence, autonomyEligible true, no blockers. The feature magnitudes are
qualitative engineering estimates. The generic largest contributors were
Jurisdiction-layered analysis and Propose, Acknowledge, Reassign; the score is
not a database test. The earlier featureless DI-B166928828BA abstained.

Add a preparation migration ordered before the unchanged failing migration.
Under exclusive locks on both existing tables, reconcile counters upward and
refine the shared refusal function only for a protected WorkCapsuleActivity
NULL-to-assigned sequence UPDATE with every other field identical. Every DELETE
and every other table using that function stays protected. Assign protected
positions only where the entire room's NULL population has integer headroom.
Restore the exact original refusal function before commit. Any interruption
must roll back the function and data changes together. No relaxed guard or
disabled trigger may remain committed.

The unchanged hardening migration assigns ordinary remaining NULL rows.
Already-applied histories are a no-op; do not remove the later sequence-identity
guard. Overflow rooms keep their original NULL evidence and unknown coverage.
Never renumber existing positions or describe new ingestion order as historical
chronology. Preserve every semantic activity field, receipt and failed history.

Reuse the source-owned inventory and human-principal migration recovery
classifiers, executable helpers and promoter integration. Authorize normal
Prisma rolled-back resolution only after exact failure identity, checksums,
global unresolved-row count, applied steps and absence of durable effects are
proven. Missing logs, mixed failures, partial effects, checksum drift and state
races fail closed. Do not mark applied, reset, edit published migration bytes,
run live SQL hotfixes, build a live image or retry the unchanged upgrade.
Production history inspection currently lacks admin_read; no other actor,
shell or database route may substitute. Source planning can proceed independently.

## Research and alternatives

The parent compares three implementations: OpenTelemetry propagation supplies
correlation across boundaries; Temporal supplies durable append-only histories;
MLflow supplies reusable evaluation over explicit trace populations. Adopt those
mechanisms in existing DPF contracts. Reject trace identity as authority, another
workflow/evidence store, exactly-once claims and unbounded population claims.
Official sources were reverified on 2026-10-15:

- [OpenTelemetry context propagation](https://opentelemetry.io/docs/concepts/context-propagation/)
- [Temporal event history](https://docs.temporal.io/workflow-execution/event)
- [MLflow production-trace evaluation](https://mlflow.org/docs/latest/genai/eval-monitor/running-evaluation/traces/)

For migration recovery, compare the existing inventory and human-principal
exact-failure classifiers; reuse their bounded identity/checksum/effect checks,
not their incident-specific allowlists.
[PostgreSQL trigger semantics](https://www.postgresql.org/docs/current/trigger-definition.html)
support transactional rollback and explain the ordering risk of the alternative
skip trigger. [Prisma failed-migration recovery](https://www.prisma.io/docs/orm/prisma-migrate/workflows/patching-and-hotfixing)
provides history-resolution semantics; DPF limits execution to its governed
promoter. Reject rewriting a merged migration because fleet checksums diverge.
A later-only migration cannot pass the earlier failure.

## Additional repair criteria

**OBJ-MIGRATION:** Restore governed upgrade progress through populated activity histories while preserving immutable evidence, published migration identity and database-owned ingestion positions.

| Acceptance | Objectives | Observable proof |
| --- | --- | --- |
| AC-MIG-HISTORY | OBJ-MIGRATION | Reproduce the original protected-row failure on a real predecessor PostgreSQL schema; classify exact failed history and prove no durable partial effects before any history resolution |
| AC-MIG-FORWARD | OBJ-MIGRATION | Clean, failed, already-applied, repeated and overflow histories advance safely through additive preparation; original guards and semantic bytes survive success, interruption and concurrent writers |
| AC-MIG-REFUSAL | OBJ-MIGRATION | Missing logs, unrelated or mixed failures, wrong checksums, partial effects and concurrent history changes refuse automatic resolution without altering evidence |
| AC-MIG-LIVE | OBJ-MIGRATION | Protected delivery and actual canonical deployment succeed, served lineage contains required merge84, and genuine provider/review acceptance is exercised with remaining failures reported truthfully |

The existing plan's recovery addendum defines R1 history reproduction,
R2 preparation/classifier/promoter integration and R3 delivery/live acceptance.
They form one atomic repair slice under this BI; the six continuity cases above
remain planned obligations with their existing implementation and verification
sequence. No passing local or historical receipt is relabeled as current runtime
acceptance. All migration repair functional checks remain unrun.

## Supersession and ownership dispositions

On independent approval, supersede only this child's accidentally broad baseline.
Retain OBJ-RECOVERY, OBJ-LEARNING and OBJ-OPERATION and their six child acceptance
statements verbatim. Add OBJ-MIGRATION and its four falsifiable repair criteria.
OBJ-COVERAGE and AC-01/02 remain with BI-11458908; AC-03 with that profile child
and BI-3AA4A997; AC-07/08 with BI-64E86574 and domain/standards owners; AC-09
with BI-9DC43E17. They remain authoritative in the parent baseline and delivery
graph. Their removal from a mistaken child binding neither cancels nor completes
them. No peer source, backlog status or ownership is taken over.

Independent reviewers must verify these dispositions and the migration guards.
Then record exact immutable child approval and baseline supersession, correct
coverage reference types, and obtain independent plan review before implementation.
Keep every old receipt, failed review and failure observation. Missing authority
stops the affected operation; it does not manufacture evidence or new consent.
