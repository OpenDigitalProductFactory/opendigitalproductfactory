---
status: binding
---

# Workroom runtime core: decide, commit, outbox (S2, BI-C64EDA33)

Slice S2 of the T3 absorption ([spec](../specs/2026-11-13-t3-code-absorption-design.md), "Target architecture" item 1 and "Rooms and agent dialog" row S2). Decisions: DI-BEAADBEEB92C (adopt T3's decide/commit/outbox core) and DI-1B6A408A5F4F (the outbox is a new per-room `WorkroomEffect` table).

Pattern source: T3 Code's `Orchestrator`, `EventSink`, `EffectOutbox` and `EffectWorker` (pingdotgg/t3code@24e77473, MIT). DPF reproduces the design on its own substrate; no T3 code is copied.

## Problem (origin/main 89b09949)

- `apps/web/lib/workroom-runtime/supervisor.ts` writes `workspaceState.runtimeSession` with raw `jsonb_set` (:135-148). It runs outside any transaction, and only an in-process promise chain serializes it.
- Its room log is written fire-and-forget (`enqueue`, :180-184). A failed write is only a `console.error`.
- Provider answers, `startNext` and `finish` run as `void … .catch(() => {})` (:209-251).
- Queued turn input lives only in memory (`entry.queued`, :323). A restart loses it.
- `deliver` (:354-364) is three separate writes: the turn, the cursor patch and the log.
- `claimPendingWake` (`room-message-wake.server.ts:112`) commits "woken" before `deliverSupervisedTurn` runs (:430-440). A crash between them loses the delivery but still records it as delivered.
- Claim and adopt do part of their work after commit (`claim-backlog-item-handler.ts:265-268`, `adopt-worktree-handler.ts:125-135`): shape, harness, WorkItem anchor and ownership. A failure there leaves a half-made room.
- No record ties claim, worktree and session start together.

## Prior art compared

- **T3 Code (MIT) is the pattern adopted.** `OrchestratorV2` decides commands with no I/O. `EventSink` commits events, projections, the command receipt and outbox effects in one SQLite transaction. `EffectWorker` runs the effects under a lease and feeds results back as commands, and server-generated commands carry deterministic ids (`limit-arm:…`). DPF adopts the shape. It rejects T3's separate event store, because DPF's room log (`WorkroomActivity`, with a per-room sequence) is already the event log.
- **The transactional outbox (Chris Richardson, microservices.io "Transactional outbox"; Debezium's outbox event router) is the standard followed.** The message is written in the same transaction as the state change, and a relay delivers it at least once to consumers that are idempotent. DPF follows the standard, with one difference: its relay is the in-process worker, not change-data-capture, because effects drive local provider processes, not a broker.
- **DPF's own `AsyncInferenceOperationTransition` is the closest local model.** It is an outbox committed with the domain row, with a fenced lease and a dead-letter cap. `WorkroomEffect` copies its lease and attempt fields so the two outboxes read the same way.
- **Temporal and other durable-execution engines were not taken.** A saga engine would make a second workflow ledger beside the room log, which the 2026-09-04 review (DI-580C8D86B161) rejected. Here the claim saga is a set of outbox effects on the room itself.

## Options considered

1. **A new `WorkroomEffect` outbox table, written inside `runReceiptedCommand`'s transaction.** Chosen (DI-1B6A408A5F4F, high confidence).
2. **Reuse the Postgres job engine (`JobEvent`/`JobRun`).** Rejected: `sendToPostgres` uses its own `pg` pool, so the enqueue cannot join the decision's transaction.
3. **A JSON effect list on `workspaceState`.** Rejected: it has no lease and no per-effect status, and every effect write rewrites the room row.

The closest existing model is `AsyncInferenceOperationTransition` (`ai-providers.prisma:461-538`, `inference/async-operation-outbox.ts`): a transactional outbox with a leased worker. `WorkroomEffect` follows its shape.

## Design

### Data: `WorkroomEffect` (schema `work-coordination.prisma`, one migration)

| Field | Purpose |
|---|---|
| `id` | cuid |
| `workCapsuleId` | FK to the room |
| `commandId` | deterministic id of the command that decided it; `@@unique([workCapsuleId, commandId, ordinal])` |
| `ordinal` | 0-based index within that decision |
| `kind` | `open-session`, `start-turn`, `steer-turn`, `interrupt-turn`, `answer-request`, `close-session`, `revoke-token`, `announce-supervision-lost`, `record-plan-limit` |
| `processBound` | true when the effect needs the provider process that existed when it was decided |
| `sessionGeneration` | the runtime session generation it was decided for (null when not process-bound) |
| `payload` | Json |
| `status` | `pending`, `running`, `succeeded`, `failed`, `retired`, `cancelled` |
| `attemptCount` / `maxAttempts` | defaults 0 / 5 |
| `availableAt` | backoff |
| `leaseOwner` / `leaseExpiresAt` | worker lease |
| `lastError`, `createdAt`, `updatedAt`, `settledAt` | |

Index `(status, availableAt)`. A room's effects run in `createdAt, ordinal` order. An effect in backoff blocks the room's later effects, the same as T3's "retry backoff must block later effects".

`runtimeSession` (JSON, `supervised-session.ts`) gains `generation` (uuid per provider process), `hostId` (the portal process that holds it) and `queuedInputs: Array<{ commandId, prompt }>`.

### Decide (pure): `workroom-runtime/runtime-decider.ts`

`decideRuntimeCommand(snapshot, command, now) → { activities, sessionPatch, effects, reply }`. It does no I/O.

- **User commands:** `session.open`, `turn.request`, `turn.steer`, `room-message.deliver`, `turn.interrupt`, `session.stop`, `request.decide`.
- **Provider facts** (`runtime.event`): `turn-started`, `message`, `turn-completed`, `runtime-request`, `session-exited`.
- **Effect results:** `effect.succeeded`, `effect.failed`.

What it decides:
- A `turn.request` while a turn runs appends to `queuedInputs`; it is no longer pushed onto an in-memory array.
- `turn-completed` emits `start-turn` for the head of the queue.
- `session-exited` emits `revoke-token` and closes the session.

### Commit: `workroom-runtime/runtime-commit.server.ts`

`commitRuntimeCommand(db, capsuleId, command)` runs inside `runReceiptedCommand`, with scope `workroom-runtime:<capsuleId>` and `commandId` = the command's id. In one transaction it:
1. loads the room snapshot under the room row lock;
2. decides;
3. writes the activity rows (`recordWorkCapsuleActivity(tx, …, { deferPublication: true })`);
4. writes `runtimeSession` (`jsonb_set`);
5. inserts the effects (`createMany`, `skipDuplicates`);
6. stores the reply as the receipt.

Publication runs after commit. **An acknowledgement means only that the intent committed.**

### Deterministic ids

| Command | Id |
|---|---|
| Provider event | `runtime-event:<generation>:<eventSeq>`, where `eventSeq` is the adapter's monotonic counter |
| Effect result | `effect-result:<effectId>:<attempt>` |
| Room delivery | `room-message:<messageId>:deliver` |
| Boot retirement | `boot-retire:<generation>` |
| Claim saga steps | `claim:<capsuleId>:<claimActivityId>:<step>` |
| User call | the MCP call's `commandId` when given, else a uuid |

### Effect worker: `workroom-runtime/effect-worker.server.ts`

- **Claim:** take the oldest unsettled effect per room with `FOR UPDATE SKIP LOCKED`, only where it is `pending` and `availableAt <= now()`. Lease it for 2 minutes and increment the attempt.
- **Process-bound effects** run only in the process whose `hostId` holds the room's live session at the same `generation`; other processes skip them.
- **Run:** executors keyed by `kind` call the live `RuntimeSession`, `revokeTokens`, `held`, `onSupervisionLost` and the plan-limit note. The worker never mutates the room itself; it reports each result back with `commitRuntimeCommand(effect.succeeded | effect.failed)`.
- **Failures:** back off exponentially; at `maxAttempts` the effect is `failed` and the room gets an `error` activity.
- **Expired leases** return to `pending`.
- **When it runs:** an in-process kick after every commit, plus a 5-second sweep started from `instrumentation.ts` next to `reattachSupervisedSessionsOnBoot`.

### Restart: retire, don't replay

At boot, and before a reattach opens a new generation, `boot-retire:<newGeneration>` runs in one transaction:
- it marks every `pending` or `running` process-bound effect of an older generation `retired`, with one `effect-retired` activity;
- it keeps `queuedInputs`.

Once the new session is open and idle, the decider emits `start-turn` for the head of the queue. Effects that are not process-bound (revoke, announce, plan-limit note) are replayed.

### Room delivery (keeps the broker's guarantees)

`dispatchRoomMessage`'s supervised path commits `room-message.deliver` with id `room-message:<messageId>:deliver`. In the same transaction it sets the message's wake state to `woken` and records the `deliveredCursor`, then enqueues `start-turn`, or `steer-turn` where steering applies.
- `claimPendingWake` and the claim-before-turn guard are retired: the receipt and the unique effect give exactly-once.
- If the session is lost, the effect is retired and the message stays readable from the cursor.
- `SupervisedSessionPort` stays as the seam.

### Claim saga (AC-5)

The claim and adopt transactions also insert their after-commit steps as non-process-bound effects: `persist-claim-shape`, `persist-executor-harness`, `ensure-workitem-anchor`, `establish-room-ownership`, `request-home-claim`.
- The worker runs them idempotently and retries them; a crash leaves them pending, not lost.
- The room reads "setting up" until its saga effects settle.
- `session.open` is the last step when a runtime is requested.

## Delivery (three PRs, each through the full gate)

1. **PR 1, the core** (AC-1 to AC-4):
   - the `WorkroomEffect` model and migration;
   - `runtime-decider.ts` (pure, unit-tested) and `runtime-commit.server.ts`;
   - `effect-worker.server.ts` and the boot retire;
   - `supervisor.ts` reduced to the process host (live map, adapters, event → command) while every state change goes through commit;
   - durable queued input.

   Tests: decider tables; commit atomicity, where a forced failure after the activity insert leaves nothing; replay of the same `commandId` returns the stored reply and adds no effect; worker lease, backoff and ordering; boot retire keeps `queuedInputs` and retires process-bound effects; the existing `supervisor*.test.ts` and `supervised-*` tests stay green.
2. **PR 2, room delivery on the outbox.** `room-message.deliver` replaces `claimPendingWake` on the supervised path. The broker's wake, push and supervised-turn tests stay green (`room-message-wake.server.test.ts`, `room-messaging-pack.test.ts`, `room-update-fanout.server.test.ts`, `supervised-turn-delivery.test.ts`). A new crash-between-claim-and-deliver test fails on main and passes here.
3. **PR 3, the claim saga** (AC-5). Claim and adopt after-commit steps become effects. Test: inject a failure after commit; the room converges once the worker runs, and with no worker it reads "setting up", never half-made.

Guards: `work-capsules/mcp-handlers.ts` is at 800 LOC, so nothing is added there. New files stay under 500. `work-capsule-store.ts` can only shrink.

## Acceptance (from the item)

- **AC-1:** decided without I/O; one transaction for activity, projection, receipt and outbox (PR 1).
- **AC-2:** a leased worker; results come back as commands; an acknowledgement means only that the intent committed (PR 1).
- **AC-3:** deterministic ids, so retries are idempotent (PR 1 and PR 2).
- **AC-4:** restart retires process-bound effects and keeps unsent input (PR 1).
- **AC-5:** claim, worktree and session form one resumable saga (PR 3).
- **Room rows:** the broker's existing wake, push and supervised-turn tests pass after PR 2.

The item's criteria, word for word:

- AC-1: Runtime commands are decided without I/O. Activity rows, the room projection, the receipt and any outbox rows commit in one transaction.
- AC-2: A leased effect worker runs side effects and reports back as commands. An acknowledgement means only that the intent committed.
- AC-3: Server-originated commands use deterministic ids, so a retry is idempotent.
- AC-4: On restart, effects tied to a lost provider process are retired, not replayed. Unsent input stays queued.
- AC-5: Claim, worktree and session start form one resumable saga. An adopt-then-claim cannot leave a half-made room.
