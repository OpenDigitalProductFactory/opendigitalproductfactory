---
status: draft
---

# Implementation plan: durable asynchronous MCP operation resume

**Backlog item:** BI-801313EB  
**Spec:** `docs/superpowers/specs/2026-08-30-async-operation-resume-contract.md`

For agentic workers: execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Deliverables

1. **Identity and checkpoint contract** — extend `AsyncInferenceOp` with a canonical request digest, checkpoint sequence, and lease fields; add additive migration and CAS helpers. Verify duplicate starts, digest conflicts, and concurrent claims.
2. **Durable worker/resume path** — add an Inngest-triggered worker that claims pending/running operations, resumes from the checkpoint, applies bounded retry/expiry/cancel rules, and emits transition events. Verify restart and provider-failure matrices.
3. **Read/reconcile API** — expose cursor-bounded operation listing and idempotent result retrieval for a task/workroom. Verify event loss/reconnect reconciliation and provenance.

Deliverables 1–3 are sequential parts of one atomic contract: none is independently safe to ship because exposing a worker without identity/checkpoint semantics can duplicate provider calls, and exposing a read API without durable transitions cannot provide truthful state. The notification UX remains independently shippable under BI-05D7A0DC after this contract is live.

## Ordered execution

### Phase 1 — schema and contract (RED → GREEN)

- Resolve impact paths and existing tests before editing.
- Add failing tests for duplicate start, conflicting digest, CAS lease loss, and checkpoint monotonicity.
- Implement additive fields/helpers; run affected Vitest and typecheck.

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
- Event delivery can duplicate or disappear. Persist transition sequence, dedupe by `(operationId, sequence)`, and reconcile by cursor.
- Roll back by disabling the worker trigger; retain the additive schema and serve existing terminal results.

## Backlog coverage

This plan is atomic for BI-801313EB: the three phases are not independently shippable without violating the identity/checkpoint safety contract. Coverage receipt is recorded in the DPF MCP before implementation begins and must be copied here verbatim before PR creation.
