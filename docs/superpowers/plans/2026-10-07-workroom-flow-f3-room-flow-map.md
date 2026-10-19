---
status: active
---

# Workroom flow F3: the room's flow map

- **Backlog item:** BI-FC0F4BD6
- **Epic:** EP-B70E718D
- **Design:** [Workroom flow map and measurement](../specs/2026-10-02-workroom-flow-map-and-measurement-design.md) §4, §7 (L3)
- **Depends on:** BI-4ADFFEDB (F2), which provides the stage telemetry this map reads.

## Design grounding

The map draws on existing sources and adds none of its own:

- **The work-shape registry** says what the room should do.
- **The drive snapshot** says where the room is.
- **F2's stage telemetry and snapshots** say how long each step took.
- **Layout:** decision DI-D4299F91D3A0 (`principle_decide`, high confidence) chose to place the map above the existing step list rather than replace it or put it behind a third toggle.
- **Inspection:** the existing panel is reused through the shared `?processStep` URL state.

## Backlog coverage

- Decision: atomic
- Parent: BI-FC0F4BD6
- Receipt: blocked-by: the coverage receipt binds this plan's immutable blob at a pushed commit, and this branch cannot be pushed until the local-CI gate passes; it is minted against the pushed blob immediately after
- Rationale: The pure model, the server loader and the SVG component are one picture. Each is useless without the other two.
- Dependencies: BI-4ADFFEDB (F2)

| Deliverable | Live BI | Requirements | Contracts | Flows | Verification | Independently shippable |
|---|---|---|---|---|---|---|
| Room flow map | BI-FC0F4BD6 | §4, §7 | `buildWorkroomFlowMap`, `loadWorkroomFlowMap`, `WorkroomFlowMap` | room page → flow map → step inspection | AC-F3-1, AC-F3-2, AC-F3-3 | No (atomic) |

## Acceptance

- **AC-F3-1:** every step of a declared shape renders in its derived lane. The step shows its state and, when held, the cause. A governed exit shows a gate.
- **AC-F3-2:** each step shows this room's time against the shape's typical time. Below five completed passes it says "not enough history yet" instead of showing a number.
- **AC-F3-3:** a flow-graph shape is declined, not drawn as a line. Choosing a step opens the existing inspection. Colours come only from theme tokens.

## Verification

- `workroom-flow-map.test.ts` and `WorkroomFlowMap.test.tsx` (jsdom).
- `typecheck` passes.
- The UX-fit manifest is `docs/ux-fit/2026-10-07-workroom-flow-map.ux-fit.json`.
- Running the room page on the canonical runtime is part of the release QA.
