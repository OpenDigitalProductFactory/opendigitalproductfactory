---
status: draft
---

# Ordered fix: PR delivery selection fairness

**Backlog:** BI-A9F78411. **Workroom:** WC-FFB476B6.
**Source base:** 6d1ce4762307ded266a732076edbe1a99f9518a7.
**Canonical architecture:** [PR follow-through](../specs/2026-10-01-pr-follow-through-workroom-duty-design.md), sections 3.2–3.3. This is a proportional repair of its polling safety net, not a second publication architecture.

For agentic workers: execute this plan as one independently reviewable backlog item, one branch and one PR. Use the DPF red/green, canonical build gate and DCO procedures.

## Objective and observed defect

**OBJ-1:** Every eligible PR room eventually receives an observation even when standing-drive snapshots continue changing its generic modification time. This does not promise service faster than available capacity or declare a GitHub status publishable.

The actual current selector sorts generic `updatedAt`, scans 200 rows and consumes at most 25 after filtering stopped rooms. The standing drive rewrites quiet snapshots every 15 minutes. Executed CLIENT evidence `cmwd0zdy660qj0emf8ghqt30s` uses the actual selector and delivery-state parser: 100 synthetic rooms, three 25-room reconcile ticks between drive rewrites, twelve ticks total. Rooms 76–100 never receive an observation. Actual live missing statuses have additional possible causes; the source counterexample does not establish their sole cause.

## Existing substrate and chosen correction

Reuse `ScheduledJob.runCursor`, already used for bounded, restart-safe keyset scans by `apps/web/lib/operate/backlog-triage-repository.ts`. Do not introduce a table, migration, capability, endpoint, model review, manual GitHub status or install switch. The scheduler remains `build/pr-delivery-reconcile` with its existing five-minute trigger and concurrency limit.

Use a job-local durable row cursor and immutable Workroom row IDs instead of generic modification time:

1. Self-register only this job's ScheduledJob row with its real cron and read its current cursor. Preserve existing job metadata.
2. Query at most 200 bound-PR nonterminal rooms after the cursor, ordered by row ID. When this query is empty, wrap once to the start. A deleted cursor row remains a valid keyset boundary.
3. Walk the page in order. Skip already-stopped delivery states using the existing parser. Consume at most 25 eligible rooms. The next cursor is the last row actually consumed, including skipped prefix rows, never the unconsumed end of a full page.
4. Advance the cursor by compare-and-swap against its exact previously read value before contacting GitHub. Losing that claim performs no room effects. Advance even when later observations fail, are head-mismatched or denied; those rooms return on the next complete sweep rather than monopolizing a prefix.
5. Keep the existing head guard, source-bound native verdict, posture, publication, queue mutation, recovery budget and Workroom compare-and-swap behavior. Do not write a foreign GitHub head into a re-adopted room to make scheduling progress.

Persisting the cursor before effects gives eventual sweep progress after a process interruption; it is not an exactly-once publication receipt. A crash can defer a selected room until the next sweep. Existing independent publication settlement controls remain responsible for lost responses. No source or authentication repair is smuggled into this fix.

A timestamp-only sort was rejected because failed and stale-head observations do not always write delivery timestamps, while generic drive writes are unrelated to polling. Enlarging the batch only moves the starvation threshold. The durable cursor substrate already exists and keeps each pass bounded without sorting private JSON or adding a database index.

## Acceptance criteria (verbatim)

- Repeated normal background updates cannot indefinitely prevent an otherwise eligible PR room from being observed.
- Regression fails on current source with more rooms than capacity within one drive interval; passes after correction and covers absent/legacy delivery states and stopped rooms.
- Selection stays bounded and deterministic; head mismatch, denied action, GitHub failure and compare-and-swap races remain safe and cannot become starvation loops.
- Required source tests/typecheck, independent review, ready DCO PR/merge queue and canonical live observation are recorded before completion.

All four criteria implement OBJ-1. This is one atomic repair: cursor selection without integration does not affect delivery, and integration without its regression and documentation is not a separately shippable outcome.

## Ordered implementation and verification

1. Preserve the executed source counterexample. Add a real reconciler regression with a stateful repository fixture that honors the actual query order/filter/limit, repeatedly rewrites generic timestamps and runs enough cycles to expose the current failure. Assert on observed room identities, not only a new helper export. Establish a meaningful failing test before product edits.
2. Add `apps/web/lib/queue/functions/build-pr-delivery-selection.ts` for the bounded cursor scan/claim, and its colocated test `apps/web/lib/queue/functions/build-pr-delivery-selection.test.ts`. Cover first use, restart, wrap, deleted cursor, more than 200 stopped rows, a capped page, absent/legacy state, a lost cursor CAS and cursor persistence failure. Existing stopped-state parsing remains authoritative.
3. Integrate into `apps/web/lib/queue/functions/build-pr-delivery-reconcile.ts`; retain and expand `apps/web/lib/queue/functions/build-pr-delivery-reconcile.test.ts`. Include stale head, quiet/denied actuation, GitHub failure and competing Workroom writes. No current room's generic head or status is changed merely to advance scanning.
4. Update `docs/architecture/build-gate-runbook.md` to explain the bounded cursor sweep. Regenerate `apps/web/lib/docs/doc-index.generated.json` only while its normal scope claim is held. Check rendered-document derivatives; no new diagram is planned.
5. Run related tests, web typecheck, Style Drift Guard and normal host preflight. `find_related_tests` returned the colocated reconciler test with ready source graph; the new helper gets colocated tests and an expanded affected gate. Resolve any missing test advice conservatively.
6. Freeze a clean signed commit; run canonical shared local-CI with the current source and current database, release its exact lease normally, obtain one normal independent assessment, validate its native receipt, record final immutable coverage, and open one ready PR. Protected checks/queue remain mandatory.
7. After the sole upgrade owner advances the canonical install normally, record the served SHA and verify an affected room receives a real `prDelivery` observation despite continuing drive updates. Assess native publication, actual PR merge and the original business outcomes separately. No completion from source merge alone.

## Risk and rollback

The blast radius is the existing PR job's choice of rooms, not its authority to act. Cursor corruption, concurrent job runs and stopped prefixes must fail safely or make bounded progress; tests cover those cases. New rooms behind the cursor wait for wrap. A finite eligible set completes a sweep in bounded successful runs; unbounded arrivals or repeated infrastructure failure cannot support a latency promise.

Rollback through a normal signed revert PR restores old selection. The job-local cursor is inert under old code and requires no destructive cleanup. No production row surgery or configuration-mode change is part of rollback.

## Backlog coverage

- Decision: atomic; one scheduler fairness repair for BI-A9F78411.
- Requirement reference: OBJ-1.
- Contract reference: PR-FOLLOWTHROUGH-POLL-SAFETY-NET.
- Flow reference: BOUNDED-CURSOR-SWEEP.
- Verification reference: REPEATED-DRIVE-FAIRNESS-REGRESSION.
- The four named references bind the objective, existing canonical polling contract, chosen scan flow and real repeated-cycle regression. Immutable live coverage must be recorded and checked before product implementation; this document does not claim that receipt yet.

Related deliveries remain distinct: BI-72679FE0 suppresses inactive-room dispatch but retains quiet snapshot writes; BI-ECA50241 owns correct native PR-head binding; BI-3A8F935B owns terminal delivery projection; BI-ED7CD0DD owns remaining webhook/repair slices; BI-2A8A8FC8 owns retained verdict publication. None is reopened or treated as delivered by this fix.
