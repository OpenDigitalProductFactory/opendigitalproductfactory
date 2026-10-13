---
status: active
---

# Workroom flow F6: AI spend attributed to Workrooms

- **Backlog item:** BI-1737A427
- **Epic:** EP-B70E718D
- **Design:** [Workroom flow map and measurement](../specs/2026-10-02-workroom-flow-map-and-measurement-design.md) §5.2 (cost)
- **Depends on:** BI-0FB4A049 (F5), whose cost tile and comparison table show the spend.

## Design grounding

The spec allowed a schema change only if the trace path proved incomplete. It did not need one:

- `TokenUsage` carries no room key, and its `traceId` is a random id per call. That route to a room is a dead end.
- `AdapterRunTelemetry` already costs every inference per thread. This is the per-thread ledger from BI-CCF1ACBB.
- The threads a room uses carry context keys the platform sets, and those keys name the room:
  - `scheduled:workroom-<capsuleId>-<shape>` for dispatched stage work
  - `coworker:/workspace/cases/work-capsule%3A<capsuleId>` for the room's own conversation
- Joining the two attributes spend to a room exactly, with no new column and no estimate from overlapping time windows.
- Spend on threads that name no room stays unattributed.

## Backlog coverage

- Decision: atomic
- Parent: BI-1737A427
- Receipt: blocked-by: the coverage receipt binds this plan's immutable blob at a pushed commit, and this branch cannot be pushed until the local-CI gate passes; it is minted against the pushed blob immediately after
- Rationale: The attribution rule and the place it is shown form one change. Each is unobservable without the other.
- Dependencies: BI-0FB4A049

| Deliverable | Live BI | Requirements | Contracts | Flows | Verification | Independently shippable |
|---|---|---|---|---|---|---|
| AI spend per room, rolled up to portfolios | BI-1737A427 | §5.2 | `roomOfThreadContext`, `loadRoomAiSpend` | thread → room → portfolio cost tile | AC-F6-1, AC-F6-2 | No (atomic) |

## Acceptance

- **AC-F6-1:** each thread's spend is attributed to the room its context key names. A thread that names no room is not attributed.
- **AC-F6-2:** the portfolio cost tile and the comparison table show AI spend for each portfolio's rooms over the flow window. When the spend cannot be read, they say so instead of showing zero.

## Recorded limitations

- **Spend per stage is not shown.** A room's dispatched thread is reused across its stages, so splitting spend by stage would need time overlap. The spec rules that out as an estimate.
