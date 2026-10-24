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
- **OBJ-ASYNC-06:** **Production caller:** an explicitly selected, server-authorized one-shot inference recipe can enter through MCP `tasks/submit`, return one durable `TaskRun`, and complete through the durable async-operation lifecycle without keeping the request open or granting authority through a provider/platform operation ID.

The implementation is accepted only when:

| ID | Objective | Acceptance criterion | Evidence |
| --- | --- | --- | --- |
| AC-ASYNC-00 | OBJ-ASYNC-00 | A successful async adapter start exposes one typed provider-owned operation handle through `AdapterResult`, `InferenceResult`, and `FallbackResult`; routed inference persists the corresponding platform `AsyncInferenceOp`. Sync results expose no async handle, raw provider metadata is never treated as operation authority, and a provider without an explicit long-running-operation response contract is rejected before dispatch. | Focused propagation/regression tests + typecheck + protected CI |
| AC-ASYNC-01 | OBJ-ASYNC-01 | Before any provider-start POST, the platform resolves an authorized server-owned TaskRun/workroom binding, create-or-replays the durable operation by that scope and request key, and lets the worker acquire a compare-and-swap start claim. A matching replay returns the same platform operation ID without dispatch; digest, binding, or scope drift fails closed. | Vitest integration and concurrency tests + protected CI |
| AC-ASYNC-02 | OBJ-ASYNC-02 | The worker is the sole owner of provider start and poll side effects under a fenced lease. Restart/resume continues one pending or running operation from its persisted checkpoint, while a stale owner cannot advance it or repeat a completed side effect. | Failure-injection and lease-fencing tests + protected CI |
| AC-ASYNC-03 | OBJ-ASYNC-03 | Provider transient polling failure retries with bounded backoff. If a provider-start POST may have crossed the boundary but no typed handle was durably recorded, the operation enters `start_indeterminate` and no code path repeats that POST; only exact provider reconciliation may advance it. Permanent failure, cancellation, and expiry are terminal and idempotent. Only the canonical status enum is accepted at storage, transition, event, and read boundaries; unknown values fail closed. | Lifecycle, crash-window, and status-parser matrix tests |
| AC-ASYNC-04 | OBJ-ASYNC-04 | Event delivery is at-least-once and deduplicated by operation transition; reconciliation is cursor-bounded and authorized through the operation's exact TaskRun or Workroom scope. A bare operation ID never grants read access. Every outbox/webhook payload carries `status: AsyncInferenceOperationStatus`, never a free string. | Event-schema/event-bus/authorization/read-model tests |
| AC-ASYNC-05 | OBJ-ASYNC-05 | Sync interaction mode remains behaviorally unchanged and authorized async results are retrievable through their TaskRun/workroom scope with exact provider and request provenance. | Regression tests + typecheck/build |
| AC-ASYNC-06 | OBJ-ASYNC-06 | `tasks/submit` accepts only the closed seeded recipe `durable-inference.one-shot.v1`. It persists one TaskRun and immutable recipe/digest metadata, then returns before inference. The background TaskRun worker revalidates that server-owned recipe and is the only caller of one `routeAndCall(..., { interactionMode: "background", durableAsyncOperation: <server-derived TaskRun binding> })`; it persists the returned async-operation ID. Exact-mode dispatch reconciliation remains active when generic async TaskRuns are disabled and recovers submitted, working/admitting, and quiescing/admitting crash windows without selecting admitted rows or creating siblings. Pre-admission cancellation is a TaskRun CAS; post-admission cancellation uses only TaskRun-scoped authority. Transition delivery waits through quiescence, preserves a nonterminal quiescing projection, terminally settles the bound TaskRun once, and retries a CAS race rather than acknowledging a lost transition. The closed seeded champion and its no-tool/async policies are exact and cannot explore a challenger. `tasks/get`, `tasks/result`, and `tasks/cancel` resolve the authenticated TaskRun first and use TaskRun-scoped authorized async runtime functions; no method accepts a bare async-operation ID. Tests prove same-submit replay, request/recipe drift denial, worker-only provider start, restart/reconciliation, duplicate settlement, exact result provenance, cancellation/expiry, real pinned-recipe selection, and unchanged ordinary/sync submissions. | Focused route/submit/worker/transition/lifecycle/recipe tests + typecheck + protected CI |

## Scope and non-goals

Extend the existing `AsyncInferenceOp`, `TaskRun`, Workroom authority, Inngest, and agent event bus. Do not add a parallel task ledger, replace MCP Tasks, or introduce a second provider-operation table. Foundation BI-2B619BC9 first repairs the typed provider-start boundary already expected by `AsyncInferenceOp`; it supports Gemini's explicit Interactions create/get contract and fails closed for generic chat-completion providers until they define their own asynchronous protocol. The first functional BI-801313EB delivery slice then moves provider start behind durable identity/checkpoint/resume and a server-triggered worker. The final BI-801313EB slice exposes that substrate only through one closed one-shot MCP Tasks recipe; it does not change generic `request_coworker`, ordinary `tasks/submit`, or synchronous routing. Once a request uses this durable path, the request process may persist and enqueue its TaskRun but may not route or call the provider directly. The foundation may merge independently because it restores the existing tracking path without exposing a new consumer capability, but it does not satisfy BI-801313EB's lifecycle acceptance or permit a completion claim. Notification UX is a dependent BI (BI-05D7A0DC).

## Proposed contract

1. Carry the provider's accepted-operation handle through a typed `AsyncOperationStartResult`. The provider handle and platform `AsyncInferenceOp.id` remain distinct identities; no downstream layer recovers authority from `raw` metadata.
2. Bind a server-owned logical request key to exactly one authorized TaskRun or Workroom scope and compute a canonical request digest from provider, model, contract family, normalized screened request context, and that immutable binding. A client-supplied scope string, operation ID, or request key is never authority by itself.
3. Before any provider-start POST, create-or-replay `AsyncInferenceOp` by `(authority scope, request key)`. Return the existing operation only when the stored digest and binding match; reject payload or scope drift, and never globally deduplicate equal content submitted by different callers.
4. Persist checkpoint sequence, start-claim state, and fenced lease ownership on the operation. The worker claims the provider-start step with CAS before crossing the network boundary and heartbeats progress; a stale owner cannot start, poll, or transition the operation.
5. The worker is the sole owner of provider start and polling. A retry may re-read an already identified provider operation, but it cannot create a second provider operation for the same logical request. If a start request may have reached the provider but the typed handle was not durably recorded, persist `start_indeterminate` and prohibit another start POST.
6. Define one shared closed `AsyncInferenceOperationStatus` enum: `pending | start_indeterminate | running | completed | failed | cancelled | expired`. `pending`, `start_indeterminate`, and `running` are non-terminal; the remaining values are terminal. Persist a monotonic transition/outbox record in the same transaction as each durable state change, then emit it with the canonical enum value. Storage adapters, webhook/event parsers, and read models reject unknown values rather than widening them to `string`. Consumers use `(operationId, sequence)` plus a cursor-bounded reconciliation query; notification transport is advisory.
7. Enforce `expiresAt` and cancellation before each provider call and transition exactly once to a terminal state.

### Closed MCP Tasks production caller

The first production caller is deliberately smaller than a generic asynchronous coworker API:

1. The only public opt-in is `recipeId: "durable-inference.one-shot.v1"` on the existing bespoke `tasks/submit` method. The server maps that identifier to a versioned immutable recipe definition; unknown fields or recipe identifiers fail before TaskRun creation. The recipe fixes background interaction mode, task type, no-tool policy, supported provider family, system instruction, duration ceiling, and result semantics. Caller text is data, not routing authority.
2. Submission uses the existing deterministic TaskRun identity and request digest, extended with the exact recipe ID. Equal retries return the same TaskRun; changing recipe or payload under the same key is an idempotency conflict. Ordinary submissions omit `recipeId` and remain byte-for-byte on their existing coworker path.
3. The existing TaskRun dispatch worker reloads the persisted packet, validates the exact recipe, wins the submitted-to-working CAS, and makes the sole `routeAndCall` admission. Its durable authority is derived from the persisted TaskRun, submitting user, immutable request key, and stored digest. Neither the queue event nor the MCP caller supplies an operation ID or internal scope.
4. Routing is constrained to the recipe's supported Gemini Interactions provider and must select a seeded champion `ExecutionRecipe` whose contract family is `background.mcp-durable-inference-one-shot` and whose execution adapter is `async`. Missing, conflicting, or non-async recipe selection fails closed before a provider POST.
5. `routeAndCall` performs only durable async-operation admission and returns the platform operation ID. The TaskRun worker persists that ID and an admitted projection; the separate fenced async-operation worker remains the sole owner of the provider POST and polling. A restart reconciles both TaskRun dispatch and async-operation wakes from durable state.
6. The async transition consumer treats its event as an advisory wake only. It re-reads the operation through the TaskRun-scoped authorized runtime, verifies the stored operation ID/request key/digest binding, and maps terminal status exactly once to TaskRun `completed`, `failed`, or `canceled`. Duplicate or stale sequences cannot overwrite an already settled TaskRun.
7. `tasks/get`, `tasks/result`, and `tasks/cancel` first authorize the public TaskRun ID. Only for a validated durable-inference TaskRun do they call the existing TaskRun-scoped async read/cancel functions with the server-stored request key. Results include exact platform/provider/model/provider-operation/request provenance from the authorized read model. A caller can never substitute a bare platform/provider operation ID.
8. The exact recipe is a pinned champion contract: seeded recipe identity, provider/model family, async adapter, no-tool policy, response policy, and provider settings are revalidated before admission. `quality_first` disables champion/challenger exploration for this mode; any different selected recipe or exploration disposition fails before provider dispatch.
9. The scheduled TaskRun reconciler always scans exact durable submissions even when generic asynchronous TaskRuns are disabled. After the quiescence gate clears it may re-enqueue only validated submitted or admitting projections, including a quiesced pre-operation crash window. It never re-enqueues an admitted projection, combines identities, or falsely fails an exhausted row whose bound async operation already exists.
10. Before operation admission, cancellation is persisted by compare-and-set on the authorized TaskRun. The worker observes that intent before calling routed inference. After admission, cancellation resolves only through the existing TaskRun-scoped async runtime.
11. The transition consumer waits at the quiescence boundary. A nonterminal operation cannot reopen a quiescing TaskRun during drain; a terminal operation may settle it after the gate clears. A TaskRun CAS miss is re-read and retried once, accepting only a proven exact terminal duplicate and otherwise failing the delivery for queue retry.
12. TaskRun creation, the immutable user message, and the first submitted dispatch projection commit atomically. Every later dispatch reservation/result write is version- and event-bound. A replay/cancel or worker admission that wins while an advisory send is in flight cannot be overwritten by stale progress.
13. Durable operation admission defers its first wake until the TaskRun has CAS-persisted the exact operation and routing-recipe IDs. If the process dies between operation creation and TaskRun projection, reconciliation may recover only an operation whose TaskRun foreign key, authority scope, request key, binding digest, contract family, seeded champion recipe/model, 4,096-token ceiling, and exact provider/tool/response policies all match. It then atomically projects `admitted` before waking that operation. A failed wake is recovered by the durable async-operation reconciler.
14. Provider lifecycle (`pending`, `running`, terminal state) is stored separately from the TaskRun admission gate; a transition cannot replace `admitted` and block later provider wakes. Terminal TaskRun projection is independently reconciled from the durable operation when advisory transition delivery or its consumer exhausts, with a fresh quiescence gate immediately before mutation.
15. The public result is an allowlisted bounded projection: final text or error, truncation flag, original character count, SHA-256, terminal state, and explicit provider/operation provenance. Provider raw/intermediate payloads never cross the MCP boundary. Both textual and structured output fit the MCP route budget.
16. The closed model recipe enforces `generation_config.max_output_tokens = 4096` on the Gemini Interactions request. Managed-agent profiles are not eligible because that model-only control cannot constrain an agent request. `tasks/cancel` additionally requires write/admin token scope; read-only credentials can observe authorized tasks but cannot mutate or cancel them.
17. The request digest includes normalized requested thread identity. Existing version-1 rows replay only when their separately persisted thread agrees; changing thread/context under the same key is drift. Disabling MCP Tasks rejects the durable recipe before TaskRun creation so no operation can be admitted without its authorized get/result/cancel surface.
18. The durable route repeats the mandatory inference-data screen before operation admission and persists only the screened payload plus its safe receipt/context. Immediately before any external provider POST, the worker re-reads the uncached platform local-only switch and re-screens that exact persisted payload against current policy. Missing, stale, blocked, local-only, or callback-dependent evidence fails closed with zero provider I/O.
19. A route carrying an exact durable execution constraint is posture-inert. Saved coworker, organization, or platform Cost/Quality/Time posture cannot alter its route context, effort, model, token ceiling, or provider/tool/response policies; the bound agent remains authority and audit identity only. Any explicit caller override must already be represented by and satisfy the exact execution constraint before operation admission.

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
