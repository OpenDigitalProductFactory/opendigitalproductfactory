# EA Value Stream Layout Tweaks Design

**Date:** 2026-03-14  
**Status:** Proposed  
**Scope:** Refine the current value-stream renderer to reduce header height, prevent right-edge stage clipping, and preserve the chevron shape during drag-and-drop reorder.

---

## Overview

The current value-stream renderer is directionally much closer to the target notation, but three presentation problems remain:

1. the header stack consumes too much vertical space inside the parent band
2. the rightmost nested stage can clip against the band edge at the current scale
3. dragging a stage falls back to the browser's generic drag ghost instead of keeping the chevron shape

These are renderer and interaction defects, not model defects. The next slice should stay focused on layout and drag presentation while keeping the existing structured-value-stream model, resequencing callback, and hidden internal flow behavior unchanged.

---

## Goals

- Compress the parent band header into a narrower top-to-bottom footprint.
- Use the unused right-side header space instead of stacking text into extra rows.
- Adjust band sizing so the last stage renders fully without clipping.
- Preserve the chevron shape and styling while a stage is being dragged.
- Keep the existing drag/drop resequencing semantics intact.

---

## Non-Goals

- Changing the persisted EA structure model.
- Reworking structured child sequencing or conformance behavior.
- Adding new contextual lanes or support blocks in this pass.
- Turning stages into fully independent React Flow nodes.

---

## Key Design Decisions

### 1. The band header becomes a compact horizontal row

The current parent band stacks:

- `Value Stream`
- stream name
- lifecycle text
- optional warning banner

That wastes vertical space and makes the band taller than it needs to be. The refined layout should use a compact row:

- left side: stream label and stream name
- right side: lifecycle text
- warning pill aligned in the same header area when present

This keeps the stream visually flatter and reserves more height for the stage lane.

### 2. Band width must include right-edge safety space

The current width math is close, but it does not leave enough safety room for the final stage chevron to sit comfortably inside the parent band's directional tail. The revised layout helper should add explicit end clearance for the last stage so the final chevron does not visually clip.

This is still deterministic width calculation, not manual resizing.

### 3. Stage dragging should use a custom drag preview

The browser default drag preview does not preserve the chevron shape, which makes the drag interaction feel visually broken. The renderer should create a custom drag image that matches the current stage chevron styling closely enough that the stage appears to remain itself while moving.

This is only a presentation change:

- same drag-and-drop semantics
- same insertion markers
- same server action
- same resequencing behavior after drop

---

## Desired Layout

### Parent band

- slightly flatter vertical profile
- compact top row for title/status
- stage lane moved upward relative to the previous version
- still directional, still visually dominant

### Nested stages

- same chevron form
- same ordered lane
- enough right-side band clearance for the final stage
- no clipping at the current standard canvas scale

### Drag state

- dragged stage should visually remain a chevron
- drag preview should roughly match size, color, border, and label hierarchy
- drop markers can remain simple narrow indicators

---

## Layout Helper Changes

The layout helper should continue to calculate per-stage width, but the band-width formula should be expanded to include explicit end clearance:

```ts
bandWidth =
  bandInsetLeft +
  sum(stageWidths) +
  stageGap * (stageCount - 1) +
  bandInsetRight +
  bandEndClearance;
```

Recommended intent:

- `bandInsetLeft`: room for the directional lead-in
- `bandInsetRight`: room for the directional tail
- `bandEndClearance`: additional visual buffer so the last stage does not press into the tail edge

The helper should also expose any constants needed by the compact header layout so the renderer does not scatter magic numbers.

---

## Interaction Changes

### Drag preview

On drag start:

- create an off-screen element styled like the stage chevron
- populate it with the same text hierarchy as the live stage
- call `dataTransfer.setDragImage(...)`
- clean up the temporary element after drag start/end

### Resequencing

Keep the existing callback path:

```ts
data.onMoveStructuredChild?.({
  childViewElementId,
  targetOrderIndex,
});
```

No server-side contract change is needed for this pass.

---

## Testing Strategy

The implementation should prove:

1. band width increases enough to accommodate right-edge clearance
2. header markup is compact and horizontal rather than stacked
3. inline drag controls do not return
4. drag preview helper can be invoked without breaking server-rendered markup tests

Recommended coverage:

- layout helper tests for band width and clearance
- `StructuredValueStreamNode` markup regression tests for the compact header
- focused browser/manual verification for drag preview appearance because jsdom will not fully validate native drag ghosts

---

## Success Criteria

This pass is successful when:

- the value-stream band is visibly flatter
- the top text uses the right-side space instead of consuming extra rows
- the last stage no longer clips on the right edge at normal scale
- dragging a stage keeps a chevron-like preview instead of a generic browser shape
- stage drop/reorder behavior still works exactly as before

