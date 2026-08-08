# Spatial Operational Views — implementation plan

**Spec:** [2026-07-21-spatial-operational-views-design.md](../specs/2026-07-21-spatial-operational-views-design.md)
**Epic:** EP-SPATIAL-OPERATIONAL-VIEWS (extends EP-LIVING-BUSINESS-VIZ)
**Date:** 2026-07-21

This plan sequences the geometry/editor/map layer that upgrades the Operational Twin Framework from CSS-grid cards to true configurable facsimiles. Operator decisions (2026-07-21): **FLOOR + TERRITORY ship in parallel**; **prime-heavy + light-adjust** editing in v1 (full authoring in P3). Each phase is independently shippable; per-BI implementation plans are authored at pickup via `dpf-writing-plans`.

## Phase ordering & dependencies

```
P0  spaceKind derivation (BI-EA4B8638) ──┐
    SceneLayout model+migration (BI-CD99DC3F) ─┤
                                              ├─► P1 cartesian renderer (BI-E75AF714) ─► FLOOR e2e (BI-287AA5F7) ─┐
                                              ├─► P2 geo-map (BI-3B07C332) ─► TERRITORY (BI-8D9A2DE5) ─┬──────────┤
                                              ├─► P4 topology physicality (BI-D9FC7774)                │          │
                                              └─► P4 FACTORY/LINE (BI-E118D536)                          │          │
                                                                                                         ▼          ▼
                              P3 priming (BI-62B032C3) ◄── needs renderer + territory      P5 certification (BI-D5EFB4AE)
                              P3 full editor + remaining templates (BI-640C45FA) ◄── needs cartesian renderer
```

- **P0** (parallel, foundational): BI-EA4B8638, BI-CD99DC3F — pure derivation + one additive table. Source-only gates.
- **P1** (FLOOR track): BI-E75AF714 → BI-287AA5F7.
- **P2** (TERRITORY track, concurrent with P1): BI-3B07C332 → BI-8D9A2DE5. New-dependency review (MapLibre + PMTiles) via `tool-evaluation` gates BI-3B07C332.
- **P3**: BI-62B032C3 (priming), BI-640C45FA (full editor + remaining 8 cartesian templates — xlarge, decompose per template family at pickup).
- **P4** (node-graph, independent of P1/P2 UI): BI-D9FC7774 (topology physicality), BI-E118D536 (factory line; coordinate with a manufacturing archetype via `dpf-add-archetype`).
- **P5**: BI-D5EFB4AE — certification golden-journeys per spaceKind + simulator scenarios.

## Coverage

Every phase deliverable maps to a live BI (recorded via `record_plan_backlog_coverage` against the umbrella BI-EA4B8638). The xlarge BI-640C45FA carries an explicit decompose-at-pickup note (8 template families).

## Current backlog truth — 2026-08-08

This table reconciles the original sequencing with the live PostgreSQL backlog.
It is a status snapshot, not a replacement for the individual BI acceptance
criteria.

| State | Live items | What that means |
| --- | --- | --- |
| Done | `BI-EA4B8638`, `BI-CD99DC3F`, `BI-E75AF714`, `BI-2480D253`, `BI-CCE939AF` | The scene contract/model, shared cartesian renderer, precedent corpus, and reusable ROOMS presentation contract are delivered. `BI-CCE939AF` does not claim that the separate lodging persistence/command BIs are complete. |
| In progress | `BI-287AA5F7`, `BI-3B07C332`, `BI-76C1B949`, `BI-101255AC`, `BI-9FA3C3A4` | Restaurant FLOOR has merged source increments but remains open for authored-layout/busy-shift functional acceptance. Geo-map, HOA/property, YARD, and BOOK have active delivery records. |
| Open | `BI-8D9A2DE5`, `BI-62B032C3`, `BI-640C45FA`, `BI-D9FC7774`, `BI-E118D536`, `BI-D5EFB4AE`, `BI-DBADE5A7`, `BI-49036A4F` | Territory end-to-end, priming, remaining cartesian templates/editor, topology, factory line, certification, retrieval calibration, and HVAC dispatch are planned but not done. |

The epic remains open. A merged renderer or fixture does not close an
archetype's end-to-end BI: its canonical runtime journey and its own definition
of done remain authoritative. For restaurant status, resume from
`docs/superpowers/plans/2026-07-31-restaurant-business-grade-floor.md` rather
than the original phase shorthand above.
