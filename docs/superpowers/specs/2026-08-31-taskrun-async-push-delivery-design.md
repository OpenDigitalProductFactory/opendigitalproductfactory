---
status: active
---

# Task async push delivery

BI-2014236E · WC-48A3D214 · `feat/taskrun-async-delivery`

Plan: `docs/superpowers/plans/2026-08-31-taskrun-async-push-delivery.md`.

## Problem and evidence

`tasks/submit` persists a governed `TaskRun` but awaits autonomous inference.
A review can outlive HTTP, so callers see a timeout while work continues and
may poll or resubmit. The reproduction is
`apps/web/lib/mcp-task-submit.ts`; its regression test holds execution pending
and requires submission to return the durable handle.

## Architecture decision

Reuse, do not duplicate: `TaskRun`/first `TaskMessage` are the ledger; Inngest
is the runtime; `executeRemoteTaskAttempt` remains governed execution; MCP task
SSE is live delivery; `tasks/list|get|result` is recovery. Existing decision,
authorization, envelope, and delegation records remain authority substrate.

1. Authorize as today; persist one deterministic TaskRun, prompt, digest,
   authority snapshot, and review binding before delivery.
2. Store a server-owned dispatch projection, enqueue only `taskRunId` under a
   deterministic event id, and return the MCP Task handle immediately.
3. The worker reloads input from the database and wins a heartbeat-aware CAS
   before the agent loop. Duplicate submit/event/reconciliation executes once.
4. Commit state before emitting auth-bound `notifications/tasks/status`.
   Connected hosts wake and re-read; reconnecting hosts replay/list/get. A
   bounded reconciler re-enqueues missed dispatch under the same identity.
5. Preserve same-TaskRun approval/expiry, cancellation, terminal writer,
   immutable artifacts, reviewer separation, and audit. Hydrated evidence joins
   the sole system prompt; a missing writer stays input-required.

MCP task subscription is the immediate webhook-equivalent; polling is recovery.
Reject caller callback URLs. BI-05D7A0DC owns registered signed outbound hosts
and cross-process fan-out. This slice assumes one portal replica for instant
push while durable replay works across replicas. MCP notifications never grant
authority.

## WWMD authority

WWMD is Mark's human-rooted governance process authority. For an admitted
bounded readiness writer, the server derives the exact action, BI, org, route,
artifact/input, actor, delegation, and policy binding. A fresh sealed judgment
projects only on explicit `proceed`, high confidence, autonomy eligibility,
evidence, no commandment conflict, and no dual-control floor. Decline denies;
ambiguous, stale, missing, unsealed, or mismatched stops. Grants and independent
review still govern capability/findings; callers cannot supply judgment or
scoring. Authorization is single-use and expiring. DI-A16B2E483B28 governs.

## Acceptance and rollback

- Submission returns before inference; one persisted identity executes once.
- Tests cover rehydration, push/reconnect/reconcile, enqueue failure, invalid
  identity, cancellation, approval expiry, writer replay, and message order.
- WWMD proceeds only in the exact affirmative band; all other bands fail closed.
- `DPF_EXTERNAL_MCP_TASK_ASYNC=off` stops new async enqueue without deleting
  TaskRuns or disabling retrieval/reconciliation.
