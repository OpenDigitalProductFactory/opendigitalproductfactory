---
status: active
---

# Async completion and Workroom-aware delivery task hub implementation plan

**Backlog item:** `BI-05D7A0DC`

**Workroom:** `WC-59101F34`

**Design:** [`2026-09-04-async-delivery-task-hub-design.md`](../specs/2026-09-04-async-delivery-task-hub-design.md)
**Dependency:** `BI-801313EB` durable async lifecycle; consume its authorized read API and published transition event. Register the narrow Task Hub projection consumer and the Workroom-to-TaskRun admission adapter required by the closed one-shot contract, without changing the async-operation schema or provider lifecycle.

## Outcome and delivery boundary

Replace the implementation-only live Workroom table with one bounded, live delivery hub on `/build/work`. One Workroom is one delivery row regardless of TaskRun/tool count. The row is event-updated, snapshot-reconciled, actionable, accessible, and backed only by canonical records. Durable transitions create one semantic notification.

**Coverage decision: atomic.** The read projection without a visible page, the page without event recovery, or notifications without semantic deep links do not independently deliver the operator outcome. They land in one PR and roll back together. Tests and files are phased for review, not separate release units.

## Backlog coverage

- Decision: atomic
- Parent: `BI-05D7A0DC`
- Rationale: The authorized read projection, live reconciliation, action destinations, and semantic notifications only deliver the promised operator outcome together and roll back as one unit.
- Dependencies: `BI-801313EB` supplies the durable async lifecycle consumed by this delivery.
- Receipt: `cmtnan2cu02zq01p5a1jlbg68`

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
8. the authorized async-core adapter reads both legal semantic scopes at `limit: 1`, exposes no provider/raw result material, and contains denial/unavailability per row without changing TaskRun truth;
9. signed cursors expire, and single-row reloads remove Workrooms outside the fixed 30-day window.

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
7. distinct pending row wakes remain memory-bounded and overflow repairs through a canonical snapshot without dropping durable transitions;
8. reconnect snapshots replace separately paged stale rows;
9. no per-row subscriptions and no timer polling exist.

Use the existing activity `LISTEN/NOTIFY` channel only as a wake-up. Keep the source of truth in the bounded store query.

## Phase 3 — operator hub UX (TDD)

Add/refactor:

- `apps/web/components/build/work-control/DeliveryTaskHub.tsx`
- `apps/web/components/build/work-control/DeliveryTaskHub.test.tsx`
- `apps/web/components/work-capsules/DeliveryTaskCard.tsx`
- `apps/web/lib/work-capsules/use-delivery-task-hub.ts`
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
- `apps/web/lib/queue/functions/async-operation-task-hub.ts`
- one narrow `eventFunctions` registration in `apps/web/lib/queue/functions/index.ts`

Keep the existing `runWorkroomDriveJob` reconciliation point for Workroom-owned approval, review, lease, and terminal facts. Add one standalone event-only consumer for `inference/async-operation.transitioned`; do not add a scheduler or modify the async-core worker functions.

Red first:

1. completion, failure, approval/input attention, review attention, and takeover readiness map to semantic transitions;
2. progress-only and non-actionable waiting states produce none;
3. a transition already represented by any Notification row is never recreated after read/dismiss;
4. keys are Workroom + transition + durable source id/time, not display copy;
5. links are server-built `/build/work/<capsuleId>` destinations;
6. query window and `take` are fixed; notification failure is best effort and cannot fail the drive;
7. the event payload supplies only `(operationId,sequence)` locators; status/checkpoint/time and Workroom/recipient are re-read from canonical server records;
8. identity-version-1 binding, exactly-one live TaskRun-linked Workroom, deterministic `WorkroomActivity`, SSE wake, and `async:<operationId>:<sequence>` notification keys are enforced;
9. pending/running/cancelled transitions update the row without attention, while completed/failed/expired and indeterminate-start transitions receive explicit semantic treatment.

The implementation uses the existing Notification table and realtime attention bus. It must not create a delivery ledger.

## Phase 4b — close the Workroom producer binding gap (TDD)

Extend only the routed durable admission boundary for `background.mcp-durable-inference-one-shot`:

1. reproduce the live failure where an authorized Workroom request creates an operation that the worker refuses with `DURABLE_INFERENCE_TASKRUN_BINDING_MISSING`;
2. authorize the Workroom first, then create/replay a deterministic server-owned TaskRun and link it to that Workroom;
3. defer the operation wake, persist the exact operation id into TaskRun progress by compare-and-swap, and enqueue only afterward;
4. prove an identical request reuses the same TaskRun and operation;
5. prove missing human attribution, forged or unauthorized Workrooms, request/metadata drift, conflicting Workroom TaskRun linkage, and operation-id drift fail before provider dispatch; and
6. keep non-TaskRun contract families on the existing direct Workroom path.

No new schema, queue, notification ledger, or provider retry path is introduced. The existing async-operation lease/fence and transition consumers remain authoritative.

## Phase 5 — validation, review, and delivery

1. Run focused projector/store/stream/component/notification tests and `apps/web` typecheck.
2. Run module-size, style, diff, route-budget, and affected blast-radius guards.
3. Produce `docs/ux-fit/2026-09-04-async-delivery-task-hub.ux-fit.json` with measured desktop/mobile, light/dark, keyboard/focus, overflow, loading/reconnect/partial/error, and route-budget evidence.
4. Run exact-tree semantic review and local CI when admitted. If either lane is occupied, unavailable, or underperforming, record it as **INCONCLUSIVE** with focused/typecheck/guard compensation; infer no PASS and keep protected CI mandatory.
5. DCO-sign the implementation commit, push normally, open one protected PR, and arm normal protected auto-merge only after readiness.
6. Require every protected PR and merge-group check, publish exactly one canonical release for the protected merge, and use exactly one governed live-upgrade action after publisher and quiescence prechecks.
7. After exact served-SHA/CAN-TEST proof, run one Workroom-bound closed-contract admission. Record the server-owned Workroom/TaskRun/operation binding, terminal transition, exactly one Workroom activity and one notification, then replay that same terminal consumer once and prove both counts remain one.

## Atomic traceability

| Deliverable key | Requirements | Flows | Contracts | Verification |
| --- | --- | --- | --- | --- |
| `delivery-task-hub` | OBJ-DTH-001, OBJ-DTH-002, OBJ-DTH-003, OBJ-DTH-004, OBJ-DTH-005, OBJ-DTH-006, OBJ-DTH-007; AC-DTH-001, AC-DTH-002, AC-DTH-003, AC-DTH-004, AC-DTH-005, AC-DTH-006, AC-DTH-007 | `authorized-Workroom-request→server-owned-TaskRun→deferred-operation-admission→durable-TaskRun-projection→provider-wake`; `workroom-list→bounded-snapshot→event-upsert→reconnect-snapshot`; `inference/async-operation.transitioned→canonical-transition-read→bounded-server-owned-Workroom-wake→deduplicated-semantic-notification`; `inspect/resume/review/handoff→canonical-owner-surface` | Workroom identity, canonical TaskRun binding, authorized async-operation read model, canonical async transition and binding, existing Workroom activity ledger/bus, Notification/attention bus, `view_platform` | admission ordering/idempotency/authorization tests; pure projection/store/stream/notification/transition-consumer tests; component/a11y tests; typecheck/guards; UX-fit; protected CI; live 1-activity/1-notification replay proof |

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
