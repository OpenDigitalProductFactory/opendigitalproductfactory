---
status: draft
---

# Durable asynchronous MCP operation resume contract

**Backlog item:** BI-801313EB
**Epic:** EP-56AE0F69
**Status:** design candidate (no implementation claim)

## Problem

DPF already persists `AsyncInferenceOp`, supports background interaction mode, and emits async progress events. The remaining gap is operational: a long-running MCP operation can outlive the process that started it, while the caller still has to poll and reconstruct state. This creates duplicate starts, retry storms, lost progress, and ambiguous terminal results.

## Objectives and acceptance criteria

- **OBJ-ASYNC-00:** **Typed start boundary:** an accepted provider operation crosses the adapter, inference, and fallback layers as an explicit typed handle so the platform can persist its own tracking identity without inspecting provider-specific raw payloads.
- **OBJ-ASYNC-01:** **Stable identity:** one logical request has one server-owned operation identity; retried starts return the existing operation rather than creating a sibling.
- **OBJ-ASYNC-02:** **Durable resume:** a process restart or worker handoff resumes from the last persisted checkpoint without replaying completed side effects.
- **OBJ-ASYNC-03:** **Truthful lifecycle:** the closed `AsyncInferenceOperationStatus` set (`pending`, `start_indeterminate`, `running`, `completed`, `failed`, `cancelled`, `expired`) is persisted with bounded timestamps and auditable transitions.
- **OBJ-ASYNC-04:** **Observable progress:** progress and terminal events are emitted from durable transitions; consumers can reconcile with a cursor-bounded read instead of tight polling.
- **OBJ-ASYNC-05:** **Provenance:** final results retain provider/model/operation identity, request digest, and completion/error metadata.

The implementation is accepted only when:

| ID | Objective | Acceptance criterion | Evidence |
| --- | --- | --- | --- |
| AC-ASYNC-00 | OBJ-ASYNC-00 | A successful async adapter start exposes one typed provider-owned operation handle through `AdapterResult`, `InferenceResult`, and `FallbackResult`; routed inference persists the corresponding platform `AsyncInferenceOp`. Sync results expose no async handle, raw provider metadata is never treated as operation authority, and a provider without an explicit long-running-operation response contract is rejected before dispatch. | Focused propagation/regression tests + typecheck + protected CI |
| AC-ASYNC-01 | OBJ-ASYNC-01 | Before any provider-start POST, the platform resolves an authorized server-owned TaskRun/workroom binding, create-or-replays the durable operation by that scope and request key, and lets the worker acquire a compare-and-swap start claim. A matching replay returns the same platform operation ID without dispatch; digest, binding, or scope drift fails closed. | Vitest integration and concurrency tests + protected CI |
| AC-ASYNC-02 | OBJ-ASYNC-02 | The worker is the sole owner of provider start and poll side effects under a fenced lease. Restart/resume continues one pending or running operation from its persisted checkpoint, while a stale owner cannot advance it or repeat a completed side effect. | Failure-injection and lease-fencing tests + protected CI |
| AC-ASYNC-03 | OBJ-ASYNC-03 | Provider transient polling failure retries with bounded backoff. If a provider-start POST may have crossed the boundary but no typed handle was durably recorded, the operation enters `start_indeterminate` and no code path repeats that POST; only exact provider reconciliation may advance it. Permanent failure, cancellation, and expiry are terminal and idempotent. Only the canonical status enum is accepted at storage, transition, event, and read boundaries; unknown values fail closed. | Lifecycle, crash-window, and status-parser matrix tests |
| AC-ASYNC-04 | OBJ-ASYNC-04 | Event delivery is at-least-once and deduplicated by operation transition; reconciliation is cursor-bounded and authorized through the operation's exact TaskRun or Workroom scope. A bare operation ID never grants read access. Every outbox/webhook payload carries `status: AsyncInferenceOperationStatus`, never a free string. | Event-schema/event-bus/authorization/read-model tests |
| AC-ASYNC-05 | OBJ-ASYNC-05 | Sync interaction mode remains behaviorally unchanged and authorized async results are retrievable through their TaskRun/workroom scope with exact provider and request provenance. | Regression tests + typecheck/build |

## Scope and non-goals

Extend the existing `AsyncInferenceOp`, `TaskRun`, Workroom authority, Inngest, and agent event bus. Do not add a parallel task ledger, replace MCP Tasks, or introduce a second provider-operation table. Foundation BI-2B619BC9 first repairs the typed provider-start boundary already expected by `AsyncInferenceOp`; it supports Gemini's explicit Interactions create/get contract and fails closed for generic chat-completion providers until they define their own asynchronous protocol. The first functional BI-801313EB delivery slice then moves provider start behind durable identity/checkpoint/resume and a server-triggered worker. Once a request uses this durable path, the request process may admit and enqueue it but may not call the provider directly. The foundation may merge independently because it restores the existing tracking path without exposing a new consumer capability, but it does not satisfy BI-801313EB's lifecycle acceptance or permit a completion claim. Notification UX is a dependent BI (BI-05D7A0DC).

## Proposed contract

1. Carry the provider's accepted-operation handle through a typed `AsyncOperationStartResult`. The provider handle and platform `AsyncInferenceOp.id` remain distinct identities; no downstream layer recovers authority from `raw` metadata.
2. Bind a server-owned logical request key to exactly one authorized TaskRun or Workroom scope and compute a canonical request digest from provider, model, contract family, normalized screened request context, and that immutable binding. A client-supplied scope string, operation ID, or request key is never authority by itself.
3. Before any provider-start POST, create-or-replay `AsyncInferenceOp` by `(authority scope, request key)`. Return the existing operation only when the stored digest and binding match; reject payload or scope drift, and never globally deduplicate equal content submitted by different callers.
4. Persist checkpoint sequence, start-claim state, and fenced lease ownership on the operation. The worker claims the provider-start step with CAS before crossing the network boundary and heartbeats progress; a stale owner cannot start, poll, or transition the operation.
5. The worker is the sole owner of provider start and polling. A retry may re-read an already identified provider operation, but it cannot create a second provider operation for the same logical request. If a start request may have reached the provider but the typed handle was not durably recorded, persist `start_indeterminate` and prohibit another start POST.
6. Define one shared closed `AsyncInferenceOperationStatus` enum: `pending | start_indeterminate | running | completed | failed | cancelled | expired`. `pending`, `start_indeterminate`, and `running` are non-terminal; the remaining values are terminal. Persist a monotonic transition/outbox record in the same transaction as each durable state change, then emit it with the canonical enum value. Storage adapters, webhook/event parsers, and read models reject unknown values rather than widening them to `string`. Consumers use `(operationId, sequence)` plus a cursor-bounded reconciliation query; notification transport is advisory.
7. Enforce `expiresAt` and cancellation before each provider call and transition exactly once to a terminal state.

`start_indeterminate` is a reconciliation hold, not a retry state. It can move only to `running`, `failed`, `cancelled`, or `expired` after exact provider reconciliation and never authorizes another provider-start POST. Existing persisted values are migrated with an expand/backfill/validate/contract sequence; an unknown legacy value aborts the contract step and is ledgered rather than coerced.

### Authority and side-effect boundary

The durable path has one required ordering. Reordering these steps is a contract violation:

1. Resolve the authenticated caller against existing durable records and derive an immutable server-owned binding to exactly one TaskRun or Workroom. The caller must be authorized for that scope; ordinary client input cannot manufacture or widen it.
2. Normalize and screen the provider request, then compute its canonical digest together with the provider, model, contract family, and immutable authority binding. Persist no credentials or unscreened request payload.
3. In a database transaction, create the platform operation or replay the existing `(authority scope, request key)` row. A matching replay returns that row without provider dispatch; a digest or binding mismatch is an identity conflict.
4. Enqueue only the platform operation ID. The admitting request returns that ID and does not perform the provider start.
5. The worker acquires the operation's fenced CAS start claim. Without the current claim and lease it may perform no provider side effect.
6. The owning worker performs the provider-start POST and durably records the typed provider handle with the `running` transition before later polling.
7. If the worker crashes, times out, or loses its lease after the POST may have crossed the boundary but before the handle commits, the operation becomes `start_indeterminate`. No worker or request path may repeat the POST. Only an exact provider-supported reconciliation can recover the handle; otherwise cancellation, expiry, or explicit failure ends the operation.
8. The owning worker polls or resumes by the recorded provider handle and persists checkpoints and transitions monotonically.
9. Reads and reconciliation resolve authorization through the bound TaskRun or Workroom and use bounded cursors. Possession of a bare platform or provider operation ID never authorizes a read.

### Canonical lifecycle status type

The implementation owns this single shared contract; no storage, event, webhook, read-model, or UI layer may redeclare `status` as a free string:

```ts
export const ASYNC_INFERENCE_OPERATION_STATUSES = [
  "pending",
  "start_indeterminate",
  "running",
  "completed",
  "failed",
  "cancelled",
  "expired",
] as const;

export type AsyncInferenceOperationStatus =
  (typeof ASYNC_INFERENCE_OPERATION_STATUSES)[number];
```

The database constraint and every boundary parser accept exactly those serialized values. Provider-owned status text remains untrusted input and is normalized into this contract only by the provider adapter; it is never copied directly into platform lifecycle state.

## Research & Benchmarking

- [Temporal durable execution](https://docs.temporal.io/) provides crash-proof workflow history, signals, timers, and activity retries. DPF adopts durable checkpoints and typed signals, but keeps Postgres `AsyncInferenceOp` and Inngest rather than adding a second workflow service.
- [AWS Step Functions Standard Workflows](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html) provide exactly-once state transitions for non-idempotent work. DPF adopts the explicit terminal-state model, while retaining idempotent application-level writes because provider APIs vary.
- [Inngest durable functions](https://www.inngest.com/docs/learn/inngest-functions) checkpoint steps and retry from the last successful step. DPF adopts event-triggered wake/resume and bounded retries, with operation identity owned by the existing database model.

## Architecture and safety

- **Single source of truth:** `AsyncInferenceOp` owns operation lifecycle; `TaskRun` remains the agent/task projection; the event bus is delivery, not storage.
- **Authority boundary:** the binding is derived from authenticated, durable TaskRun/Workroom ownership and stored with the operation before enqueue. Request bodies, provider metadata, and operation IDs are references, not authority.
- **Side-effect ownership:** admission performs durable create-or-replay only; the fenced worker alone may start and poll the provider. Transition/outbox state is committed before advisory emission.
- **Scale ceiling:** cursor-bounded reads and per-operation CAS are O(1) per transition; the first slice supports thousands of concurrent operations on existing indexes. A future sharded event/read-model epic is required before millions of operations.
- **Failure posture:** unknown provider status, missing checkpoints, conflicting digests, lease loss, or an ambiguous provider-start timeout without provider idempotency fail closed to resumable/reconciliation states; no inferred completion and no blind repeat POST.
- **Typed projection:** database/generated types, transition helpers, event payloads, cursor reads, and operator UI import the same lifecycle contract. The UI renders an explicit unknown/error state if validation fails; it never maps an unknown value to `pending`.
- **Rollback:** disable the async worker trigger and continue serving authorized persisted terminal results; schema changes are additive and forward-compatible. Pending operations remain truthfully pending, and rollback must not restore a request-path fallback that starts providers directly.
