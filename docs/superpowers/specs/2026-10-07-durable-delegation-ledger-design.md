---
status: draft
---

# Durable delegation ledger: receipted, logged and recoverable Workroom delegation

**Epic:** `EP-07B49BD8` · **Backlog:** `BI-A7601AED`, `BI-6BB830E4`, `BI-763D6E01`, `BI-62514632`, `BI-CC057853`, `BI-2B6A8A74`, `BI-05715F4C` · **Extends:** [long-running agentic process architecture §5.1](../../architecture/2026-06-09-long-running-agentic-process-architecture.md) (common recovery contract, `BI-CB690D61`), [Postgres durable job engine](2026-09-25-postgres-durable-job-engine-design.md) (`EP-8DC217EB`) · **Supersedes nothing; amends** [T3 Code source delta review](2026-09-04-t3-code-source-delta-review.md) (`BI-6E750AD8`) with T3's Orchestration V2.

## 1. Problem

A DPF agent can hand work to another agent, but the platform cannot answer three
questions about that hand-off after the fact: *did the request already run*, *what
happened, in what order*, and *who is waiting for the answer*. Delegation is
spread over about eight mechanisms that each solved one piece:

| Mechanism | Where | What it lacks |
|---|---|---|
| Workroom lease | `apps/web/lib/work-capsules/work-capsule-store.ts` `heartbeatWorkCapsule` :572 | Any caller with `work_capsule_write` overwrites a live holder (:580-585); `reassignWorkCapsuleExecutor` (:606-662) never checks the current holder. |
| Child threads | `apps/web/lib/actions/agent-threads.ts` `spawnWorkThread` :20 | The child runs as an in-process `void` promise (`agent-thread-dispatcher.ts:15`); a restart orphans it until an operator acts. `childCount` never decrements on completion (:134), so a parent gets five children per lifetime. |
| Result return | `agent-thread-dispatcher-runtime.ts` `emitCollaborationReturn` :35 | In-memory `agentEventBus` (`lib/tak/agent-event-bus.ts:157`), only for collaboration-provenance spawns; the parent agent loop is never woken and polls `get_thread_result`. |
| Delegation chain | `lib/tak/delegation-authority.ts` | `completeChainLink` / `failChainLink` (:242-256) have no callers; every link stays `active`. |
| Job engine | `apps/web/lib/jobs/postgres/store.ts` | `recoverExpiredLeases` (:357) requeues without counting an attempt, so a worker-crashing run never fails out. |
| Async inference outbox | `apps/web/lib/inference/async-operation-outbox.ts` :24-56 | No delivery-attempt cap; oldest-first reads let one poison transition block every later one. |
| Workroom trail | `WorkroomActivity` (`work-coordination.prisma`) | Written beside, not with, the state it describes; 180-day telemetry retention; no sequence, so readers cannot resume from a position. |
| Local-CI / nonprod leases | `lib/nonprod/environment-lease.ts`, `lib/nonprod/durable-wait.ts` | Sound fencing, but its own vocabulary; recovery semantics are not shared with the rest. |

Each failure above has already cost a live incident: the AI coordinator that
locked a human owner out of their room (`BI-A27B903D`), the ~22k-item Inngest
poison queue (`scripts/drain-inngest-poison-queue.sh`), the orphan
`AsyncInferenceOp` re-enqueued forever at 71% CPU, and deliberation TaskRuns
leaking in `working` (`BI-D208E70C`).

## 2. Evidence: what the leader does

T3 Code (`pingdotgg/t3code`) shipped **Orchestration V2** in
[PR #2829](https://github.com/pingdotgg/t3code/pull/2829), merged 2026-10-02
(`de34391`). Reviewed at
[`d720210`](https://github.com/pingdotgg/t3code/tree/d720210996a514368ba99f4860063110033d93fa/apps/server/src/orchestration-v2)
(2026-10-07): 26k stars, ~412 contributors, 3,380 PRs merged in the prior 90 days.
Our 2026-09-04 review pinned `4e547318`, before V2 reached `main`, so none of
the following was in it. Tags: **[V]** read in source, **[D]** design docs
only, **[I]** inference.

- **[V] Command receipts.** `OrchestratorV2.dispatch` (`Orchestrator.ts`) checks
  `CommandReceiptStore` first: a duplicate `commandId` returns the stored result;
  a different-target reuse raises `OrchestratorCommandIdConflictError`;
  rejections are stored (`commitRejectedCommand`) so a retry gets the same answer.
- **[V] One transaction per command.** `EventSink.commitCommand` reserves the
  receipt, appends events, applies projections, enqueues outbox effects and
  finalises the receipt in one SQLite transaction. A one-permit publish lane
  keeps live subscribers in commit order.
- **[V] Per-aggregate serialisation.** `ThreadCommandExecutor.ts` holds a
  `KeyedLock` per thread; parent and child locks are taken sequentially, never
  nested.
- **[V] Full-entity events.** `run.updated`, `node.updated`, `subagent.updated`
  carry the whole entity (`packages/contracts/src/orchestrationV2.ts`); readers
  take a snapshot at sequence N and stream events after N.
- **[V] Delegation.** The `delegate_task` MCP tool becomes
  `delegated_task.request`: a child thread, a child run, a `subagent` record on
  the parent (`origin: app_owned`) and a `subagent_spawn` `ContextTransfer`. The
  child may keep or narrow the parent's runtime mode, never widen it
  (`runtime_mode_escalation_denied`). `clientRequestId` makes a retried
  delegation return the same child.
- **[V] Result return and wake.** On a child's terminal run,
  `finalizeAppOwnedSubagent` writes an idempotent `subagent_result` transfer
  under the parent's lock. `completionWake` is `always` or `settled_only`;
  results batch through a completion cohort with a generation counter; a wait
  timeout does not cancel the child; `task_cancel` cascades.
- **[V] Effect outbox.** `EffectOutbox.ts` / `EffectWorker.ts`: 30 s leases,
  `attempt_count`, backoff `min(30s, 100ms·2^n)`, 5 attempts, per-thread FIFO
  enforced in the claim query.
- **[V] Recovery by class.** `reconcileAfterProcessLoss` cancels process-bound
  effects (turn start, steer, interrupt, approval response) and requeues
  replay-safe ones (rollback, checkpoint, cleanup). Startup order: legacy import
  → provider runtime recovery → delegated-task recovery → effect worker.
- **[V] Queue hold.** After a provider failure (except validation) queued runs
  are `queueHeld` until an explicit resume; delegated completions sort ahead of
  user messages (`QueuedRunOrder.ts`). `UsageLimitRecoveryWorker` derives due
  work from persisted failures with deterministic command ids.
- **[V] Agent CLIs as runtimes.** One `ProviderAdapter` contract
  (`openSession` → `ensureThread`/`resumeThread`/`startTurn`/`steerTurn`/
  `interruptTurn`/`respondToRuntimeRequest`) over Codex `app-server` (JSON-RPC),
  the Claude Agent SDK, Cursor, Grok, OpenCode and ACP. Each session gets an
  injected MCP server with a per-session bearer token (hash only, idle 24 h
  expiry, revoked on stop) scoped to its thread.
- **[I] Still settling.** Open fixes for stale delegated state, completion
  delivery and Claude resume (#15201, #15004, #15785, #15866) show the parent /
  child path is the least mature part. We adopt the contracts, not the code.

Industry corroboration for the same shape: the transactional outbox
([microservices.io](https://microservices.io/patterns/data/transactional-outbox.html)),
idempotent receivers with stored responses
([Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)),
and the parent/child workflow model of durable engines
([Temporal child workflows](https://docs.temporal.io/child-workflows)).

## 3. Decision

**Absorb, don't adopt** (commandment). DPF keeps its own substrate and gives it
the four properties T3 proved: a command runs once, its effects and its record
commit together, an aggregate changes one command at a time, and recovery is
decided by the kind of effect, not by luck. Everything lands on substrate that
already exists:

- **The Workroom is the aggregate.** Not a new "thread" or "process" object.
- **`WorkroomActivity` becomes the log.** It is already "the existing Workroom
  ledger" in the long-running architecture; we give it a sequence, a command
  link and transactional writes instead of adding a parallel table. This
  respects §5.1's "no parallel engine, ledger, universal approval step".
- **Receipts generalise `AsyncInferenceOp`'s `(authorityScopeKey, requestKey)`
  pattern** and bind to the `ToolExecution` audit row every MCP call already
  writes.
- **Children run on the Postgres job engine** (`@dpf/jobs`), whose `JobWait`
  already parks a run without holding a worker. The parent's wake is a
  `JobWait` on a child-result event.
- **The recovery contract is §5.1's.** This design is its delegation adapter.

Rejected again, as in the 2026-09-04 review: a global session ledger spanning
installations (violates one Workroom/MCP authority per installation), a shared
writable worktree (one writer per worktree), and closing work on merge alone.

## 4. Design

### 4.1 Lease ownership and per-room serialisation (`BI-A7601AED`)

- `heartbeatWorkCapsule` renews only when `leaseHolderPrincipalId` equals the
  caller or `leaseExpiresAt <= now()`. Otherwise it refuses with
  `lease_held_by_other` naming the holder and expiry; nothing is written.
- `reassignWorkCapsuleExecutor` and the handover path take an
  `expectedHolderPrincipalId` (or `expectedExecutorRef`) and update with a
  compare-and-set `WHERE`; a mismatch refuses with `lease_holder_changed`.
  `BI-821EEB18`'s approved-handover path supplies the expected value it read.
- Every Workroom mutation runs inside `withWorkroomLock(workroomId, tx)`:
  `pg_advisory_xact_lock(hashtext('workroom:' || id))`, released at commit.
  When two rooms must change (parent and child), lock them one after the
  other in separate transactions, never nested.

### 4.2 Bounded retries and dead letters (`BI-6BB830E4`)

- `recoverExpiredLeases` increments `attempt` and, at `maxAttempts`, moves the
  run to `failed` with `error = 'lease_expired_exhausted'` and runs
  `onFailure`, exactly as a thrown error would. A worker that dies on every
  attempt therefore ends.
- The async-operation outbox gains `deliveryAttempts`, `nextAttemptAt` and a
  terminal `dead-lettered` disposition at a configured cap (default 8). The
  publisher selects due rows ordered by `nextAttemptAt`, so a failing row is
  pushed back and later rows publish; ordering stays per operation, not
  global.
- Dead letters are visible on the existing queue health surface
  (`get_queue_status`, `list_at_risk_queues`) with reason and last error; no new
  screen.

### 4.3 Command receipts (`BI-763D6E01`)

A `WorkroomCommandReceipt` row, unique on `(authorityScopeKey, commandId)`:
`commandType`, `targetKind`, `targetId`, `status` (`accepted|rejected`),
`result` JSON, `rejection` JSON, `fromSequence`/`toSequence`,
`toolExecutionId`. Writers in scope: Workroom lifecycle (create, claim,
heartbeat, status, handover, archive), child spawn, child result, cancel.

- MCP tools accept an optional `commandId`; the server derives a deterministic
  one from `ToolExecution` when the client gives none, so old clients keep
  working without idempotency (unchanged behaviour), and new clients get it.
- Same `commandId`, same target → stored result. Same `commandId`, different
  target → `command_id_conflict`. A rejection is stored and replayed.
- Retention: receipts follow their Workroom (operational, domain retention).

### 4.4 The Workroom log (`BI-62514632`)

`WorkroomActivity` gains `sequence` (unique per room, assigned in the command
transaction under the room lock), `commandReceiptId`, and `entity` JSON holding
the full updated record for state-changing kinds. One transaction per command:
receipt, activity rows, state rows, outbox rows.

- Subscribers read `snapshot@N` then `activity > N`; the SSE stream replaces the
  in-memory bus as the source of truth and keeps it only as a wake-up hint.
- Retention changes from `telemetry-bounded 180d` to `operational, domain` for
  rows with a `sequence`; legacy rows keep 180 d. The `@dpf` declaration and
  `table-classification.ts` change in the same migration.
- Publishing reads committed rows, so a crash between commit and publish loses
  nothing: the next reader resumes from its last sequence.

### 4.5 Durable child delegation and parent wake (`BI-CC057853`)

- `spawnWorkThread` commits the child TaskRun, a `WorkroomRelation(spawned-from)`
  and a `child_spawn` activity, then `jobs.send('agent/child.run', …)` with the
  receipt's command id as the event id. The in-process `void` dispatch is
  removed.
- On the child's terminal transition, a job step writes `child_result` on the
  **parent's** log (idempotent on child id + generation) and sends
  `agent/child.settled`. The parent waits with `step.waitForEvent` in one of
  two modes: `each` (wake per result) or `settled` (wake when every open child
  in the cohort is terminal). Results batch by cohort generation.
- A wait timeout returns `timed_out` and leaves the child running. Cancelling the
  parent sends `agent/child.cancel` to every open child (the job engine's
  `cancelOn`).
- The child's grants, runtime mode and authority are the intersection with the
  parent's at spawn (`child_authority_escalation_denied` otherwise), reusing
  `delegation-authority.ts`, whose chain links now close on the child's
  terminal state.
- The concurrency limit counts open children, not children ever spawned.
- The orchestrator-worker principle holds: children never hand off to each
  other; every transition goes through the parent's room.

### 4.6 Recovery by class and queue hold (`BI-2B6A8A74`)

- Every outbox effect and job step that touches the outside world declares
  `recovery: 'replay-safe' | 'process-bound'`. After process loss, replay-safe
  effects requeue; process-bound ones are cancelled with
  `cancelled_after_process_loss` recorded on the room. Undeclared counts as
  process-bound (fail closed).
- Boot order is fixed and logged: job engine lease recovery → delegated-child
  recovery → outbox workers.
- After a provider failure other than validation, the room's queued runs are
  `held`; `resume_workroom_queue` (a governed command with a receipt) releases
  them. Usage-limit recovery derives due work from persisted failures with
  deterministic command ids, never from in-memory timers.
- Queue order puts delegated results ahead of new work in the same room.

### 4.7 Agent CLIs as supervised runtimes (`BI-05715F4C`)

An executor adapter contract with DPF-owned ids and provider ids as references:
`openSession`, `ensureThread`, `resumeThread`, `startTurn`, `steerTurn`,
`interruptTurn`, `respondToRuntimeRequest`. First adapters: the Claude Agent
SDK and Codex `app-server`. Each session gets an injected DPF MCP credential
scoped to its Workroom and run, issued and revoked by the room, so authority
comes from the room rather than from a pasted PAT. CLI approval prompts become
room decision requests under existing escalation doctrine. This slice is
`xlarge` and is decomposed in its own plan; only its boundary is fixed here.

### 4.8 Migration and compatibility

- Each slice is independently shippable in the order 4.1, 4.2 → 4.3 → 4.4 →
  4.5, 4.6 → 4.7. 4.1 and 4.2 have no schema dependency on the rest.
- Every migration is additive and forward-only; existing rows stay valid
  (`sequence` nullable for legacy activity, receipts optional).
- Old MCP clients that send no `commandId` behave exactly as today.
- Existing installs converge on the next `/ops/self-upgrade`; no operator step.

## 5. Governed scope manifest

**OBJ-DDL-LEASE:** Only the current holder, or anyone after expiry, can renew a Workroom lease, and every change of holder names the holder it replaces.

**OBJ-DDL-BOUNDED:** Every retry in the job engine and the async-operation outbox is bounded, and exhausted work ends in a visible terminal state instead of looping.

**OBJ-DDL-RECEIPT:** A Workroom or delegation command with the same command id takes effect once, and every retry receives the stored result or rejection.

**OBJ-DDL-LOG:** A Workroom's changes are recorded in sequence in the same transaction as the change, and a reader can resume from any sequence without loss or reordering.

**OBJ-DDL-DELEGATE:** A delegated child survives a portal restart, returns its result to the parent's room, wakes the parent, and is cancelled with its parent.

**OBJ-DDL-RECOVER:** After process loss, each effect is replayed or cancelled according to its declared class, and a failing provider holds the room's queue instead of draining it.

**OBJ-DDL-RUNTIME:** A Workroom can drive an agent CLI as a supervised runtime whose platform authority is scoped to that room and run.

| Acceptance ID | Objective IDs | Acceptance statement |
| --- | --- | --- |
| AC-DDL-LEASE-REFUSE | OBJ-DDL-LEASE | A heartbeat from a principal that does not hold an unexpired lease is refused with `lease_held_by_other` and leaves the holder and expiry unchanged. |
| AC-DDL-LEASE-CAS | OBJ-DDL-LEASE | Executor reassignment with a stale expected holder is refused with `lease_holder_changed`; the approved handover path still succeeds. |
| AC-DDL-LEASE-SERIAL | OBJ-DDL-LEASE | Two concurrent mutations on one Workroom are applied one after the other, shown by a concurrency test against real Postgres. |
| AC-DDL-BOUND-LEASE | OBJ-DDL-BOUNDED | A run whose worker dies on every attempt reaches `failed` with `lease_expired_exhausted` within `maxAttempts` and runs `onFailure`. |
| AC-DDL-BOUND-OUTBOX | OBJ-DDL-BOUNDED | A permanently failing outbox row reaches `dead-lettered` at the cap and does not delay delivery of later rows for other operations. |
| AC-DDL-BOUND-VISIBLE | OBJ-DDL-BOUNDED | Dead-lettered work appears in queue status with its reason and last error. |
| AC-DDL-RECEIPT-ONCE | OBJ-DDL-RECEIPT | The same command id sent twice produces one effect, and both callers receive identical results. |
| AC-DDL-RECEIPT-REJECT | OBJ-DDL-RECEIPT | A rejected command returns the stored rejection on retry, and reusing a command id on another target is refused. |
| AC-DDL-LOG-TXN | OBJ-DDL-LOG | A crash injected between commit and publish loses no activity row and publishes none twice. |
| AC-DDL-LOG-RESUME | OBJ-DDL-LOG | A subscriber resuming from sequence N receives every later row exactly once, in order. |
| AC-DDL-DELEGATE-RESTART | OBJ-DDL-DELEGATE | Killing the portal while a child runs leaves the child to resume or finish after restart with no operator action. |
| AC-DDL-DELEGATE-WAKE | OBJ-DDL-DELEGATE | The parent is woken once per result batch in `each` mode and once per settled cohort in `settled` mode. |
| AC-DDL-DELEGATE-CANCEL | OBJ-DDL-DELEGATE | Cancelling the parent cancels every open child, and a child's attempt to widen its authority is refused. |
| AC-DDL-RECOVER-CLASS | OBJ-DDL-RECOVER | After injected process loss a replay-safe effect runs once more and a process-bound effect is cancelled with its reason on the room. |
| AC-DDL-RECOVER-HOLD | OBJ-DDL-RECOVER | An injected provider failure holds the room's queue and an explicit resume releases it; a child result runs before earlier-queued new work. |
| AC-DDL-RUNTIME-SCOPE | OBJ-DDL-RUNTIME | A CLI session's injected credential is refused outside its Workroom and run, and is revoked when the session stops. |

## 6. Delivery map

| Slice | Backlog | Size | Depends on |
|---|---|---|---|
| 4.1 Lease ownership | `BI-A7601AED` | medium | — |
| 4.2 Bounded retries | `BI-6BB830E4` | medium | — |
| 4.3 Command receipts | `BI-763D6E01` | large | 4.1 |
| 4.4 Workroom log | `BI-62514632` | large | 4.3 |
| 4.5 Durable delegation | `BI-CC057853` | xlarge (decompose) | 4.3, 4.4, job engine phase 3 |
| 4.6 Recovery by class | `BI-2B6A8A74` | medium | 4.2 |
| 4.7 CLI runtimes | `BI-05715F4C` | xlarge (decompose) | 4.4, 4.5 |

Related, not absorbed: `BI-C41AB195` (AgentSession rollup) reads the log 4.4
produces; `BI-05D7A0DC` (async completion hub) renders 4.5's results;
`BI-8C04456A` (nesting means delegation) is satisfied by 4.5's relation rows.

## 7. Decision inputs (`principle_decide`)

- **Options:** `absorb_into_existing_substrate` (§3), `adopt_t3_engine`
  (embed T3's Effect/SQLite orchestrator), `status_quo`.
- **Axes:** `long_term_maintainability`, `vendor_lock_in`, `blast_radius`,
  `operator_effort`, `governance_compliance`.

| | absorb | adopt_t3_engine | status_quo |
|---|---|---|---|
| long_term_maintainability | high: one substrate | low: a second runtime and store | low: eight mechanisms |
| vendor_lock_in (cost) | low | high: Effect-TS, SQLite, upstream churn | low |
| blast_radius (cost) | medium, sliced | high | ongoing incidents |
| operator_effort (cost) | low after 4.2 | medium | high: manual recovery |
| governance_compliance | high: Workroom/MCP authority kept | low: a parallel ledger | medium |

## 8. Out of scope

- Cross-installation orchestration (federation owns it).
- Any UI beyond existing Workroom and queue-health surfaces.
- Replacing Build Studio's phase orchestrator; it becomes a client of 4.5.
