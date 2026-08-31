---
status: active
---

# Implementation plan: governed TaskRun asynchronous push delivery

**Backlog item:** BI-2014236E  
**Workroom:** WC-48A3D214  
**Spec:** `docs/superpowers/specs/2026-08-31-taskrun-async-push-delivery-design.md`

## Atomic delivery

This BI ships one behavior: a newly submitted external governed TaskRun is
persisted, deterministically queued, executed once in the background, and
observable through push-first task state with reconciliation fallback. The
event consumer, reconstruction contract, and reconciliation path are not safe
as partial releases, so this plan is atomic.

The generic external-host webhook registration UI is not smuggled into this
repair. The current slice implements the native authenticated task notification
path and keeps polling as recovery. BI-05D7A0DC owns the registered-host and
cross-page notification experience after its durable-operation dependency.

## Task 1: immutable design and reproduction

1. Publish the design and plan with DCO.
2. Record current-tree evidence that `submitRemoteCoworkerTask` awaits
   `executeRemoteTaskAttempt` after persistence.
3. Add a failing test whose execution promise never resolves and assert that
   submission should still return a TaskRun handle promptly.
4. Record the fix-profile research receipt when the governed writer is
   traversable; preserve the exact failing test as evidence.

## Task 2: persisted packet reconstruction

1. Extract a small server resolver that loads the TaskRun, first user message,
   owner authority, route, agent, authority scope, and a2a metadata.
2. Validate request digest and review binding with existing parsers.
3. Add failures for missing prompt, owner, digest, token snapshot, route, and
   contradictory binding.
4. Do not accept execution packet fields from the queue event beyond
   `taskRunId` and deterministic event identity.

## Task 3: deterministic background dispatch

1. Add the `mcp/task-run.execute` Inngest event and consumer.
   Keep the direct queue-client dependency inside the canonical queue adapter;
   submission and reconciliation call that adapter rather than growing a new
   queue substrate.
2. Add a compare-and-set claim so one submitted event wins and duplicates read
   current state without executing.
3. Change ordinary `tasks/submit` to persist the dispatch projection, enqueue,
   and return the task handle immediately.
4. Preserve the high-risk pre-execution approval response and same-TaskRun
   approval/terminal-writer/capacity replay paths.
5. Add duplicate submit, duplicate event, cancellation-before-claim, and queue
   retry tests.
6. Recover an expired proposed terminal-writer envelope by atomically
   cancelling it and cloning its exact stored binding and proposal onto the
   same TaskRun. Require fresh human approval; never rerun inference or mint a
   sibling TaskRun.

## Task 4: push and reconciliation

1. Emit/project task status only after the database transition commits.
2. Add authenticated Streamable HTTP GET on canonical `/api/mcp/v1`. Replay
   token-owned persisted TaskRuns, then emit MCP 2025-11-25
   `notifications/tasks/status` for live working/input-required/terminal state.
   Several streams for one token must not duplicate a logical live frame.
3. Add a bounded scheduled reconciliation scan for submitted external tasks
   whose deterministic dispatch is pending or stale.
4. Re-enqueue the same event identity with bounded attempts/backoff; never mint
   a sibling TaskRun.
5. Register the reconciliation cron in the canonical Scheduled Jobs catalog so
   its cadence and purpose remain visible to operators. Classify it with the
   existing durable flow-control catalog entries rather than growing the main
   catalog module past its size ratchet.
6. Keep `tasks/list`, `tasks/get`, and `tasks/result` as the authoritative
   missed-delivery/read-after-wake path.
7. Document and verify the first-slice scale ceiling: immediate push is scoped
   to one active portal replica, while durable TaskRun replay/list/get remains
   correct across reconnect or replacement. Keep multi-replica immediate
   fan-out in the explicit BI-05D7A0DC dependency.

## Task 5: reconnect WWMD action authority

1. Add a server-only action-judgment builder for the bounded tools in the
   initiative-readiness lane registry. Derive its exact subject, organization,
   route, artifact fingerprint, actor, and option vectors from verified server
   context; expose none of these as caller authority input.
2. Extend the existing kernel-consult ledger adapter to persist the exact
   `policyActionBinding`, affirmative option id, and dual-control requirement
   supplied by that server-owned path. Preserve the ordinary advisory
   `principle_decide` schema unchanged.
3. When the existing policy projector finds no fresh exact judgment, invoke one
   WWMD consult, reload the sealed record, and project only through the current
   fail-closed projector. Never loop or interpret the tool's prose as authority.
4. Test explicit proceed, decline, uncertain/defer/conflict, stale/mismatched
   binding, already-existing judgment, single invocation, independent lane
   separation, and the absence of caller-controlled policy binding.
5. Record `DI-A16B2E483B28` and the promoted policy version in immutable audit
   evidence. A human click remains reserved for genuine escalation or required
   dual control, not routine action-by-action permission.

## Task 6: blast radius and delivery

1. Run affected submit, execution, Task lifecycle, task-stream, queue, approval,
   terminal-writer, and cancellation suites.
2. Run web typecheck, style guard, preflight, architecture review, semantic
   review, and exact-tree CI when the lane is functioning. Record an explicit
   operator-authorized exception only for the defective gate itself; never
   infer a pass.
3. Commit with DCO, publish normally, open a protected PR, and keep full
   protected checks mandatory.
4. Release and upgrade through the canonical self-upgrade path exactly once.
5. On live, submit a bounded read-only coworker task and prove: immediate task
   handle, one background execution, push transition, disconnect/reconcile,
   and exact final result on the same TaskRun.

## Backlog coverage

- Decision: atomic
- Parent: `BI-2014236E`
- Receipt: pending governed writer execution against the final immutable plan
- Dependencies: none

Related but independently shippable work is not a dependency of this atomic
delivery: BI-8B8731EE is adjacent, BI-801313EB owns provider-level durable
operation resume, and BI-05D7A0DC consumes this task-event contract for
cross-page operator UX.

| Requirement | Contract | Flow | Verification |
| --- | --- | --- | --- |
| AC-ASYNC-RETURN | submit/enqueue boundary | persist -> enqueue -> respond | unresolved-execution RED/GREEN test |
| AC-ONE-EXECUTION | dispatch CAS | duplicate events -> one winner | concurrency test |
| AC-SERVER-REHYDRATION | persisted request resolver | event id -> DB packet | invalid-state matrix |
| AC-PUSH-FIRST | token-scoped MCP task event projection | commit -> GET SSE notify -> reread | GET auth + snapshot/live/no-fanout tests |
| AC-RECONCILE | deterministic rescan | missed send -> same event | reconciliation tests |
| AC-FAIL-CLOSED | existing authority/approval/writer contracts | invalid/revoked/cancelled -> stop | negative regression matrix |
| AC-WWMD-AUTHORITY | sealed DecisionInteraction + exact policy projector | no exact judgment -> one WWMD consult -> project or stop | producer/ledger/projector/gate matrix |

The governed `record_plan_backlog_coverage` receipt and exact mappings replace
this provisional section before final PR readiness.
