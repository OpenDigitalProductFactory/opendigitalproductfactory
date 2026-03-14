# EA Value Stream Visual Refinement Design

**Date:** 2026-03-14  
**Status:** Proposed  
**Scope:** Refine the EA value-stream projection renderer so it visually matches a canonical value-stream layout, automatically sizes itself based on stage count, and supports contextual elements around the stream without requiring manual user layout work.

---

## Overview

The current value-stream projection restores the missing IT4IT value-stream view and proves the projection workflow, but the rendered result is still too much like a generic node card. It does not yet look or behave like a true value-stream visualization. The current `StructuredValueStreamNode` uses a fixed-width box and equal-width grid columns for stages, which makes the result visually rigid and forces a poor aspect ratio as stage count changes.

The next slice should make the value-stream projection feel like an actual value-stream diagram:

- one long directional parent band
- inset stage chevrons inside the band
- automatic width based on stage count and label length
- no explicit stage-sequence edges inside the container
- surrounding context elements positioned around the band
- supporting and serving capability blocks aligned beneath the band

This is still a structured projection, not a freeform canvas composition. The point is to preserve semantic fidelity while removing layout fiddling from the user experience.

---

## Problem Statement

The current renderer has three limitations:

1. **The parent stream shape is wrong**
   - it renders as a bordered rectangular card with a clipped header instead of a single long directional band

2. **The stage layout is wrong**
   - stages render as equal-width grid columns
   - overall width does not scale with stage count in a way that preserves the diagram’s aspect ratio

3. **The contextual layout is missing**
   - the view does not yet render upstream/downstream context nodes or the supporting/serving capability groupings that make the value stream interpretable as an architectural view

The result is technically functional but visually misleading and not aligned with how value-stream views are expected to look.

---

## Goals

- Replace the current card-like value-stream node with a true directional band layout.
- Automatically size the value-stream band based on stage count and stage label lengths.
- Preserve stage sequence as implied by containment and order, not explicit rendered edges.
- Keep individual stages relationship-capable for external connections.
- Add a structured layout model for contextual nodes around the stream.
- Add first-class support for stage-aligned and shared supporting blocks below the stream.
- Keep the core stream geometry automated so users do not resize or manually arrange the main structure.
- Preserve the generic projection direction so future reference models can use the same visual/layout approach.

---

## Non-Goals

- Full generic layout support for every reference-model projection type in this phase.
- Arbitrary manual positioning of the core value-stream band or nested stages.
- Complete semantic coverage of all possible surrounding reference-model elements.
- Full AI-generated contextual layout logic in this phase.
- Rich styling for every notation family beyond the current value-stream projection needs.

This phase is specifically about the visual and layout refinement of the existing value-stream projection.

---

## Key Design Decisions

### 1. The value stream is a structured composite, not a generic node

The parent stream should render as one directional horizontal band. The stages inside it are part of the stream’s structure, not sibling nodes laid out independently. This is already true semantically, and the renderer should reflect that directly.

### 2. Parent width is derived, not user-controlled

The stream band must automatically grow or shrink with the number of stages and their label lengths so that the overall diagram keeps a sane aspect ratio. Users should not manually resize the band.

### 3. Stage sequence remains implied inside the band

Earlier design decisions still apply:

- stage order is persisted in the model
- the view renders stages in order
- stage-to-stage flow relationships may exist in the graph, but they are hidden inside this projection because the container already implies the sequence
- stages remain valid relationship endpoints for external connections outside that implied internal sequence

### 4. Context is part of the value-stream view

To match the intended notation and meaning, the view should support more than just the stream band:

- upstream input or request context
- downstream outcome/value/stakeholder context
- stage-aligned serving/supporting capability groups
- shared supporting capabilities beneath the whole stream

These are meaningful relationships in the architectural view and should be laid out automatically.

### 5. Automatic layout matters more than manual freedom for the core structure

The visual model should be editable where it matters semantically, for example stage ordering. But the core stream geometry and placement should be derived by the renderer or layout helper so users do not “design” the notation by hand.

---

### 6. Drag-and-drop is the stage reorder interaction

The stage body should not contain left/right reorder buttons. Reordering should happen by drag-and-drop:

- dragging a stage within a value stream changes its sequence
- dropping a stage into a value stream or between stages resequences the model
- the parent stream band resizes automatically after reorder, insertion, or removal

---

## Desired Visual Language

### Parent band

The parent value stream should visually resemble a long service-delivery/value-stream band:

- one extended horizontal chevron or directional band
- stage area inset inside the band
- enough horizontal padding before the first stage and after the last stage to preserve directionality
- stable height across streams in the same view

### Nested stages

Each stage should render as:

- an inset chevron
- automatically sized within minimum and maximum bounds
- spaced evenly with directional rhythm
- aligned on a common centerline inside the parent band
- still connection-capable for explicit external relationships

The stage labels should remain readable without forcing a fixed equal-width grid.

### Context elements

The view should support three surrounding zones:

- **incoming context lane**
  - request/input/context nodes to the left of the stream band

- **outgoing context lane**
  - outcome/value/stakeholder nodes to the right or above-right of the band

- **supporting lanes**
  - stage-specific groups beneath the corresponding stage areas
  - one lower shared-support row or container for cross-stage support

This is enough to make the view legible without trying to replicate every detail of the example in one shot.

---

## Layout Model

The projection should enrich each projected element with a layout role. Recommended roles:

- `stream_band`
- `stream_stage`
- `context_in`
- `context_out`
- `stage_support`
- `shared_support`

These roles do not need to be a new database schema in this phase. They can be persisted in view-element or element properties as projection metadata if that keeps implementation simple.

### Core sizing algorithm

For a projected stream:

```ts
stageWidth = clamp(
  minStageWidth,
  estimateTextWidth(stageLabel) + stagePaddingX * 2,
  maxStageWidth,
);

bandWidth =
  bandInsetLeft +
  sum(stageWidths) +
  stageGap * (stageCount - 1) +
  bandInsetRight;
```

Recommended constraints:

- `minStageWidth`: ensures short labels do not collapse
- `maxStageWidth`: avoids a single long label dominating the whole stream
- `bandInsetLeft` and `bandInsetRight`: preserve the chevron rhythm of the parent band
- `stageGap`: constant directional spacing between stages

### Parent height

The band height should stay fixed within the current notation profile so the stream remains visually stable across the view. Child stage height should be derived from that fixed band height with internal padding.

### Context placement

For the first contextual slice:

- incoming context elements anchor to the left of the stream band
- outgoing context elements anchor to the right or upper-right of the band
- stage support groups anchor below the horizontal center of the corresponding stage
- shared support groups anchor below the full stream band

This should be deterministic. The user should not have to manually spread these groups out unless a future view type explicitly allows it.

---

## Structural Semantics

### Implied relationships

Inside the stream band:

- stage-to-stage flow remains implied by order
- explicit flow edges may remain in the graph for synchronization and future use
- explicit internal sequence edges stay hidden in this view

### Relationship-capable stages

Although internal sequence is implied, each stage still behaves as a real modeled element:

- stages can be the source or target of explicit relationships to capabilities, controls, outcomes, stakeholders, or other EA elements
- those relationships may render when they connect outside the internal stage-sequence path
- the value-stream container implies order, not all semantics

### Explicit relationships

Outside the stream band:

- incoming context to stream or stage may render explicitly if it clarifies meaning
- stage-to-support relationships may render explicitly
- outcome/value/stakeholder relationships may render explicitly

This gives the view the right balance of clarity and semantic economy.

---

## Editing Behavior

The user should be able to:

- reorder stages by drag-and-drop
- trigger a projection refresh
- inspect context and supporting groups
- connect external relationships to stages and the parent value stream

The user should not need to:

- resize the parent band
- place stages manually
- manually preserve stage spacing
- use embedded left/right buttons inside stages

For this phase, contextual nodes may remain more loosely placeable if the existing canvas demands it, but the projection should always regenerate a sensible default structured layout.

---

## MVP Slice

Recommended first implementation slice:

1. Replace the current `StructuredValueStreamNode` styling and sizing logic
   - true parent band
   - inset stage chevrons
   - computed width from stage count and labels
   - no embedded stage reorder buttons

2. Add projection layout-role metadata
   - enough to distinguish stream band, stage, and initial context/support zones

3. Add first contextual rendering support
   - incoming and outgoing context groups
   - stage-aligned support blocks
   - shared support row

4. Keep stage ordering and hidden sequence behavior unchanged
   - do not rework the structural conformance logic in this slice unless visual needs expose a real defect
   - move stage reorder interaction to drag-and-drop instead of in-node buttons

This is the smallest slice that materially improves the visual semantics and user experience without turning into a broad EA layout rewrite.

---

## Testing Strategy

The implementation should prove:

1. parent stream width grows as stage count or label size grows
2. nested stages render in a directional band rather than a fixed-width card
3. stage sequence edges remain hidden in the structured view
4. stages still support explicit external relationships
5. contextual/supporting layout roles render in their intended zones
6. drag-and-drop stage reorder still works after the visual refinement

Tests should include:

- component tests for `StructuredValueStreamNode`
- layout helper tests if geometry is moved into a pure helper
- existing structured-edge tests to make sure hidden sequence behavior remains correct
- interaction tests for drag-and-drop reordering if the current harness can support them, otherwise server-action and layout-state tests that prove resequencing behavior

---

## Success Criteria

This phase is successful when:

- the IT4IT value-stream projection looks like a true value-stream diagram instead of a generic node card
- the stream band automatically sizes itself based on stage count and label lengths
- users do not manually resize or lay out the core stream structure
- contextual/supporting elements begin to render around the stream in a legible way
- the projection still behaves deterministically and remains synchronized to the model

---

## Future Evolution

Later phases can build on this by adding:

- richer context rendering for different reference models
- alternative value-stream visual profiles
- AI-assisted contextual grouping based on uploaded reference artifacts
- notation-specific layout policies for other structured diagram types

The important thing in this phase is to establish the visual/layout pattern correctly so future work extends a strong foundation instead of patching around an inadequate renderer.
