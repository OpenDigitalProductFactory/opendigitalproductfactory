---
status: active
---

# Async completion and Workroom-aware delivery task hub

- **Backlog item:** `BI-05D7A0DC`
- **Workroom:** `WC-59101F34`
- **Profile:** feature
- **Parent design:** [`2026-09-03-local-first-agentic-delivery-throughput-design.md`](2026-09-03-local-first-agentic-delivery-throughput-design.md), especially §§6–7
- **Dependency:** `BI-801313EB` supplies the durable async-operation lifecycle. This slice consumes its public projection and owns the narrow Workroom-to-TaskRun admission adapter required for Task Hub delivery; the core operation schema, provider worker, and transition state machine remain unchanged.

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

`BI-801313EB` owns operation persistence, resume/cancel semantics, and worker integration. This slice does not modify its schema or provider state machine. It consumes the core's authorized `listPrismaAuthorizedAsyncOperations` query through public TaskRun/Workroom identities and adds one narrow consumer for the core's already-published `inference/async-operation.transitioned` event. The consumer is a projection accelerator only: it re-reads the canonical transition and server-owned binding before changing the existing Workroom/Notification projections.

This task-hub slice neither defines nor replaces a queue, worker, retry policy, or dead-letter mechanism. Those reliability and idempotency contracts remain entirely in the async-operation core; the hub consumes only its authorized read model alongside existing Workroom facts.

### Live acceptance repair: Workroom-backed TaskRun admission

Live acceptance found a producer-side contract gap rather than a Task Hub consumer defect. A server-authorized Workroom request could admit the closed `background.mcp-durable-inference-one-shot` contract directly against `Workroom`. The generic row was durable, but the closed worker correctly refused it with `DURABLE_INFERENCE_TASKRUN_BINDING_MISSING`; no terminal transition therefore existed for Task Hub to deliver.

For that one closed contract family, the production admission boundary must bridge a Workroom authority to a canonical TaskRun before provider dispatch:

1. authorize the public Workroom and actor against committed server records;
2. derive one server-owned TaskRun identity from the authorized internal Workroom identity plus immutable request key and digest;
3. atomically create or replay that TaskRun and link the Workroom only when no conflicting TaskRun is already linked;
4. admit the async operation against the canonical TaskRun with its first wake deferred;
5. compare-and-swap the exact operation id into TaskRun durable progress; and
6. enqueue the first provider wake only after that projection is durable.

The bridge never trusts a caller-supplied TaskRun id. Missing human attribution, malformed immutable identity, authorization denial, conflicting Workroom linkage, metadata drift, or operation-id drift fails before dispatch. Replays must reuse the same TaskRun and operation; advisory duplicate wakes remain harmless under the core's existing leases and fences. Other Workroom-bound async contract families keep the generic Workroom binding and are unaffected.

## Research and alternatives

The shape was selected after comparing three established operator patterns and the browser delivery standard.

| Reference | Useful pattern | What DPF adopts | What DPF rejects |
| --- | --- | --- | --- |
| [Temporal Web UI](https://github.com/temporalio/documentation/blob/main/docs/web-ui.mdx) | A bounded execution list opens into compact or full event history, pending activities, workers, relationships, metadata, and governed actions. | Separate the compact Workroom shell from its paged evidence timeline; keep durable execution identity and explicit pending state. | A second workflow visibility store. DPF already has Workroom/TaskRun and must not mirror them into a task-hub ledger. |
| [GitHub Actions run monitoring](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs) and [`workflow_run` events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run) | The run list distinguishes requested, in-progress, and completed state; detailed checks/logs remain behind a run link; lifecycle events drive downstream handling. | Project a small status/result shell, deep-link to authoritative detail, and respond to durable lifecycle events rather than polling logs. | Presenting each check/job/tool execution as separate operator work or treating an event payload as final authority. |
| [Linear Inbox](https://linear.app/docs/inbox) and [notifications](https://linear.app/docs/notifications) | Subscribed ownership/status changes create actionable inbox items with keyboard navigation, snooze/dismiss semantics, and deep links to the owning issue. | Notify only meaningful delivery transitions, deduplicate by durable source identity, and preserve a semantic Workroom destination. | A notification for every activity/progress update, or a notification row that becomes the delivery source of truth. |
| [WHATWG Server-Sent Events](https://html.spec.whatwg.org/dev/server-sent-events.html) | `EventSource` provides authenticated HTTP server push, event ids, and automatic reconnect behavior. | One list-level stream, named semantic events, heartbeats, bounded reconnect snapshot, and explicit cancellation. | Tight status polling, one connection per row, or trusting `Last-Event-ID`/cursor data without authorization and validation. |

Two alternatives were rejected:

1. **A new async-task table and dashboard.** It would duplicate Workroom and TaskRun identity, eventually disagree about completion, and add another closeout process.
2. **Client polling over the existing Workroom table.** It is superficially small but makes every browser repeatedly scan the same state, delays completion attention, and has no exact notification identity.

The selected hybrid—canonical Workroom read model, event-first wake-up, bounded snapshot reconciliation, and semantic notification—matches the parent delivery-rail decision while adopting the compact-shell/detail split seen in the comparable implementations.

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

Notification generation has two bounded inputs. The existing standing Workroom drive reconciles Workroom-owned approval, review, lease, and completion facts without another scheduler. A standalone, event-only Inngest consumer handles the core's `inference/async-operation.transitioned` event: `(operationId, sequence)` is only a locator, the canonical transition and identity-version-1 binding are re-read, TaskRun-to-Workroom cardinality fails closed unless exactly one live Workroom exists, and one deterministic existing-ledger `WorkroomActivity` is persisted before its SSE wake. Both paths use `Notification` and the attention realtime bus; no delivery-notification table is created.

Each semantic transition gets a stable item key:

`<capsuleId>:<transition-kind>:<source-record-id-or-transition-time>`

The full `Notification.type` is the idempotency key. The producer checks for any prior row of that type, including read notifications, before writing, so reconciliation cannot recreate a dismissed/read transition. The transition kinds are:

- `completed` and `failed`;
- async `expired` and `reconciliation-required` (`start_indeterminate`);
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
- The core async adapter returns only a per-row authorized platform handle, canonical status, bounded progress, and observation time. A denied, absent, malformed, or unavailable scope projects `coreHandleAvailable=false`; it does not fail the page, reveal another scope, or invent resume/cancel authority.

## Acceptance mapping

| Acceptance | Objective(s) | Verification |
| --- | --- | --- |
| AC-DTH-001 | OBJ-DTH-001, OBJ-DTH-002 | Pure projection tests cover every group, owner/stage/progress, branch/PR, latest transition, and stable Workroom identity. |
| AC-DTH-002 | OBJ-DTH-003, OBJ-DTH-005 | Store tests prove fixed `take`, server-owned time window, cursor validation/order, bounded activity include, snapshot/upsert/remove, stale-event rejection, and listener cleanup. |
| AC-DTH-003 | OBJ-DTH-004 | Admission and event-consumer tests prove the closed TaskRun contract creates/replays one server-owned Workroom-linked TaskRun before first wake, canonical `(operationId,sequence)` re-read, deterministic existing-ledger activity and dedupe identity, fail-closed Workroom resolution, semantic deep links, bounded recency, and no progress-only notification. |
| AC-DTH-004 | OBJ-DTH-001, OBJ-DTH-002, OBJ-DTH-006 | Component tests cover grouped rows, loading/reconnecting/partial/empty/error, semantic actions, accessible names, and retained confirmed content. |
| AC-DTH-005 | OBJ-DTH-006 | Measured UX-fit manifest covers desktop/mobile, light/dark, keyboard/focus, overflow, and route budget. |
| AC-DTH-006 | OBJ-DTH-007 | Legacy Workroom grouping/presentation is removed from the table and shared by page, stream, and notifications; module-size and duplication guards pass. |
| AC-DTH-007 | OBJ-DTH-001, OBJ-DTH-002, OBJ-DTH-003, OBJ-DTH-004, OBJ-DTH-005, OBJ-DTH-006, OBJ-DTH-007 | DCO, protected PR/merge-group checks, and exact-head readiness evidence pass. Release, deployment, and live-install acceptance are explicitly outside this delivery task. |

## Rollback

Revert the task-hub page integration, global list stream, notification reconciliation hook, and pure projection together. Canonical Workroom, TaskRun, activity, notification, and async-operation records remain untouched. The existing Workroom detail and create/adopt flows continue to work because this feature changes no write contract or schema.
