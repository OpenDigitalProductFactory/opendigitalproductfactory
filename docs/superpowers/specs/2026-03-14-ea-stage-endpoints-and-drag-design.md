# EA Stage Endpoints and Drag Design

**Date:** 2026-03-14  
**Status:** Proposed  
**Scope:** Correct the value-stream stage interaction model so stages behave as real diagram elements with four-sided connection points and reliable movement behavior, while preserving the value-stream container as the ordering and layout construct.

---

## Overview

The current value-stream renderer improved the visual band, but it kept the stages as HTML inside a single parent node. That is the root cause of two important failures:

1. stages cannot behave like normal diagram elements for connections
2. drag interaction depends on browser-native drag ghosts instead of normal canvas behavior

This is not just a polish issue. It means the current abstraction is wrong for the modeling behavior you want. A value-stream stage should remain inside its container semantically, but it should still behave like a normal EA element in the diagram for connections and movement.

The corrected design is:

- `ValueStream` remains the container and ordering construct
- `ValueStreamStage` becomes a real projected canvas node
- the layout engine positions stage nodes inside the parent band automatically
- stages expose handles on all four sides
- internal stage sequence remains implied and hidden

---

## Goals

- Make each value-stream stage a real visible canvas node.
- Support normal four-sided connection behavior for stages.
- Preserve the parent value stream as the organizational container and sequence owner.
- Keep stage ordering left-to-right inside the parent band.
- Replace browser drag-ghost dependence with normal node-based interaction.
- Keep automatic layout so users do not manually rebuild the notation.

---

## Non-Goals

- Full generic support for every structured notation pattern in this phase.
- Arbitrary freeform movement of stages outside the parent stream without warnings.
- Reworking the underlying EA conformance model beyond what this projection needs.
- Building every surrounding context/support lane in the same pass.

---

## Key Design Decisions

### 1. Stages must be real projected nodes

The current single-node value-stream renderer made the stages visual fragments instead of actual diagram participants. That directly prevents normal handles and makes movement behavior brittle.

The correction is to render stage `EaViewElement`s as visible nodes in the canvas while still treating them as children of the parent value stream.

### 2. The value stream remains the container and semantic owner

The parent value stream still owns:

- the ordering of stages
- the structural expectation that stages belong inside it
- the parent band geometry
- the hidden implied stage-to-stage flow

So the container remains semantically important. It simply stops being the only visible/connectable node.

### 3. Stage handles should exist on all four sides

A stage should behave like any other diagram element for external relationships:

- top
- right
- bottom
- left

This is required because the container is organizational, not a restriction on the rest of the modeling semantics.

### 4. Movement should use node behavior, not HTML drag ghosts

If the stage becomes a true canvas node, movement and resequencing should build on node interaction patterns rather than browser `dataTransfer` drag-ghost behavior inside a single DOM node.

That gives more reliable shape preservation and aligns movement with the rest of the EA canvas.

---

## Projection and Rendering Model

### Parent stream node

The parent value stream remains a rendered band/container node. It should:

- show the stream label/name/status
- compute its width from child stage geometry
- visually sit behind or around the stage nodes
- remain selectable as an EA element

### Child stage nodes

Each `ValueStreamStage` is rendered as:

- a true React Flow node
- positioned inside the parent stream band
- visually styled as a chevron
- equipped with four handles

The stage is still a child in the data model. It is just no longer hidden inside the parent DOM.

### Hidden internal relationships

Internal stage sequence remains implied:

- stage-to-stage `flows_to` may still exist in the graph
- those edges remain hidden in this projection

External relationships involving stages remain visible.

---

## Layout Behavior

The layout engine should treat this as a structured group:

- parent band is laid out first
- child stages are laid out inside it left-to-right using order
- parent width derives from stage widths and spacing
- child positions are not manually authored by default

Recommended behavior:

- stages are vertically centered within the band
- spacing is deterministic
- parent band updates when stage count/order/labels change

The parent is not just a background decoration. It is a structured visual projection driven by the child node arrangement.

---

## Interaction Behavior

### Stage connections

Stages should support:

- outbound and inbound connections on all sides
- the same edge-creation interaction as other EA nodes
- normal selection and inspection behavior

### Stage movement and reorder

Reordering should no longer depend on native HTML drag ghosts.

Instead:

- the stage node should move using canvas/node movement semantics
- movement is constrained or interpreted relative to the parent value-stream lane
- the final resolved position should update stage order
- the parent band should resize/reflow after reorder

If a stage leaves the expected stream bounds during editing, that should continue to be treated as a structural warning rather than an immediate hard error.

---

## Data and View Implications

The existing `EaViewElement` hierarchy already supports parent/child stage membership and order. The main change is how the view projection treats child nodes:

- today: child stages are collapsed into parent node markup
- corrected design: child stages remain visible projected nodes

This may require:

- projection metadata distinguishing parent band nodes from child stage nodes
- layout code that understands grouped structured nodes
- edge filtering that still hides only internal stage sequence edges

No fundamental schema change is required if the current `EaViewElement` hierarchy is already present and stable.

---

## Testing Strategy

The implementation should prove:

1. stages are rendered as visible nodes, not only embedded markup
2. stages expose normal connection handles
3. internal stage-sequence edges remain hidden
4. external stage relationships remain renderable
5. parent band still sizes itself from stage geometry
6. stage movement/reordering preserves the chevron shape and normal node behavior

Tests should include:

- structured projection/layout tests
- `EaElementNode` or canvas tests proving stage-node visibility/handles
- existing hidden-edge tests to preserve implied internal flow behavior
- focused interaction tests or action tests for resequencing logic

---

## Success Criteria

This correction is successful when:

- users can connect to stages directly on all sides
- stages behave like normal diagram elements in the canvas
- the value stream still visually contains and orders the stages
- stage movement no longer falls back to a broken browser ghost shape
- internal left-to-right stage sequence remains implied and hidden

