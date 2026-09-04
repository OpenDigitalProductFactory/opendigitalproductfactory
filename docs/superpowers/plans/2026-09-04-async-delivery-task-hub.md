---
status: active
---

# Async completion and Workroom-aware delivery task hub implementation plan

**Backlog item:** `BI-05D7A0DC`  
**Workroom:** `WC-1D24739C`  
**Design:** [`2026-09-04-async-delivery-task-hub-design.md`](../specs/2026-09-04-async-delivery-task-hub-design.md)  
**Dependency:** `BI-801313EB` durable async lifecycle; integrate through one adapter seam and do not edit its persistence or queue registry.

## Outcome and delivery boundary

Replace the implementation-only live Workroom table with one bounded, live delivery hub on `/build/work`. One Workroom is one delivery row regardless of TaskRun/tool count. The row is event-updated, snapshot-reconciled, actionable, accessible, and backed only by canonical records. Durable transitions create one semantic notification.

**Coverage decision: atomic.** The read projection without a visible page, the page without event recovery, or notifications without semantic deep links do not independently deliver the operator outcome. They land in one PR and roll back together. Tests and files are phased for review, not separate release units.

## Phase 0 — immutable design and traceability

1. Commit this design and plan before production changes.
2. Record the exact source-research evidence: current `/build/work`, Workroom liveness/presenter/activity bus, TaskRun, Notification/attention bus, and parent delivery-rail design.
3. Obtain an independent review against the immutable design blob when the governed reviewer is available; preserve approval/failure/inconclusive receipts exactly.
4. Record one atomic `record_plan_backlog_coverage` receipt against this immutable plan, with the requirement/flow/contract/verification mapping below.

## Phase 1 — shared bounded projection (TDD)

Add:

- `apps/web/lib/work-capsules/delivery-task-hub.ts`
- `apps/web/lib/work-capsules/delivery-task-hub.test.ts`
- `apps/web/lib/work-capsules/delivery-task-hub-store.ts`
- `apps/web/lib/work-capsules/delivery-task-hub-store.test.ts`

Red first:

1. one row per Workroom across Ready/Working/Waiting/Needs attention/Complete;
2. failure/approval/expiry/conflict outrank optimistic work states;
3. progress payload is schema-, length-, and range-bounded;
4. only safe same-origin task routes and recorded HTTPS PR links are emitted;
5. stale/partial/conflicting sources never become success;
6. page size, 30-day window, `(updatedAt,id)` cursor, and five-activity include are fixed and validated;
7. a single-Workroom reload returns an upsert/remove projection without scanning the corpus;
8. the async core adapter may be absent without changing TaskRun truth.

Then implement the smallest pure projector and database adapter that make those tests pass. Refactor the legacy Workroom table's duplicate labels/grouping into the shared projector rather than maintaining two interpretations.

## Phase 2 — event-first list stream (TDD)

Add:

- `apps/web/app/api/work-capsules/delivery-stream/route.ts`
- `apps/web/app/api/work-capsules/delivery-stream/route.test.ts`
- `apps/web/lib/work-capsules/delivery-task-stream.ts`
- `apps/web/lib/work-capsules/delivery-task-stream.test.ts`

Red first:

1. unauthorized requests return 401 before opening a listener;
2. connect emits one bounded snapshot with observation cursor;
3. a valid Workroom activity notification causes a committed row reload and semantic upsert/remove;
4. duplicate/out-of-order activity cannot regress a newer row;
5. a database or subscription error emits an explicit partial/error state while confirmed content remains client-side;
6. abort/unmount releases the PostgreSQL listener;
7. no per-row subscriptions and no timer polling exist.

Use the existing activity `LISTEN/NOTIFY` channel only as a wake-up. Keep the source of truth in the bounded store query.

## Phase 3 — operator hub UX (TDD)

Add/refactor:

- `apps/web/components/build/work-control/DeliveryTaskHub.tsx`
- `apps/web/components/build/work-control/DeliveryTaskHub.test.tsx`
- `apps/web/components/build/work-control/WorkControlPanel.tsx`
- `apps/web/lib/actions/work-capsules.ts`
- `apps/web/app/(shell)/build/work/page.tsx`

Red first:

1. grouped overview and count strip render with one card per Workroom;
2. outcome, owner, stage, age, branch/PR, latest transition, progress, and next action/result are in the first disclosure level;
3. Inspect, Resume, Review, and Handoff links retain Workroom/task identity;
4. reconnecting keeps rows visible and labels freshness; partial/error does not render empty success;
5. true empty, loading, and no-more-results states have distinct copy;
6. focusable controls have complete accessible names and 44px targets;
7. narrow layout has no table or horizontal overflow dependency.

Use report-kit status/notice primitives and DPF CSS variables only. Keep create/adopt forms intact below the operational view.

## Phase 4 — exactly-once semantic notifications (TDD)

Add:

- `apps/web/lib/work-capsules/delivery-task-notifications.ts`
- `apps/web/lib/work-capsules/delivery-task-notifications.test.ts`

Integrate through the existing `runWorkroomDriveJob` reconciliation point; do not register another Inngest function and do not modify the async-core queue registry.

Red first:

1. completion, failure, approval/input attention, review attention, and takeover readiness map to semantic transitions;
2. progress-only and non-actionable waiting states produce none;
3. a transition already represented by any Notification row is never recreated after read/dismiss;
4. keys are Workroom + transition + durable source id/time, not display copy;
5. links are server-built `/build/work/<capsuleId>` destinations;
6. query window and `take` are fixed; notification failure is best effort and cannot fail the drive.

The implementation uses the existing Notification table and realtime attention bus. It must not create a delivery ledger.

## Phase 5 — validation, review, and delivery

1. Run focused projector/store/stream/component/notification tests and `apps/web` typecheck.
2. Run module-size, style, diff, route-budget, and affected blast-radius guards.
3. Produce `docs/ux-fit/2026-09-04-async-delivery-task-hub-ux-fit.json` with measured desktop/mobile, light/dark, keyboard/focus, overflow, loading/reconnect/partial/error, and route-budget evidence.
4. Run exact-tree semantic review and local CI when admitted. If either lane is occupied, unavailable, or underperforming, record it as **INCONCLUSIVE** with focused/typecheck/guard compensation; infer no PASS and keep protected CI mandatory.
5. DCO-sign the implementation commit, push normally, open one protected PR, and arm normal protected auto-merge only after readiness.
6. Require every protected PR and merge-group check. Publish one canonical release from the protected merge and perform one governed live upgrade.
7. Verify exact served SHA/CAN-TEST and authenticated `/build/work` acceptance: bounded initial page, event-first row update, reconnect reconciliation, semantic deep links, responsive/a11y states, and one deduplicated notification for a controlled durable transition.

## Atomic traceability

| Deliverable key | Requirements | Flows | Contracts | Verification |
| --- | --- | --- | --- | --- |
| `delivery-task-hub` | OBJ-DTH-001–OBJ-DTH-007; AC-DTH-001–AC-DTH-007 | `workroom-list→bounded-snapshot→event-upsert→reconnect-snapshot`; `durable-transition→dedupe→notification→semantic-link`; `inspect/resume/review/handoff→canonical-owner-surface` | Workroom identity, TaskRun status, Workroom activity bus, Notification/attention bus, async adapter seam, `view_platform` | pure projection/store/stream/notification tests; component/a11y tests; typecheck/guards; UX-fit; protected CI; exact-SHA live acceptance |

## Refactoring allocation

At least one fifth of implementation effort is reserved for touched-seam simplification:

- replace the legacy table's duplicate status/presentation rules with one shared projector;
- extract cursor/safe-link/progress parsing into small pure functions rather than component conditionals;
- keep one list subscription instead of N detail streams;
- centralize lifecycle-to-notification mapping and dedupe keys;
- remove superseded row/table code after parity tests pass.

No unrelated cleanup enters this PR.

## Rollback

Revert the page integration, stream, notification hook, and shared projection as one change. No migration or canonical record needs rollback. The previous Workroom table and detail route can be restored without changing stored Workrooms, TaskRuns, activities, or notifications.
