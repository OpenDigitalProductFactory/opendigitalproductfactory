---
status: active
---

# Workroom flow F8: the daily flow review feeds the improvement facility

- **Backlog item:** BI-3C98682D
- **Epic:** EP-B70E718D
- **Design:** [Workroom flow map and measurement](../specs/2026-10-02-workroom-flow-map-and-measurement-design.md) §8
- **Depends on:** BI-0FB4A049 (F5), whose portfolio flow names each shape's bottleneck.

## Design grounding

- **No second improvement loop is built.** The platform already has one: `ImprovementSignal` (`lib/improvement-flywheel/signals.ts`). It deduplicates by `(sourceType, sourceId)`, counts recurrence, and files one backlog item through the shared intake once a signal recurs to `SIGNAL_BACKLOG_THRESHOLD`.
- **The flow review only feeds it.** Once a day, each pile of rooms (`MIN_ROOMS_HELD` or more held at one step) touches one signal. The signal is keyed on the stage queue and the cause.
- **Why this is enough.** A pile that persists across reviews is filed once. A pile that clears on its own is never filed.

## Backlog coverage

- Decision: atomic
- Parent: BI-3C98682D
- Receipt: blocked-by: the coverage receipt binds this plan's immutable blob at a pushed commit, and this branch cannot be pushed until the local-CI gate passes; it is minted against the pushed blob immediately after
- Rationale: The finding, the signal and the scheduled job are one loop. A finding with no job never runs, and a job with no signal shape has nothing to file.
- Dependencies: BI-0FB4A049

| Deliverable | Live BI | Requirements | Contracts | Flows | Verification | Independently shippable |
|---|---|---|---|---|---|---|
| Daily flow review | BI-3C98682D | §8 | `findFlowBottlenecks`, `bottleneckSignal`, `workroom/flow-review` | portfolio flow → bottleneck → ImprovementSignal → backlog | AC-F8-1, AC-F8-2 | No (atomic) |

## Acceptance

- **AC-F8-1:** only real piles become signals, meaning `MIN_ROOMS_HELD` or more rooms at one step. Each pile keeps one identity per step and cause across reviews.
- **AC-F8-2:** the job is registered and described in the scheduled-job catalog. It runs once a day and honours the enabled gate. The improvement facility, not this job, files the backlog item.

## Recorded limitations

- ~~**No baseline-versus-current receipt.**~~ Delivered by F8b below.

## F8b: review receipt and version markers (BI-C684AF45)

- **Receipt as a projection.** `computeFlowReviewHistory` (`lib/work-management/flow-review-receipt.ts`) derives each review from the version's daily `QueueMetricSnapshot` rows. It stores nothing new (DI-01E4DB4D7126 scored this 8.19, against 4.82 for a receipt table and 2.92 for signal evidence). The baseline is the version's first 28 days of step data. Reviews fall every `reviewPoint.everyDays` after that, starting with the first one at or after the baseline's end. Each review compares the trailing `FLOW_WINDOW_DAYS` with the baseline.
- **Bottleneck.** The step with the most rooms held (snapshot `depth`) × its typical wait (`typicalStepWaitMs`), through the same `topByWaitTimesQueue` the home sentence uses (F7b). Snapshots carry no hold cause, so only the latest review names one, taken from the live holds.
- **Version markers.** `PortfolioFlow.weeklyVersionChanges` marks the week a shape version first ran in a portfolio, but only where an earlier version of the same shape ran there before it. The three trends draw a dashed rule there and name it in their accessible label.
- **Still blocked:** the escalation rule (two consecutive reviews naming the same pile file one item, routed through EP-C00F61F4) waits for BI-B146AB6B. Until then the daily review's signal threshold (three sightings) stands in.

- **AC-F8b-1:** a version with step data shows its baseline. It shows each review at its review point, newest first, with the measures against baseline and the step where the most waiting accrued. Before the baseline ends, it says when the first review is due.
- **AC-F8b-2:** the week a newer shape version replaced an older one in a portfolio is marked on the flow time, efficiency and throughput trends.
