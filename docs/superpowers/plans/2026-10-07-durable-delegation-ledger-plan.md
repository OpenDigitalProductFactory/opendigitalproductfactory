---
status: active
---

# Plan — durable delegation ledger

**Design:** [`2026-10-07-durable-delegation-ledger-design.md`](../specs/2026-10-07-durable-delegation-ledger-design.md) · **Epic:** `EP-07B49BD8` · **Umbrella for this plan's coverage:** `BI-763D6E01`

The design's manifest (§5) is one baseline for the whole epic, so this plan maps
every acceptance statement to the backlog item that delivers it. Each phase is an
independently shippable PR against `main`; the order below is the dependency
order, not a single release.

## Decomposition decision

Decomposed. Every phase is a separate item with its own Workroom, PR and
evidence. `BI-CC057853` and `BI-05715F4C` are `xlarge`; their first independently
shippable slices are filed (`BI-A0BFA63E`, `BI-287E1DD0`), and the remainder is
decomposed again in their own plans before implementation.

| Phase | Deliverable | Backlog item | Depends on | State at writing |
|---|---|---|---|---|
| P1 | Lease ownership: holder-only renewal, compare-and-set handover, row lock | BI-A7601AED | — | PR #6150 in the merge queue |
| P2 | Bounded lease-loss retries and an isolating, capped async-operation outbox | BI-6BB830E4 | — | branch gated |
| P2b | Dead letters visible on queue health | BI-BC5C47D4 | P2 | filed |
| P3 | Workroom command receipts | BI-763D6E01 | P1 | this plan |
| P4 | Sequenced Workroom log committed with the command | BI-62514632 | P3 | filed |
| P5a | Open-child limit and closed delegation links | BI-A0BFA63E | — | branch committed |
| P5b | Child threads run as durable jobs; an interrupted child fails visibly | BI-287E1DD0 | P2 | branch committed |
| P5c | Results land on the parent, parent wake modes, cancel cascade, no authority widening | BI-CC057853 | P3, P4, P5b | to decompose |
| P6 | Recovery by effect class and queue hold | BI-2B6A8A74 | P2, P5b | filed |
| P7 | Agent CLIs as supervised runtimes | BI-05715F4C | P4, P5c | to decompose |

## Phases

### P1 — Lease ownership (BI-A7601AED)

`heartbeatWorkCapsule` and `reassignWorkCapsuleExecutor` move to
`apps/web/lib/work-capsules/workroom-lease.ts`. The heartbeat locks the room row
(`SELECT … FOR UPDATE`) and renews only for the holder, or once the lease lapsed,
using `liveLeaseHeldByAnother`. `heartbeat_workroom` refuses with
`lease_held_by_other`; the renewal after an ordinary write keeps the holder's
lease. `reassign_workroom_executor` accepts `expectedLeaseHolderPrincipalId` and
refuses with `lease_holder_changed`.

### P2 — Bounded retries (BI-6BB830E4)

`recoverExpiredLeases` counts the lost attempt; `executeRun` fails a run with no
attempts left through onFailure as `lease_expired_exhausted`.
`publishAsyncOperationTransitions` holds back only a failing operation, stops
selecting a transition at `ASYNC_OPERATION_TRANSITION_DELIVERY_CAP`, and raises
`AsyncOperationOutboxUnavailableError` when two operations fail with nothing
delivered. P2b adds the dead-letter count to `get_queue_status`.

### P3 — Command receipts (BI-763D6E01)

1. **Schema.** One additive migration adds `WorkroomCommandReceipt`
   (`authorityScopeKey`, `commandId`, `commandType`, `targetKind`, `targetId`,
   `status` enum `accepted | rejected`, `result` JSON, `rejection` JSON,
   `toolExecutionId`, `workroomId` FK with cascade, `createdAt`), unique on
   `(authorityScopeKey, commandId)`. Data-impact manifest and
   `table-classification.ts` entry (internal, operational, domain retention).
2. **Store.** `apps/web/lib/work-capsules/command-receipts.ts` exports
   `runReceiptedCommand({ tx, authorityScopeKey, commandId, commandType, target, run })`.
   Inside the caller's transaction and the room row lock it reads the receipt:
   same target returns the stored result or rethrows the stored rejection as
   the same typed error; a different target throws `CommandIdConflictError`
   (`command_id_conflict`). Otherwise it runs the command, then stores
   `accepted` with the result, or `rejected` with the typed refusal.
3. **Writers.** `heartbeat_workroom`, `update_workroom_status`,
   `reassign_workroom_executor`, `claim_workroom_scope`,
   `release_workroom_scope`, `record_workroom_evidence` and `create_workroom`
   accept an optional `commandId`. Without one, the receipt is keyed on the
   call's `ToolExecution` id, so it records but never deduplicates, and old
   clients behave exactly as today.
4. **Authority scope.** `authorityScopeKey` is
   `user:<userId>|agent:<agentId ?? "none">`, so one principal's command id
   never collides with another's.
5. **Tests.** Unit tests for the store; a real-Postgres test (the job engine's
   `DPF_JOBS_TEST_DATABASE_URL` pattern) that fires two concurrent mutations on
   one room and asserts they serialise, and that a replayed command produces one
   effect.

### P4 — Workroom log (BI-62514632)

`WorkroomActivity` gains `sequence` (unique per room, nullable for legacy rows),
`commandReceiptId` and `entity`. `runReceiptedCommand` appends the activity rows
in the same transaction. The SSE stream reads `snapshot@N` then rows after `N`.
Retention moves to operational/domain for sequenced rows only.

### P5 — Durable delegation (BI-A0BFA63E, BI-287E1DD0, BI-CC057853)

P5a counts open children and closes `DelegationChain` links on the child's
return. P5b sends `agent/child-thread.run` to `agentChildThreadRun` with
`retries: 0`; its onFailure calls `failInterruptedChildThread`. P5c writes the
child result to the parent's log, adds `each` and `settled` wake modes on a
`JobWait`, cascades cancel, and refuses widening with
`child_authority_escalation_denied`.

### P6 — Recovery by class (BI-2B6A8A74)

Every outbox effect and job step declares `replay-safe` or `process-bound`;
undeclared counts as process-bound. Boot order is logged; a provider failure
holds the room queue until `resume_workroom_queue`.

### P7 — Agent CLI runtimes (BI-05715F4C)

An executor adapter contract over the Claude Agent SDK and Codex `app-server`,
a per-session room-scoped MCP credential, approval bridging, a resume and
handoff matrix, and usage-limit auto-resume. Decomposed in its own plan.

## Traceability

| Requirement | Verification | Contract | Flow | Backlog item |
|---|---|---|---|---|
| OBJ-DDL-LEASE | AC-DDL-LEASE-REFUSE | heartbeat_workroom | agent renews a room lease | BI-A7601AED |
| OBJ-DDL-LEASE | AC-DDL-LEASE-CAS | reassign_workroom_executor | owner hands a room over | BI-A7601AED |
| OBJ-DDL-LEASE | AC-DDL-LEASE-SERIAL | runReceiptedCommand | agent mutates a room | BI-763D6E01 |
| OBJ-DDL-BOUNDED | AC-DDL-BOUND-LEASE | recoverExpiredLeases | job worker loses its lease | BI-6BB830E4 |
| OBJ-DDL-BOUNDED | AC-DDL-BOUND-OUTBOX | publishAsyncOperationTransitions | outbox publishes transitions | BI-6BB830E4 |
| OBJ-DDL-BOUNDED | AC-DDL-BOUND-VISIBLE | get_queue_status | operator reads queue health | BI-BC5C47D4 |
| OBJ-DDL-RECEIPT | AC-DDL-RECEIPT-ONCE | runReceiptedCommand | agent retries a room command | BI-763D6E01 |
| OBJ-DDL-RECEIPT | AC-DDL-RECEIPT-REJECT | CommandIdConflictError | agent retries a room command | BI-763D6E01 |
| OBJ-DDL-LOG | AC-DDL-LOG-TXN | runReceiptedCommand | agent mutates a room | BI-62514632 |
| OBJ-DDL-LOG | AC-DDL-LOG-RESUME | WorkroomActivity | reader resumes the room stream | BI-62514632 |
| OBJ-DDL-DELEGATE | AC-DDL-DELEGATE-RESTART | agentChildThreadRun | coworker delegates to a child | BI-287E1DD0 |
| OBJ-DDL-DELEGATE | AC-DDL-DELEGATE-WAKE | JobWait | coworker delegates to a child | BI-CC057853 |
| OBJ-DDL-DELEGATE | AC-DDL-DELEGATE-CANCEL | child_authority_escalation_denied | coworker delegates to a child | BI-CC057853 |
| OBJ-DDL-RECOVER | AC-DDL-RECOVER-CLASS | failInterruptedChildThread | portal restarts mid-work | BI-2B6A8A74 |
| OBJ-DDL-RECOVER | AC-DDL-RECOVER-HOLD | resume_workroom_queue | provider fails mid-work | BI-2B6A8A74 |
| OBJ-DDL-RUNTIME | AC-DDL-RUNTIME-SCOPE | heartbeat_workroom | room drives an agent CLI | BI-05715F4C |

## Risks and rollback

- Each phase is one clean revert. P1, P2 and P5a change no schema.
- P3 and P4 migrations are additive and nullable; reverting the code leaves
  unused columns and a table, never a broken write.
- P5b has a kill switch, `DPF_CHILD_THREAD_DURABLE_DISPATCH=off`.
- The job engine still routes to Inngest by default; every job change here is
  engine-neutral through the `@dpf/jobs` facade.

## Backlog coverage

Recorded with `record_plan_backlog_coverage` against `BI-763D6E01`'s
spec-approval baseline; the receipt id is added here when issued.
