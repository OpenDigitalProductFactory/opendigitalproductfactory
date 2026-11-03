# Workroom cycle continuity

The implementation follows [phase 2 of the approved delivery plan](../superpowers/plans/2026-09-12-cross-workroom-learning-delivery-plan.md#phase-2--capture-cycles-and-recovery). The external pilot remains the sole review scheduler until an explicit, tested handoff. This document does not establish that handoff or operational acceptance.

## Existing persistence and bounded reads

Room lifecycle mutations retain the existing parent `WorkItem` row lock. New cycle children use the existing unique `WorkItem.sourceKey` for their room and cycle identity. Exact carrier reads also include the parent binding. A source-key hit whose stored cycle boundary disagrees is an integrity error, not an idempotent success.

New completion packets use a deterministic `WorkItemMessage.messageId` over room, cycle and carrier. Completion and its packet remain in the same transaction. A retry reads that identity and checks the packet boundary before returning its receipt. Existing packets retain their original identity and content.

Legacy lookup and explicit history reads share `room-cycle-pagination.ts`. Each request reads at most 200 rows, ordered by `(createdAt, id)`, with a composite cursor. A history larger than 1,000 rows refuses the lifecycle mutation with `cycle_history_budget_exceeded`; it never treats a truncated view as proof that no prior cycle or receipt exists. One lookahead row distinguishes exactly 1,000 records from overflow. Invalid or non-advancing cursors fail explicitly. Legacy outcome lookup filters to outcome packets, so ordinary discussion messages do not consume its history budget.

These limits bound legacy lifecycle reads. They are not the review ingestion checkpoint or a promise that every legacy history can be mutated without reconciliation. A durable ingestion high-water mark, atomic output/cursor advancement and late-event handling remain required by phase 2.

## Recovery integration still required

The standing drive fences task scheduling against the room's current lease inside its transaction, uses stable task identities, and retains run-scoped stage receipts. Sequential and graph branches share `workroom-drive-scheduling.ts`. The scheduling transaction now writes the task, a versioned `workroomDispatchCheckpoint` and an append-only `workroom-dispatch-confirmed` activity together. The checkpoint records the room objective, exact declared shape/stage/tools, lease authority, monotonic revision, task identity, enqueue time and the next reconciliation action. Unknown artifact, dirty-output and acceptance attribution remain explicitly null. A malformed or foreign prior checkpoint refuses scheduling instead of resetting its revision. The shared room observation exposes validated checkpoints without turning them into completing stage receipts.

Dispatch identity includes the shape run, calendar attempt cycle, stage and graph rework iteration. The scheduled task id is deliberately reused across sequential stages and later runs; it is not enough to distinguish replay from progression. The calendar attempt cycle preserves the existing writeback latch's permitted daily retry within an unfinished run. Both dispatch paths pass those existing planner identities into the shared scheduling transaction.

The drive also reads the room's primary and parallel tasks each tick (`workroom-drive-stage-run.ts`). It reads the stage and enqueue time from the checkpoint, the latest run's start, status and error, and the exact run's owner-scoped approval outcomes. With that in view, the writeback latch (`writeback-latch.ts` `decideWritebackLatch`, BI-7C0B2BD6, BI-E458A9CB) distinguishes an approval wait from failed execution:

- A task recorded as `proposed` holds while any linked approval is waiting, declined, expired, failed, cancelled, not run, or unknown. This wait survives a new calendar cycle and missing older enqueue timestamps. Only recorded execution releases the approval wait; it does not supply completing stage evidence. Unreadable or truncated approval reads cannot establish execution.
- An outstanding required approval takes precedence over a successful same-tool report or a different missing write in a Workroom run. Recording the blocker cannot hide the pending business action. An expired ancestor is excluded only when the supported **Ask again** lineage names its exact replacement with the same owner, coworker, action, run and stored binding fingerprints; unrelated approvals stay held. The original record remains in history.
- If no task exists for the stage, or no enqueue was recorded, the ordinary execution latch releases.
- A run still unfinished within twice the stall window (2 h) keeps the room paused and leaves the task active, so the scheduler can still run it. Past that deadline it counts as a failure.
- A run that finished since the enqueue without a completing receipt, outside an approval wait, counts as one failure for the stage in that cycle. The room is retried after a backoff of 15 min × 2^(failures−1). A retry carries its attempt number as the dispatch scope's iteration, so the scheduling transaction enqueues it again instead of replaying the previous attempt.
- After three failures in a cycle the room stays paused. The pause's ledger, its trail row and the snapshot's `writebackRetry.lastError` name the last error, and the stall surfaces show the pause. A new cycle resets the count.

Each tick also caps how many agent dispatches it starts (`drive-dispatch-cap.ts`, WWMD DI-7109D22D4812). The cap is the number of provider slots the agent-task dispatcher itself runs with (`providerSlotsFromCapacity`, BI-6DBA2238). That count comes from the CLI pool rows the capacity drain reads and the in-process CLI slot gate. A rate-limited or spent pool gives one, so the drive never queues work faster than tasks can run. A room past the cap records `do_not_wake` / `awaiting_agent_capacity` ("waiting for agent capacity", in motion) and dispatches on a later tick. The drive has no hook into the demand start ranking, so rooms go oldest-waiting first: by when each entered its current hold, then by id. Graph rooms are not capped.

Graph tokens use their own task's approval wait; their ordinary execution latch and callers that cannot see the task keep the cycle-bounded rule. The scheduler also parks the next periodic run of a task with a Workroom-stage assignment when its required action is proposed. A throw while driving one room is caught, logged and returned in the tick result as an `error` plan, and the tick goes on to the remaining rooms. Before this change, one room failing task-identity reconciliation ended the tick for every room after it.

The current scheduled run may report a blocked outcome for its assigned non-governed stage without another human decision (`room-stage-mandate.ts`). The server checks run identity, coworker assignment, room, shape version, stage, declared evidence kind and a nonblank summary. Explicit always-approve policy is preserved. This exact reporting mandate neither authorizes completion nor grants the blocked business action; admission, tool grants and consequence checks still apply. See [Workroom reports and approval waits](../user-guide/workroom-approval-recovery.md).

Each task retains its latest enqueue checkpoint in its existing taskConfig JSON, atomically with the room checkpoint and activity. Recovery can therefore reconcile an earlier parallel branch even after another branch advanced the room checkpoint. The transaction validates the persisted task owner and stage/tool contract against its own receipt, then validates agent and tools for an identical dispatch. A match preserves the original receipt and execution state; a new stage, run, attempt cycle or rework iteration can enqueue normally. A missing latest task or mismatched contract refuses replay. Legacy same-stage receipts without cycle identity require explicit reconciliation rather than guessing a new cycle. This does not reconstruct deleted earlier tasks or an entire lost graph; those still require the append-only activity history.

The drive owns the stop of the tasks it enqueued (WWMD DI-6DB14CC7C8E9, BI-1DDCE164). When a sequential room concludes attention on a stage other than the one its latest checkpoint enqueued, that task is deactivated. Same-stage attention leaves it alone, because a same-stage dispatch replays the receipt without reactivating the task. Each live tick also deactivates the workroom tasks of rooms the selection leaves out: archived, terminal or Build Studio rooms. A room that later returns to the drive at the same stage, run and cycle replays its receipt and stays inactive until a new stage, run or cycle enqueues again.

The later drive snapshot remains a separate transaction. Losing that snapshot no longer loses evidence of enqueue, but reconstructing the whole graph and reconciling execution before replay remain required. This change does not claim exactly-once external effects or automatic restart recovery. Task enqueue is itself a database effect, so its confirmation is atomic; external execution still needs a pre-dispatch intent and independently confirmed result from its owning executor.

The remaining checkpoint contract must preserve objective, remaining acceptance, artifact and dirty-output provenance, confirmed effects, pending intent, authority, blocker ownership and the next safe action. Revision comparison must fence replaced executors. A scheduled task confirms enqueue only; it does not confirm the task's external effects. Unknown publication outcomes require reconciliation before replay.

Qualification requires an independent restart with conversation unavailable, interrupted output/cursor transactions, concurrent replacement, late evidence, denied authority and the prescribed load workload. Source tests of bounded reads do not satisfy those operational cases.

## Verification and rollback boundary

Colocated pagination and Prisma-adapter tests cover equal timestamps, page boundaries, exact-limit lookahead, overflow refusal, parent-scoped direct identity lookup and malformed cycle identities. Lifecycle and bookkeeping tests exercise existing callers. Shared pagination and identity resolution constitute the refactoring contribution of this portion.

Rollback retains all cycle children and outcome packets. Existing parsers can still read their evidence. No room cleanup, authority reassignment, schema deletion or review-scheduler activation is part of this change.

## Bounded assignment and continuation briefs

BI-4A06271B extends the existing stage briefing and enqueue checkpoint. Sequential
and graph dispatch share one projection for assignment, acceptance, declared tools,
source, task/run/cycle/iteration, owner and next action. The projection reserves
mandatory facts and caps its complete serialized representation at an estimated
3,000 tokens. This estimate uses the existing context counter; it is not provider
billing usage. An optional shape description can be deferred to its versioned
reference. Mandatory overflow refuses dispatch without advancing the stage or
claiming an execution result; unaffected graph branches may still proceed.

The external reader applies the same estimate to its complete response. A
consumer can have a smaller output allowance; its output guard then returns a
whole-response refusal without a partial assignment or continuation version.
The reader does not inherit the generic unknown-window allowance.

The existing `get_workroom` tool accepts `continuationMode: "bounded"` for a fresh
external session. An exact `continuationTaskId` selects that task's checkpoint;
`continuationStageKey` selects a current manual branch when no scheduled task is
being resumed. Ambiguous or unknown stages require reconciliation. The reader
checks current room content access before reading context, and does not return
another room's checkpoint or the originating transcript. It resolves the current
shape and preserves acceptance and stop obligations. Activity references point to
bounded, separately authorized detail reads; a reference alone is not evidence
of completion. Pass the returned `continuationVersion` on a later read to detect
changed context. A brief is advisory and never grants tools, authority or replay.

Manual continuation also carries the existing executor checkpoint when its recorded
head matches the room, or when neither uses repository source. It preserves the
saved next action, remaining work and risks within the same budget. The note is
room-scoped advice, explicitly unbound to the selected graph stage; it is not a
live job status or a permission grant. A missing, changed or malformed source
binding requires reconciliation. Checkpoint and provenance changes invalidate the
manual continuation version. Scheduled-task reads use their own checkpoint and
exclude this room-level note.

New dispatch checkpoints retain repository and head identity. Scheduling compares
that snapshot with the locked room before enqueueing. Same-intent retries preserve
the original checkpoint; changed or missing source provenance cannot relabel a
previous effect. The existing scheduled-stage authority resolver also compares the
run and task source with the current room before granting stage authority. A stale
binding cannot create another approval request or inherit a completing mandate;
the narrowly scoped blocked-report path remains available. Legacy checkpoints
remain readable with unknown source. Unknown execution outcomes require
reconciliation, even when enqueue was confirmed.

At entry, retrieve the linked assignment and relevant durable evidence. At a
checkpoint, handoff or close, use the existing governed evidence and scoped
context writers for changed work, remaining obligations and canonical references.
Do not duplicate a transcript or treat retrieved prose as instructions. External
clients without session control use the saved brief for manual continuation; this
read does not create chats, send messages or schedule automatic inference.

The shared projection and consolidated native dispatch assembly are the
refactoring portion. Storage, stage receipts, authority adapters, scheduling and
receiver acknowledgement retain their existing owners. Source tests establish
bounds, current access, provenance and branch isolation; served native/external
rehydration and the program pilot are separate qualification obligations. This
implementation alone does not establish lower cost, cache hits or completed
program outcomes.
