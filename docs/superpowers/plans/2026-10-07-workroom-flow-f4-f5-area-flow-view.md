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
- **AC-F4-1:** a shape renders across every room on it, with each step's queue. Versions with data can be compared. Choosing a step lists the rooms at that step.

## Recorded limitations

- **AI spend:** joins the cost tile with F6 (BI-1737A427).
- **Version markers on the trend lines:** not shown yet. Before and after are compared through the version picker instead.
