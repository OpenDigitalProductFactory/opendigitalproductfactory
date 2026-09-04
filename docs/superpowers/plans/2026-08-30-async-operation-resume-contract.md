---
status: draft
---

# Implementation plan: durable asynchronous MCP operation resume

**Backlog item:** BI-801313EB
**Spec:** `docs/superpowers/specs/2026-08-30-async-operation-resume-contract.md`

For agentic workers: execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Deliverables

0. **Typed provider-start boundary (`BI-2B619BC9`)** — replace the broken raw-payload lookup with an explicit `AsyncOperationStartResult` propagated through adapter, inference, and fallback results. Persist the existing platform tracking row from that typed provider handle; keep sync result shapes unchanged and never expose raw provider data as authority.
1. **Identity and checkpoint contract** — extend `AsyncInferenceOp` with a server-owned binding to exactly one authorized TaskRun or Workroom, scoped request key, canonical request digest, checkpoint sequence, transition outbox, start-claim state, and fenced lease fields; add additive migration and create-or-replay/CAS helpers. Durable create-or-replay and the worker's CAS start claim must precede every provider-start POST. Define `AsyncInferenceOperationStatus` as the closed `pending | start_indeterminate | running | completed | failed | cancelled | expired` enum and use it at persistence, transition-event, webhook, and read boundaries. Verify duplicate starts, forged or cross-scope binding rejection, digest conflicts, concurrent claims, legal transitions, and rejection of unknown status values.
2. **Durable worker/resume path** — add an Inngest-triggered worker as the sole owner of provider start and polling. The request path admits/enqueues and returns the platform operation ID without calling the provider. The worker claims pending/running operations, resumes from the checkpoint, applies bounded retry/expiry/cancel rules, and emits transition events. A crash after a start POST may have crossed the boundary but before a handle commits must persist `start_indeterminate` and must never repeat the POST. Verify restart, lease-fencing, crash-window, and provider-failure matrices.
3. **Read/reconcile API** — expose cursor-bounded operation listing and idempotent result retrieval only through an authorized TaskRun/workroom scope. Verify cross-scope and bare-operation-ID denial, event loss/reconnect reconciliation, and provenance.

Deliverable 0 is a safe enabling repair owned by BI-2B619BC9 and may ship first, but it is not a complete asynchronous lifecycle and does not close BI-801313EB. Deliverables 1–3 are sequential parts of one atomic BI-801313EB functional contract: none is independently safe to expose as a completed capability because a worker without identity/checkpoint semantics can duplicate provider calls, and a read API without durable transitions cannot provide truthful state. The notification UX remains independently shippable under BI-05D7A0DC after this contract is live.

## Ordered execution

### Phase 0 — typed start identity (RED → GREEN)

- Add failing propagation tests proving an accepted provider handle survives the adapter → inference → fallback path and reaches routed persistence.
- Replace downstream inspection of provider `raw` metadata with `AsyncOperationStartResult`; keep provider and platform identities explicitly named and distinct.
- Verify sync adapters return no async handle, raw provider payloads remain opaque, the existing `createAsyncOperation` call receives the exact provider handle, and providers without an explicit long-running-operation protocol are refused before dispatch.
- Run the four focused suites, the adjacent routing/inference graph, and web typecheck. This phase may merge as an enabling repair, but record BI readiness as incomplete until Phases 1–3 pass.

### Phase 1 — schema and contract (RED → GREEN)

- Resolve impact paths and existing tests before editing.
- Add failing tests proving provider dispatch cannot occur before durable create-or-replay and a successful CAS start claim. Cover same-scope duplicate start, different-scope equal payloads, forged/unbound TaskRun or Workroom scope, conflicting digest or binding, concurrent start claims, CAS lease loss, checkpoint monotonicity, and unknown lifecycle status at every external boundary.
- Implement additive fields/helpers plus the shared `AsyncInferenceOperationStatus` enum and strict parser. Backfill/validate existing rows before enforcing the database constraint; event and webhook payload types must import the same contract rather than redeclare a free `string`. The binding must resolve through existing authorized TaskRun/Workroom records and cannot be accepted as an arbitrary client string.
- Implement transactional create-or-replay before enqueue and a fenced CAS start claim before provider dispatch. Verify a matching replay returns the same operation without enqueue/start duplication and that drift fails closed; run affected Vitest and typecheck.

### Phase 2 — worker and lifecycle (RED → GREEN)

- Add failing failure-injection tests for restart, transient/permanent provider polling errors, cancellation, expiry, lease loss, and a crash after the provider POST may have crossed the boundary but before a typed handle is persisted.
- Implement the Inngest worker with bounded backoff and transition-event emission as the sole provider-start/poll owner. Remove direct provider start from the durable request path; it may only persist/create-or-replay, enqueue the platform operation ID, and return that identity.
- Persist the typed provider handle and `running` transition after a successful start. On the ambiguous crash window, persist `start_indeterminate`, prohibit every repeat POST, and allow departure only through exact provider-supported reconciliation or an explicit terminal transition.
- Run lifecycle matrix, affected package tests, and production build once in protected CI.

### Phase 3 — read/reconciliation surface

- Add cursor-bounded list/result retrieval, authorization, cross-TaskRun/workroom denial, bare-ID denial, and event dedupe tests.
- Return the shared lifecycle enum from the TaskRun/workroom-authorized read model and require the operator UI to render each canonical state explicitly; invalid persisted or event values surface a fail-closed error and are never displayed as `pending`.
- Verify sync mode regression and exact provenance fields.
- Document operator rollback and migration behavior.

## Verification and delivery gate

- Local: affected Vitest, typecheck, `pnpm run pregate:preflight`; if a local sandbox slot is unavailable, record the gate as inconclusive with compensating evidence.
- Protected: DCO, merge queue, full unit suite, production build, CodeQL, route/policy guards.
- Runtime: one governed nonproduction validation of duplicate-start, restart/resume, expiry/cancel, and exact result retrieval. No direct runtime mutation.

## Risks and rollback

- Provider APIs may not expose idempotent operation creation. Durable admission and the fenced CAS claim prevent concurrent starts, but they cannot prove whether a timed-out POST crossed the provider boundary. If the typed provider handle is absent after that boundary may have been crossed, persist `start_indeterminate` and never repeat the POST; leave that state only through exact provider reconciliation or an explicit terminal transition.
- A stale worker lease could strand work. Use bounded lease expiry plus event-triggered reconciliation; never allow two active owners.
- Event delivery can duplicate or disappear. Persist transition sequence, dedupe by `(operationId, sequence)`, carry only the shared lifecycle enum in event/webhook status fields, reject unknown values, and reconcile by cursor.
- Roll back by disabling the worker trigger; retain the additive schema and serve existing terminal results.

## Backlog coverage

- Decision: decomposed
- Parent: `BI-801313EB`
- Historical receipt (superseded; evidence only): `cmtmikg460wqu01nvgifvg6rq`
- Receipt: `cmtmquzgh040001pbmb4j4y7j`
- Receipt binding: server-validated against commit `dbd8f76aa3e856ec5209e72d8c0ce57e11c8ca4a`, plan blob `1fa0bd9a83f60683343de8dca458c7337f06bc8c`
- Current coverage: **validated.** The fresh receipt covers the revised durable lifecycle contract, flow ordering, authority boundary, and verification semantics. The historical receipt remains evidence only and is not reused for current readiness.
- Dependencies: `BI-2B619BC9`: none; `BI-801313EB`: `typed-provider-start-boundary`; `BI-05D7A0DC`: `durable-lifecycle-core`
- `typed-provider-start-boundary` -> `BI-2B619BC9`
- `durable-lifecycle-core` -> `BI-801313EB`
- `notification-task-hub` -> `BI-05D7A0DC`

This plan is decomposed. Phase 0 is independently shippable under BI-2B619BC9 and restores the pre-existing provider-handle tracking path without a standalone lifecycle claim. Phases 1–3 remain one atomic BI-801313EB functional acceptance unit and are not independently complete. BI-05D7A0DC owns the later notification UX.

| Deliverable key | Backlog item | Independently shippable | Requirement refs | Contract refs | Flow refs | Verification refs | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `typed-provider-start-boundary` | `BI-2B619BC9` | Yes | `OBJ-ASYNC-00` | `CONTRACT-ASYNC-START-HANDLE` | `FLOW-ASYNC-START-HANDLE` | `AC-ASYNC-00` | None |
| `durable-lifecycle-core` | `BI-801313EB` | Yes, as the atomic Phase 1–3 unit | `OBJ-ASYNC-01`, `OBJ-ASYNC-02`, `OBJ-ASYNC-03`, `OBJ-ASYNC-04`, `OBJ-ASYNC-05` | `CONTRACT-ASYNC-IDENTITY`, `CONTRACT-ASYNC-CHECKPOINT`, `CONTRACT-ASYNC-TRANSITION-OUTBOX`, `CONTRACT-ASYNC-RESULT-PROVENANCE` | `FLOW-ASYNC-START-RESUME-RECONCILE` | `AC-ASYNC-01`, `AC-ASYNC-02`, `AC-ASYNC-03`, `AC-ASYNC-04`, `AC-ASYNC-05` | `typed-provider-start-boundary` |
| `notification-task-hub` | `BI-05D7A0DC` | Yes | `OBJ-ASYNC-04` | `CONTRACT-ASYNC-NOTIFICATION-HUB` | `FLOW-ASYNC-TRANSITION-NOTIFY` | `AC-ASYNC-04` | `durable-lifecycle-core` |

The historical governed coverage receipt above was recorded against immutable plan blob `6493bc1476b4f1f3ce616a8ccb9fef943a38c041` at commit `f574804207670a44149c56317ef7b80d76accb06`, after the original mapping table was frozen. It remains durable audit evidence for that earlier plan and is not deleted or rewritten. This revision materially changes the `durable-lifecycle-core` contract and verification meaning while preserving every deliverable key and requirement/contract/flow reference in the table. Receipt `cmtmquzgh040001pbmb4j4y7j` is the fresh immutable coverage proof for the revised plan; it does not infer or replace independent architecture or design review.
