---
status: draft
---

# Implementation plan: durable asynchronous MCP operation resume

**Backlog item:** BI-801313EB
**Spec:** `docs/superpowers/specs/2026-08-30-async-operation-resume-contract.md`

For agentic workers: execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Deliverables

0. **Typed provider-start boundary (`BI-2B619BC9`)** — replace the broken raw-payload lookup with an explicit `AsyncOperationStartResult` propagated through adapter, inference, and fallback results. Persist the existing platform tracking row from that typed provider handle; keep sync result shapes unchanged and never expose raw provider data as authority.
1. **Identity and checkpoint contract** — extend `AsyncInferenceOp` with a caller/TaskRun-scoped request key, canonical request digest, checkpoint sequence, transition outbox, and lease fields; add additive migration and CAS helpers. Define `AsyncInferenceOperationStatus` as the closed `pending | start_indeterminate | running | completed | failed | cancelled | expired` enum and use it at persistence, transition-event, webhook, and read boundaries. Verify duplicate starts, cross-caller isolation, digest conflicts, concurrent claims, legal transitions, and rejection of unknown status values.
2. **Durable worker/resume path** — add an Inngest-triggered worker that claims pending/running operations, resumes from the checkpoint, applies bounded retry/expiry/cancel rules, and emits transition events. Verify restart and provider-failure matrices.
3. **Read/reconcile API** — expose cursor-bounded operation listing and idempotent result retrieval for a task/workroom. Verify event loss/reconnect reconciliation and provenance.

Deliverable 0 is a safe enabling repair owned by BI-2B619BC9 and may ship first, but it is not a complete asynchronous lifecycle and does not close BI-801313EB. Deliverables 1–3 are sequential parts of one atomic BI-801313EB functional contract: none is independently safe to expose as a completed capability because a worker without identity/checkpoint semantics can duplicate provider calls, and a read API without durable transitions cannot provide truthful state. The notification UX remains independently shippable under BI-05D7A0DC after this contract is live.

## Ordered execution

### Phase 0 — typed start identity (RED → GREEN)

- Add failing propagation tests proving an accepted provider handle survives the adapter → inference → fallback path and reaches routed persistence.
- Replace downstream inspection of provider `raw` metadata with `AsyncOperationStartResult`; keep provider and platform identities explicitly named and distinct.
- Verify sync adapters return no async handle, raw provider payloads remain opaque, the existing `createAsyncOperation` call receives the exact provider handle, and providers without an explicit long-running-operation protocol are refused before dispatch.
- Run the four focused suites, the adjacent routing/inference graph, and web typecheck. This phase may merge as an enabling repair, but record BI readiness as incomplete until Phases 1–3 pass.

### Phase 1 — schema and contract (RED → GREEN)

- Resolve impact paths and existing tests before editing.
- Add failing tests for same-scope duplicate start, different-scope equal payloads, conflicting digest, ambiguous provider-start timeout, CAS lease loss, checkpoint monotonicity, and unknown lifecycle status at every external boundary.
- Implement additive fields/helpers plus the shared `AsyncInferenceOperationStatus` enum and strict parser. Backfill/validate existing rows before enforcing the database constraint; event and webhook payload types must import the same contract rather than redeclare a free `string`.
- Verify that an ambiguous provider start enters `start_indeterminate`, that only the worker/reconciler can leave it, and that every terminal transition is idempotent; run affected Vitest and typecheck.

### Phase 2 — worker and lifecycle (RED → GREEN)

- Add failing failure-injection tests for restart, transient/permanent provider errors, cancellation, and expiry.
- Implement the Inngest worker with bounded backoff and transition-event emission.
- Run lifecycle matrix, affected package tests, and production build once in protected CI.

### Phase 3 — read/reconciliation surface

- Add cursor-bounded list/result retrieval and event dedupe tests.
- Verify sync mode regression and exact provenance fields.
- Document operator rollback and migration behavior.

## Verification and delivery gate

- Local: affected Vitest, typecheck, `pnpm run pregate:preflight`; if a local sandbox slot is unavailable, record the gate as inconclusive with compensating evidence.
- Protected: DCO, merge queue, full unit suite, production build, CodeQL, route/policy guards.
- Runtime: one governed nonproduction validation of duplicate-start, restart/resume, expiry/cancel, and exact result retrieval. No direct runtime mutation.

## Risks and rollback

- Provider APIs may not expose idempotent operation creation. Persist the provider operation ID before any retry and fail closed when it is absent.
- A stale worker lease could strand work. Use bounded lease expiry plus event-triggered reconciliation; never allow two active owners.
- Event delivery can duplicate or disappear. Persist transition sequence, dedupe by `(operationId, sequence)`, carry only the shared lifecycle enum in event/webhook status fields, reject unknown values, and reconcile by cursor.
- Roll back by disabling the worker trigger; retain the additive schema and serve existing terminal results.

## Backlog coverage

This plan is decomposed. Phase 0 is independently shippable under BI-2B619BC9 and restores the pre-existing provider-handle tracking path without a standalone lifecycle claim. Phases 1–3 remain one atomic BI-801313EB functional acceptance unit and are not independently complete. BI-05D7A0DC owns the later notification UX.

| Deliverable key | Backlog item | Independently shippable | Requirement refs | Contract refs | Flow refs | Verification refs | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `typed-provider-start-boundary` | `BI-2B619BC9` | Yes | `OBJ-ASYNC-00` | `CONTRACT-ASYNC-START-HANDLE` | `FLOW-ASYNC-START-HANDLE` | `AC-ASYNC-00` | None |
| `durable-lifecycle-core` | `BI-801313EB` | Yes, as the atomic Phase 1–3 unit | `OBJ-ASYNC-01`, `OBJ-ASYNC-02`, `OBJ-ASYNC-03`, `OBJ-ASYNC-04`, `OBJ-ASYNC-05` | `CONTRACT-ASYNC-IDENTITY`, `CONTRACT-ASYNC-CHECKPOINT`, `CONTRACT-ASYNC-TRANSITION-OUTBOX`, `CONTRACT-ASYNC-RESULT-PROVENANCE` | `FLOW-ASYNC-START-RESUME-RECONCILE` | `AC-ASYNC-01`, `AC-ASYNC-02`, `AC-ASYNC-03`, `AC-ASYNC-04`, `AC-ASYNC-05` | `typed-provider-start-boundary` |
| `notification-task-hub` | `BI-05D7A0DC` | Yes | `OBJ-ASYNC-04` | `CONTRACT-ASYNC-NOTIFICATION-HUB` | `FLOW-ASYNC-TRANSITION-NOTIFY` | `AC-ASYNC-04` | `durable-lifecycle-core` |

The governed coverage receipt is recorded against the final immutable blob after this table is frozen. Its receipt ID belongs in Workroom evidence; editing the plan after that point requires a new coverage receipt rather than embedding the old receipt into changed bytes.
