---
status: active
---

# Workroom flow F4 and F5: the area's flow measures and the shape drill-in

- **Backlog items:**
  - BI-0FB4A049 (F5: portfolio tiles)
  - BI-C5CD9EAE (F4: shape drill-in)
- **Epic:** EP-B70E718D
- **Design:** [Workroom flow map and measurement](../specs/2026-10-02-workroom-flow-map-and-measurement-design.md) §5.2, §5.4, §7 (L1, L2), §8 step 4
- **Depends on:**
  - BI-4ADFFEDB (F2): stage telemetry
  - BI-FC0F4BD6 (F3): the flow-map component, reused here in aggregate mode

## Design grounding

- **Sources of truth:**
  - F2's stage telemetry and snapshots.
  - The rooms' drive snapshots.
  - The quarter's investment read model, which supplies points.
- **Shared helper:** the portfolio role-to-slug map was a private constant in `account-handover.ts`. It now lives in one module, `lib/portfolio/portfolio-role.ts`, and both callers use it.
- **Layout decision:** DI-F7556F9ECD89.
- **What was not added:** no new route and no new store.

## Backlog coverage

- Decision: decomposed
- Parent: BI-0FB4A049
- Receipt: blocked-by: the coverage receipt binds this plan's immutable blob at a pushed commit, and this branch cannot be pushed until the local-CI gate passes; it is minted against the pushed blob immediately after
- Rationale: Both deliverables share one view, but each can ship independently.
- Dependencies: BI-4ADFFEDB, BI-FC0F4BD6

| Deliverable | Live BI | Requirements | Contracts | Flows | Verification | Independently shippable |
|---|---|---|---|---|---|---|
| Five flow measures per portfolio and the four-plus-Unplaced comparison | BI-0FB4A049 | §5.2, §5.4, §7 L1 | `computePortfolioFlow`, `loadPortfolioFlowView`, `PortfolioFlowTiles`, `PortfolioFlowComparison` | area Work view → tiles → shape | AC-F5-1, AC-F5-2 | Yes |
| Shape drill-in with version picker and rooms at a step | BI-C5CD9EAE | §7 L2, §8 step 4 | `buildShapeFlowMap`, `loadShapeFlowView`, `ShapeFlowDrillIn` | shape → step → rooms | AC-F4-1 | Yes |

## Acceptance

- **AC-F5-1:** every portfolio shows the same five measures over the same window, each with its change against the prior window. Rooms with no portfolio appear as their own Unplaced column.
- **AC-F5-2:** a step that was only waited on counts as zero touch time, so flow efficiency is never overstated.
- **AC-F5-3:** flow load, flow time, flow efficiency and throughput each show an 8-week trend, and flow load shows its change against four weeks earlier. A cancelled run stops counting as in flow when it was cancelled.
- **AC-F5-4:** `PORTFOLIO_COLOURS` values are `--dpf-portfolio-*` tokens, defined for light and dark.

AC-F5-3 and AC-F5-4 shipped after #6151, which drew a trend only on flow time. The series come from the stage telemetry the tiles already read; no new store. The tiles use the existing token-styled `Trend` sparkline rather than report-kit `Chart`, which is sized for full charts, not 96-pixel inline trends.
- **AC-F4-1:** a shape renders across every room on it, with each step's queue. Versions with data can be compared. Choosing a step lists the rooms at that step.
- **AC-F4-2:** each step has a data box: its queue (an inventory triangle for rooms not being worked), typical dwell, process time and first-pass yield, or "too few to measure" below 5 exits.
- **AC-F4-3:** a timeline ladder shows each measured step's process time above and wait below, with the shape's flow efficiency (process ÷ dwell).
- **AC-F4-4:** a step whose last 7 days differ from its 4-week baseline by 25% or more is marked slower or faster, with both values. A step with fewer than 5 exits on either side is not marked.

AC-F4-2 to AC-F4-4 shipped after the first drill-in (PR #6151). That PR met only AC-F4-1, and this plan had not recorded the gap. They are computed in `lib/work-management/shape-step-measures.ts` from the existing `QueueMetricSnapshot` per-stage percentiles and live counts, and rendered by `components/ops/workrooms/ShapeStepMeasures.tsx` under the drill-in's map.

## Recorded limitations

- **AI spend:** joins the cost tile with F6 (BI-1737A427).
- **Version markers on the trend lines:** not shown yet. Before and after are compared through the version picker instead.
