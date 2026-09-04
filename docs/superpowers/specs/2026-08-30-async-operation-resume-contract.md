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

- **OBJ-ASYNC-01:** **Stable identity:** one logical request has one server-owned operation identity; retried starts return the existing operation rather than creating a sibling.
- **OBJ-ASYNC-02:** **Durable resume:** a process restart or worker handoff resumes from the last persisted checkpoint without replaying completed side effects.
- **OBJ-ASYNC-03:** **Truthful lifecycle:** pending, running, completed, failed, cancelled, and expired states are persisted with bounded timestamps and auditable transitions.
- **OBJ-ASYNC-04:** **Observable progress:** progress and terminal events are emitted from durable transitions; consumers can reconcile with a cursor-bounded read instead of tight polling.
- **OBJ-ASYNC-05:** **Provenance:** final results retain provider/model/operation identity, request digest, and completion/error metadata.

The implementation is accepted only when:

| ID | Objective | Acceptance criterion | Evidence |
| --- | --- | --- | --- |
| AC-ASYNC-01 | OBJ-ASYNC-01 | Repeating an idempotent start with the same request digest returns the same operation ID and performs no duplicate provider start. | Vitest integration test + protected CI |
| AC-ASYNC-02 | OBJ-ASYNC-02 | Restart/resume claims one pending operation and continues from its checkpoint under a compare-and-swap lease. | Failure-injection test + protected CI |
| AC-ASYNC-03 | OBJ-ASYNC-03 | Provider transient failure retries with bounded backoff; permanent failure, cancellation, and expiry are terminal and idempotent. | Lifecycle matrix tests |
| AC-ASYNC-04 | OBJ-ASYNC-04 | Event delivery is at-least-once and deduplicated by operation transition; reconciliation is cursor-bounded. | Event-bus/read-model tests |
| AC-ASYNC-05 | OBJ-ASYNC-05 | Sync interaction mode remains behaviorally unchanged and async results are retrievable by operation ID with exact provenance. | Regression tests + typecheck/build |

## Scope and non-goals

Extend the existing `AsyncInferenceOp`, `TaskRun`, Inngest, and agent event bus. Do not add a parallel task ledger, replace MCP Tasks, or introduce a second provider-operation table. The first delivery slice covers durable identity/checkpoint/resume and a server-triggered worker; notification UX is a dependent BI (BI-05D7A0DC).

## Proposed contract

1. Compute a canonical request digest from provider, model, contract family, and normalized request context.
2. Upsert an `AsyncInferenceOp` by that digest while preserving the first operation identity and immutable request context.
3. Persist checkpoint sequence and lease ownership on the operation; workers claim with CAS and heartbeat progress.
4. Model provider calls as idempotent steps. A retry may re-read a provider operation but cannot create a second provider operation for the same logical request.
5. Emit transition events after the durable write. Consumers use event IDs plus a cursor-bounded reconciliation query.
6. Enforce `expiresAt` and cancellation before each provider call and transition exactly once to a terminal state.

## Research & Benchmarking

- [Temporal durable execution](https://docs.temporal.io/) provides crash-proof workflow history, signals, timers, and activity retries. DPF adopts durable checkpoints and typed signals, but keeps Postgres `AsyncInferenceOp` and Inngest rather than adding a second workflow service.
- [AWS Step Functions Standard Workflows](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html) provide exactly-once state transitions for non-idempotent work. DPF adopts the explicit terminal-state model, while retaining idempotent application-level writes because provider APIs vary.
- [Inngest durable functions](https://www.inngest.com/docs/learn/inngest-functions) checkpoint steps and retry from the last successful step. DPF adopts event-triggered wake/resume and bounded retries, with operation identity owned by the existing database model.

## Architecture and safety

- **Single source of truth:** `AsyncInferenceOp` owns operation lifecycle; `TaskRun` remains the agent/task projection; the event bus is delivery, not storage.
- **Scale ceiling:** cursor-bounded reads and per-operation CAS are O(1) per transition; the first slice supports thousands of concurrent operations on existing indexes. A future sharded event/read-model epic is required before millions of operations.
- **Failure posture:** unknown provider status, missing checkpoints, conflicting digests, or lease loss fail closed to resumable/reconciliation states; no inferred completion.
- **Rollback:** disable the async worker trigger and continue serving persisted terminal results; schema changes are additive and forward-compatible.
