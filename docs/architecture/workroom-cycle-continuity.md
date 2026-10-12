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

Each task retains its latest enqueue checkpoint in its existing taskConfig JSON, atomically with the room checkpoint and activity. Recovery can therefore reconcile an earlier parallel branch even after another branch advanced the room checkpoint. The transaction validates the persisted task owner and stage/tool contract against its own receipt, then validates agent and tools for an identical dispatch. A match preserves the original receipt and execution state; a new stage, run, attempt cycle or rework iteration can enqueue normally. A missing latest task or mismatched contract refuses replay. Legacy same-stage receipts without cycle identity require explicit reconciliation rather than guessing a new cycle. This does not reconstruct deleted earlier tasks or an entire lost graph; those still require the append-only activity history.

The later drive snapshot remains a separate transaction. Losing that snapshot no longer loses evidence of enqueue, but reconstructing the whole graph and reconciling execution before replay remain required. This change does not claim exactly-once external effects or automatic restart recovery. Task enqueue is itself a database effect, so its confirmation is atomic; external execution still needs a pre-dispatch intent and independently confirmed result from its owning executor.

The remaining checkpoint contract must preserve objective, remaining acceptance, artifact and dirty-output provenance, confirmed effects, pending intent, authority, blocker ownership and the next safe action. Revision comparison must fence replaced executors. A scheduled task confirms enqueue only; it does not confirm the task's external effects. Unknown publication outcomes require reconciliation before replay.

Qualification requires an independent restart with conversation unavailable, interrupted output/cursor transactions, concurrent replacement, late evidence, denied authority and the prescribed load workload. Source tests of bounded reads do not satisfy those operational cases.

## Verification and rollback boundary

Colocated pagination and Prisma-adapter tests cover equal timestamps, page boundaries, exact-limit lookahead, overflow refusal, parent-scoped direct identity lookup and malformed cycle identities. Lifecycle and bookkeeping tests exercise existing callers. Shared pagination and identity resolution constitute the refactoring contribution of this portion.

Rollback retains all cycle children and outcome packets. Existing parsers can still read their evidence. No room cleanup, authority reassignment, schema deletion or review-scheduler activation is part of this change.
