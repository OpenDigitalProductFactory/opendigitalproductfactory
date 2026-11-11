---
status: draft
---

# Bounded review turns in shared host admission

**Backlog:** BI-218A4555. **Workroom:** WC-400B4A63.
**Decision:** DI-4358575D0EF0, shared-bounded-turn; high confidence, autonomy eligible. This chooses a design direction, not implementation approval.
**Source inspected:** 4f4271eb934acedc0741f7769f721ce7203ccc87. A fresh origin fetch failed on 2026-11-11; reconcile main before implementation.

## Problem and evidence

An eligible local-only review can miss every free interval between active CI runs. Making queued CI claims nonblocking does not give the review a turn. The completion coordinator reported successive holders C893, CDD846 and 1C54EE5DBB on 2026-11-11 around 23:21–23:28 UTC, while an original review retained one completed branch and deferred another before dispatch. These are attributed observations, not a replay or independent runtime qualification. A voluntary pause by several Codex owners did not cover other clients.

BI-218A4555 already requires a code-owned overseer: one admission policy, fair share, bounded holds, reviews not starved, visible ordering and no routine human referee. Its scheduled triage asked for concrete policy. This document supplies the proposed policy for independent review; it does not narrow or close that parent.

## Existing design and ownership

- [In-platform coding readiness](../plans/2026-11-04-in-platform-coding-coworker-readiness.md) names this item as an existing pilot prerequisite.
- BI-0B1DF949 / DI-4369768D28F8 owns active-only inference deferral. It is a foreign record here; this work neither changes that record nor restores queued-claim deferral.
- BI-D25F867D owns bounded original-task capacity backoff. Its attempts, deadlines and completed review branches remain authoritative; this work does not reset them.
- BI-995E9530 owns bounded preview yield. Reuse its idle-point yield rather than interrupting a running gate.
- `apps/web/lib/nonprod/environment-lease-host-backed-reservation.ts` already serializes host-heavy and local-CI admission through a shared advisory lock. `host-resource-policy.ts` already names inference and semantic-review classes.
- `apps/web/lib/routing/local-provider-capacity.ts` reads active CI reservations but creates no review reservation. `apps/web/lib/mcp-task-capacity-resume.ts` reconstructs original task authority and invokes the CAS resumer. Source search found no production caller of its task-ID capacity-event seam; the scheduled execution worker remains a fallback.
- `scripts/host-resource-runner.mjs` supervises actual local commands with process identity. A generic taskRunId field is not a supported transfer of custody to a parked native review. Do not wrap a wait loop or invoke the resumer from shell.

## Options and selected direction

1. Wake the existing original-task resumer after lease release. Smaller reach, but a concurrent gate can still win every admission race.
2. Extend shared host admission with bounded, durable review turns and use release events as hints. This makes ordering authoritative across clients and restarts.

The kernel selected option 2, composite 4.325 versus 3.124, margin 1.201, no commandment conflict or autonomy blockers. Strong contributors included grounding in the existing platform and maintainability. The higher implementation reach remains a cost. The recorded outcome is design selection only.

## Proposed admission contract

The server projects candidates from existing lease requests and due durable review waits; clients cannot create priority by naming a resource class. A review candidate must carry its original task, branch/stage identity, current authority and source binding, remaining execution budget, eligible provider and unchanged completed-branch set. Unknown settlement, terminal tasks, future backoff, denied authority or exhausted budget cannot become ready candidates. Allocation creates no review and spends no model allowance.

Under the existing shared host admission lock, re-read eligible candidates and host headroom, then select and persist one bounded turn. Preserve the existing transaction lock order. This transaction ends before provider dispatch; never hold a database lock for model execution. Use the existing lease/admission history and task identity where they can represent the contract; do not create a second queue or caller-minted execution authority.

Proposed ordering is: mandatory gates and reviews before optional preview work; within that tier, alternate ready review and gate classes when both wait. Within a class choose the least recently served eligible executor/session, then recorded portfolio priority, then original ready time and stable identity. Changing session labels must not evade the authenticated executor's share. A waiting candidate's age survives a transient capacity deferral. Invalid or future-due candidates do not block others.

The measurable fairness bound is in admission opportunities, not an unconditional wall-clock promise: while both classes stay eligible and capacity remains safe, each class gets at least one turn in every two new mandatory admissions. With N continuously ready eligible owners in one class and no eligibility changes, each owner gets a turn within N admissions of that class. New arrivals cannot leap ahead of an already-waiting round. Portfolio priority orders peers within their current fair-share round; it cannot erase the bound.

A selected review has a proposed 30-second dispatch-acknowledgement interval. Failure to acquire the existing task CAS within it releases that unused turn through the owning server transition, without claiming task failure or issuing a replacement review. This interval is a proposal requiring independent review and timing evidence, not a production setting changed here. After acknowledgement, use the review's existing bounded provider execution lease/deadline; no new timeout allowance. A crash is reconciled using existing execution ownership and settlement evidence before capacity is reclaimed. Expiry alone never proves a process exited.

Release and expiry reconciliation enqueue a deduplicated wake for the existing due task. The normal scheduled resumer remains the lost-event fallback. Duplicate wakes, concurrent schedulers and late arrivals must converge on one CAS/turn. A wake never overrides backoff. If authoritative current eligibility is unavailable, record the reason and do not dispatch.

Active CI runs finish normally. Preview yield occurs only through the existing bounded idle-point contract. New gate admission reads the same reservation transaction; no fake CI lease, cancellation, process kill or manual host-memory workaround is part of this design. Gates must also progress under sustained review demand.

## Objectives and acceptance

**OBJ-FAIR-1:** Eligible reviews and required gates obtain bounded turns across all executor clients without human coordination.

**OBJ-FAIR-2:** Admission preserves original task identity, authority, completed work and host safety through races and restarts.

**OBJ-FAIR-3:** Existing workroom and queue readers explain why work runs or waits using attributable policy evidence.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-FAIR-1 | OBJ-FAIR-1 | Under continuous eligible cross-client CI and review demand, each class receives one turn in each two mandatory admissions and each continuously ready owner receives its turn within its class round; reverse-load tests prove gates are not starved. |
| AC-FAIR-2 | OBJ-FAIR-1, OBJ-FAIR-2 | Simultaneous gate/review claims use the shared admission lock and existing host-memory calculation; no incompatible double admission or parallel queue is created. |
| AC-FAIR-3 | OBJ-FAIR-2 | Duplicate release events, scheduler races and restart between reservation and dispatch yield at most one original-task CAS dispatch; completed branches, source, grants, budget and provider eligibility are unchanged. |
| AC-FAIR-4 | OBJ-FAIR-2 | Future backoff, terminal or uncertain tasks, stale source, denied grants and exhausted budget receive no turn; absence of a safe candidate does not block another eligible class. |
| AC-FAIR-5 | OBJ-FAIR-2 | Missed dispatch acknowledgement releases only the unused turn; crash during acknowledged execution requires authoritative settlement and never treats TTL expiry as process-exit proof. |
| AC-FAIR-6 | OBJ-FAIR-1, OBJ-FAIR-2 | Existing active gates finish without preemption, preview yield retains its current idle-point boundary, and queued-only CI continues to leave unreserved inference available under BI-0B1DF949. |
| AC-FAIR-7 | OBJ-FAIR-3 | Existing queue/workroom projections show selected class, owner, original task, policy version, eligibility reason, round and expiry or execution binding; all clients consume the same decision. |
| AC-FAIR-8 | OBJ-FAIR-1, OBJ-FAIR-2, OBJ-FAIR-3 | A controlled served-target run with at least two executor clients, repeated gate arrivals and one multi-branch review records the bound, preserves an already-completed branch, and recovers after the requesting client closes without operator intervention. |

## Data, authority and compatibility

No credentials, provider additions, grant expansion, review exemptions or private transcript copying. Persist only the admission and execution identifiers and bounded reasons needed for reconciliation. The data architect must establish whether existing lease/task metadata and history suffice before any schema change; new schema is not approved by this draft. Apply existing sensitivity and retention declarations to any new projection fields. No retrospective rewrite of queue history or historical decision receipts.

Introduce a versioned server policy and fail closed for clients unable to provide required provenance; clients do not enforce fairness themselves. Migration and rollout must preserve existing active holders. Do not activate the new policy until shared-lock concurrency and original-resumer integration are verified on the governed target. Rollback stops new policy admissions while settling existing acknowledged executions under their original identity; it cannot discard an in-flight review turn.

## Implementation and evidence sequence

1. Verify current main and owning Workroom; obtain independent architecture, data and required design reviews, including EA review. Decide funding scope without inferring it from this production install or administrator role.
2. Record canonical plan coverage for BI-218A4555. If full overseer scope needs independent children, obtain explicit decomposition and live child mappings; this residual slice alone cannot close the parent.
3. Reproduce the admission race in controlled tests. Implement deterministic selection and round accounting within existing admission, then server-owned original-task reservation/CAS integration, then existing read-model explanations.
4. Run affected unit and package type checks; test actual PostgreSQL transaction races and restart boundaries through governed shared capacity. No whole-suite local run or ungoverned database fixture.
5. Publish through DCO, independent review, protected CI and merge queue. Advance only through canonical release. Execute AC-FAIR-8 on served bytes and preserve incomplete or failed evidence honestly.

Design-time checks do not establish runtime fairness. Existing original review 7B may complete naturally while this is developed; reuse its result, never replay it to demonstrate the new policy. Qualification uses separately admitted controlled work with declared scope and allowance.

## Research and open review questions

[PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html) documents transaction-level advisory locks and consistent lock ordering. Reuse that existing mechanism for atomic admission; a database lock provides exclusion, while the application must define fair ordering. It does not itself establish the proposed fairness bound.

Independent review must settle: the exact persisted representation of class rounds; protection against session-label churn; whether the 30-second acknowledgement interval is supported by measured dispatch latency; the task-to-host execution custody contract; and the relation between portfolio priority and bounded rounds. Until these are resolved and plan coverage admitted, implementation is unrun and no live scheduling behaviour has changed.
