---
status: active
---

# Workroom flow F2: every stage reports into the shared flow telemetry

- **Backlog item:** BI-4ADFFEDB
- **Epic:** EP-B70E718D
- **Design:** [Workroom flow map and measurement](../specs/2026-10-02-workroom-flow-map-and-measurement-design.md) §5.2 and §6
- **Depends on:** BI-2A3C63FA (F1, merged: `classifyDriveSegment`)

## Design grounding

- **Source of truth for measurement.** The one flow-telemetry contract (`QueueTelemetryEvent` → `QueueMetricSnapshot`, `lib/queue/flow-metrics.ts`, EP-3516E23D). F2 adds no metrics store. A stage is a queue.
- **Source of truth for where a room is.** The drive snapshot at `workspaceState.workroomDrive`, classified by F1.
- **Decision.** Extend the queue contract with `held` / `released` and hold-aware durations. A queue that never holds is measured exactly as before.

## Backlog coverage

- Decision: atomic
- Parent: BI-4ADFFEDB
- Receipt: blocked-by: the coverage receipt binds this plan's immutable blob at a pushed commit, and this branch cannot be pushed until the local-CI gate passes; it is minted against the pushed blob immediately after
- Rationale: The emitter, the hold-aware math, the snapshot columns and the replay only mean something together. Without the math the emitter produces wrong numbers, and without the emitter the math has no input.
- Dependencies: BI-2A3C63FA (merged, PR #6056)

| Deliverable | Live BI | Requirements | Contracts | Flows | Verification | Independently shippable |
|---|---|---|---|---|---|---|
| Stage = queue emitter, hold-aware math, snapshot columns, drive-log replay | BI-4ADFFEDB | §5.2, §6 | `wr:<shape>@<version>:<stage>`, `held` / `released`, `heldP50Ms` / `heldP95Ms` / `processShare` | drive state change → stage transitions; drive log → replayed transitions | AC-F2-1, AC-F2-2, AC-F2-3, AC-F2-4 | No (atomic) |

## What changes

| File | Change |
|---|---|
| `lib/queue/flow-metrics.ts` | `held` and `released` transitions; `heldSpans` on a timeline. Touch time excludes holds inside the service span, and wait is the rest of the cycle. Counting can be bounded to a window. Adds `heldP50/95Ms` and `processShare` |
| `lib/queue/queue-metrics-rollup.ts` | Rebuilds hold spans. The first start wins. Reads each windowed item's earlier events, so a multi-day stage is measured over its whole life, which also fixes every other multi-day queue. Live depth and WIP per stage |
| `lib/work-management/workroom-stage-telemetry.ts` | Pure planner from two drive snapshots to queue transitions; stage queue keys; live counts |
| `lib/work-management/workroom-stage-backfill.ts` | Replays the drive log into telemetry once and idempotently, from inside the hourly aggregator, so trends start with history |
| `lib/queue/functions/workroom-drive.ts` | Emits when the drive writes a state-change row. Sequential shapes only |
| `lib/work-management/work-shapes.ts` | `readDeclaredWorkShapeRef`, which the key reader now uses |
| Migration `20261007130000_queue_snapshot_held_and_process_share` | Three nullable columns |

## Acceptance

- **AC-F2-1:** a state change emits the planned transitions under `wr:` keys. A stage entered while being worked is enqueued and then started. A wait or block is held, with its cause. Leaving a stage releases any hold and then finishes it.
- **AC-F2-2:** a stage that alternates working and waiting reports touch time without the holds, wait as the rest of the dwell, and processShare as their ratio. A multi-day stage counts once, in the window where it finished.
- **AC-F2-3:** live depth and WIP per stage come from the rooms currently in it.
- **AC-F2-4:** replaying the 23 September drive log names the missing-coordinator hold at its stage for every room in the pile. The replay is idempotent and stops at the first live event.

### Acceptance as filed on BI-4ADFFEDB

- Snapshots exist for `wr:` keys.
- `/api/metrics` exposes them.
- The coworker queue pack reads them.
- Replaying the drive log for 2026-09-23 shows about 200 rooms held at one stage with the cause `missing_explicit_coordinator`.

**How each one is met**

| Criterion | How it is met |
|---|---|
| Snapshots for `wr:` keys | `aggregateQueueMetrics` writes them. |
| `/api/metrics` | `recordQueueTransition` mirrors every transition into the existing `dpf_queue_*` series. |
| Coworker queue pack | The queue-awareness pack reads `QueueMetricSnapshot` and picks up the new rows with no change. |
| 23 September replay | The hold cause carries the conformance deviation: `conformance_pause:missing_explicit_coordinator`, added in the views PR. `workroom-stage-backfill.test.ts` replays that pile. |

## Recorded limitations

- **Graph rooms are not measured yet.** Parallel branches are deferred until a graph shape is live.
- **Replayed history is coarse.** It has drive-tick resolution and uses each room's current shape claim. Live events have neither limitation.
- **Human touch time is not captured.** It counts as wait.

## Verification

- `vitest run lib/queue lib/work-management/workroom-stage-*.test.ts` passes.
- `typecheck` and `typecheck:tests` are clean.
- The local-CI gate runs the migration against Postgres.
