---
status: active
---

# Async completion and Workroom-aware delivery task hub

- **Backlog item:** `BI-05D7A0DC`
- **Workroom:** `WC-1D24739C`
- **Profile:** feature
- **Parent design:** [`2026-09-03-local-first-agentic-delivery-throughput-design.md`](2026-09-03-local-first-agentic-delivery-throughput-design.md), especially §§6–7
- **Dependency:** `BI-801313EB` supplies the durable async-operation lifecycle; this slice consumes its public projection without owning that persistence.

## Problem

Long-running delivery work already has durable source records, but the operator still has to reconstruct its state from Workroom, TaskRun, branch, PR, activity, and notification surfaces. The current `/build/work` page lists only live Workrooms in a wide implementation-oriented table. It does not answer the operator's immediate questions: what outcome is moving, who owns the next move, whether it is working or waiting, what changed, and where to act.

The missing surface also makes async execution feel synchronous. A caller can leave a long-running operation, but completion, failure, approval, expiry, or takeover readiness is not projected back as one semantic, deduplicated event with a stable Workroom deep link. Operators either poll or revisit several pages. Both behaviors waste attention and provider capacity.

## Existing substrate and ownership boundary

This feature is a read model and notification projection over existing authority. It introduces no parallel task ledger, lifecycle, or schema.

| Concern | Canonical owner | This slice |
| --- | --- | --- |
| Delivery identity and branch | `Workroom` | Project one row/card per Workroom. |
| Long-running execution | `TaskRun` and the async-operation contract from `BI-801313EB` | Read current state and expose one narrow adapter seam for the durable async handle. |
| Progress and transitions | `WorkroomActivity`, `TaskRun.progressPayload`, Workroom event bus | Select bounded source facts, preserve freshness, and stream semantic row invalidations. |
| Human attention | `Notification` plus the attention realtime bus | Emit one deduplicated semantic notification for a durable actionable/terminal transition. |
| Branch and review navigation | Workroom branch/PR fields | Render secure same-origin or validated provider links; never reconstruct Git authority. |

`BI-801313EB` owns operation persistence, resume/cancel semantics, and queue integration. This slice does not modify its schema, Inngest registration, or inference workers. Until its public query contract is present, the hub reads Workroom's currently linked TaskRun and exposes one typed `asyncOperation` projection seam. Integrating a richer core handle later replaces only that adapter, not the page or notification model.

## Objectives

**OBJ-DTH-001:** One operator view shows one stable delivery summary per Workroom, grouped into Ready, Working, Waiting, Needs attention, and Complete.

**OBJ-DTH-002:** Each summary states the outcome, accountable owner, current stage, age, branch/PR, latest meaningful transition, and blocker/next action or verified result without exposing private reasoning.

**OBJ-DTH-003:** Updates are event-first through one list-level subscription and recover missed events through bounded snapshot reconciliation; inactive consumers cancel the subscription and no tight polling is introduced.

**OBJ-DTH-004:** Completion, failure, expiry, review attention, and takeover readiness produce one deduplicated operator notification with a semantic Workroom deep link.

**OBJ-DTH-005:** Queries are cursor- and time-bounded, projection conflicts remain visibly stale/partial, and absence never becomes success.

**OBJ-DTH-006:** The task hub works at narrow and wide widths, by keyboard and screen reader, in light and dark themes, with honest loading, reconnecting, stale, partial, empty, and error states.

**OBJ-DTH-007:** The implementation reduces duplicate Workroom presentation logic by moving grouping, status, progress, deep-link, and freshness rules into a tested shared projection rather than expanding the legacy table component.

## Read model

### Bounded source selection

The list request uses a server-owned observation window and opaque cursor. The default page is 40 Workrooms updated in the previous 30 days, ordered by `(updatedAt DESC, id DESC)`, with one extra row only to determine `nextCursor`. A caller may request an older page only with the returned cursor; it cannot widen the time horizon or page limit.

For selected Workrooms, the database returns only:

- Workroom identity, outcome, status, owner/executor, branch, PR, lease, scope, timestamps, and linked record ids;
- the linked TaskRun's status, route, sanitized progress payload, and transition timestamps;
- the latest five Workroom activities, newest first, which are enough to select the latest meaningful transition while avoiding a timeline scan;
- the latest runtime verification when one exists.

The detailed route remains the place for the full evidence timeline. Tool executions never become hub cards.

### Projection contract

A `DeliveryTaskHubRow` has these stable facts:

- Workroom id, title/outcome, owner label, stage label, group, and status intent;
- source state and observed timestamp for Workroom and TaskRun;
- latest meaningful transition and relative-age input;
- bounded progress (`percent`, `completed`, `total`, or short summary only when schema-valid);
- branch, PR, and backlog identifiers;
- one primary semantic action and secondary inspect/handoff links;
- freshness `fresh | stale | partial` plus a human-readable reason;
- optional async-operation handle projection owned by the core adapter seam.

The group is deterministic and fail closed:

1. `Needs attention`: Workroom blocked/stalled/expired, TaskRun failed/rejected/auth-required, a live approval/input wait, or conflicting source states.
2. `Waiting`: TaskRun input-required for non-error input, submitted/queued/durable-wait, or a Workroom ready for review/promotion.
3. `Working`: active TaskRun/work/verification.
4. `Complete`: terminal Workroom with affirmative terminal evidence; failure never maps here.
5. `Ready`: admitted/claimed work without an active run.

Within a page, source order is retained while a Workroom is active so an event cannot move the row under the pointer. Durable priority changes may change group on the next snapshot; the row id remains stable.

### Progress and evidence safety

Only whitelisted scalar keys are read from `progressPayload`: `summary`, `message`, `current`, `completed`, `total`, `percent`, `waitReason`, `error`, and `nextAction`. Strings are trimmed and length-bounded; numeric progress is clamped and accepted only when finite. No arbitrary JSON, prompts, model reasoning, credentials, filesystem paths, or tool arguments reach the list view.

Unknown or contradictory payloads are ignored and the row is marked partial rather than guessed. A completed TaskRun beside a nonterminal Workroom is partial/stale until the Workroom transition catches up; it is not projected as verified delivery.

## Event and reconciliation protocol

The list uses one authenticated SSE endpoint, not one stream per Workroom.

1. On connect, the server emits a bounded `snapshot` with rows, observation time, and opaque next cursor.
2. The endpoint subscribes to the existing PostgreSQL Workroom activity channel.
3. A valid activity event triggers a bounded single-Workroom reload and emits `upsert` or `remove`; replaceable progress is naturally coalesced because the committed row is re-read instead of forwarding raw events.
4. Approval, ownership, lifecycle, failure, and terminal facts are not coalesced out; each source transition remains in the Workroom timeline and the projected row changes monotonically.
5. Existing SSE heartbeats drive zombie detection. Reconnect is floored by `useResilientEventSource`; every reconnect receives a fresh bounded snapshot, repairing missed notifications without a polling loop.
6. Abort closes the database listener. A hidden/unmounted task hub has no subscription.

The cursor is an opaque base64url payload carrying only `(updatedAt,id,windowStart)` and is validated server-side. Invalid cursors fail with a bounded 400 response. SSE accepts only the first page; older pages are fetched explicitly, not kept live.

## Notification contract

Notification generation is a bounded reconciliation over recently transitioned Workrooms, invoked from the existing standing Workroom drive rather than registered as another scheduler. It uses `Notification` and the attention realtime bus; no delivery-notification table is created.

Each semantic transition gets a stable item key:

`<capsuleId>:<transition-kind>:<source-record-id-or-transition-time>`

The full `Notification.type` is the idempotency key. The producer checks for any prior row of that type, including read notifications, before writing, so reconciliation cannot recreate a dismissed/read transition. The transition kinds are:

- `completed` and `failed`;
- `approval-required` and actionable `input-required`;
- `lease-expired` / takeover-ready;
- `review-required`.

The body includes the outcome and next action, not raw evidence. The deep link is `/build/work/<capsuleId>` with an optional semantic fragment such as `#handoff` or `#review`; the notification never trusts a payload-supplied URL. Only recent durable transitions inside the bounded reconciliation window are candidates, preventing a first deployment from notifying years of history.

## Operator experience

The existing `/build/work` information architecture stays canonical. Its live Workrooms section becomes **Delivery task hub**:

- a compact summary strip shows active, waiting, attention, and completed counts;
- grouped cards replace the wide implementation table at ordinary widths;
- the first screen shows outcome, owner, stage, age, branch/PR, and next action/result;
- technical ids and evidence are secondary but selectable/copyable;
- `Inspect` opens the canonical Workroom detail; route-aware `Resume` opens a validated same-origin task route; `Handoff` opens the same Workroom's handoff section, preserving identity;
- current content remains visible during reconnect and receives a stale/reconnecting notice rather than flashing to empty;
- empty means “No delivery Workrooms in this window,” not success;
- mobile is a single column with minimum 44px controls; wide layouts use balanced two-column groups; no horizontal page scroll is required.

The create/adopt controls remain below the operational overview and preserve their existing authorization.

## Failure and security boundaries

- The endpoint requires `view_platform`; notification generation resolves the installation operator and never accepts a recipient from the browser.
- Route context is accepted only as a normalized internal path. PR URLs must be HTTPS and belong to the Workroom's recorded repository provider; otherwise only the Workroom detail link is shown.
- An event is a wake-up, never authority. The endpoint re-reads committed source records before emitting.
- Database/listener/provider failure marks the view partial or reconnecting. It never clears confirmed rows or emits completion.
- A missing TaskRun is a valid Workroom state and remains Ready/Working according to Workroom facts; it is not an error.
- Duplicate/out-of-order activity events are harmless because upserts are keyed by Workroom and carry observed timestamps; older row updates are ignored client-side.
- The core async adapter may be absent. The hub shows the existing TaskRun lifecycle and an explicit `coreHandleAvailable=false`; it does not invent resume/cancel authority.

## Acceptance mapping

| Acceptance | Objective(s) | Verification |
| --- | --- | --- |
| AC-DTH-001 | OBJ-DTH-001, OBJ-DTH-002 | Pure projection tests cover every group, owner/stage/progress, branch/PR, latest transition, and stable Workroom identity. |
| AC-DTH-002 | OBJ-DTH-003, OBJ-DTH-005 | Store tests prove fixed `take`, server-owned time window, cursor validation/order, bounded activity include, snapshot/upsert/remove, stale-event rejection, and listener cleanup. |
| AC-DTH-003 | OBJ-DTH-004 | Notification tests prove exactly-once behavior across reruns and read/dismiss state, semantic deep links, bounded recency, and no progress-only notification. |
| AC-DTH-004 | OBJ-DTH-001, OBJ-DTH-002, OBJ-DTH-006 | Component tests cover grouped rows, loading/reconnecting/partial/empty/error, semantic actions, accessible names, and retained confirmed content. |
| AC-DTH-005 | OBJ-DTH-006 | Measured UX-fit manifest covers desktop/mobile, light/dark, keyboard/focus, overflow, and route budget. |
| AC-DTH-006 | OBJ-DTH-007 | Legacy Workroom grouping/presentation is removed from the table and shared by page, stream, and notifications; module-size and duplication guards pass. |
| AC-DTH-007 | OBJ-DTH-001–OBJ-DTH-007 | DCO, protected PR/merge-group checks, canonical release, exact-SHA live readiness, and authenticated live hub/reconnect/notification acceptance pass. |

## Rollback

Revert the task-hub page integration, global list stream, notification reconciliation hook, and pure projection together. Canonical Workroom, TaskRun, activity, notification, and async-operation records remain untouched. The existing Workroom detail and create/adopt flows continue to work because this feature changes no write contract or schema.
