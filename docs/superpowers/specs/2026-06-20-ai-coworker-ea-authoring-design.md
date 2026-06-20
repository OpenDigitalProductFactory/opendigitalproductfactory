# AI Coworker EA Authoring — Design Spec

**Date:** 2026-06-20 · **Epic:** EP-EA-COWORKER-AUTHORING · **Author:** Claude (operator /goal, Mark) · **Status:** Draft

## Motivation

Mark asked: *"should the AI coworker be able to adjust these things live while looking at the diagram?"* — while reviewing the EA canvas (auto-layout, containment, etc., shipped in #2151/#2161/#2174).

**Answer: yes — as governed editing of the structured model, not pixel co-presence.** An LLM reasons far better over the EA graph (nodes, edges, types, positions, viewpoint rules) than over a rendered screenshot, so "looking at the diagram" is best realized as the coworker reading + writing the structured view, with results reflected on the human's canvas.

## Current substrate (verified 2026-06-20)

- The coworker already has an **EA-architect persona** (`prompts/route-persona/ea-architect.prompt.md`) + architecture-definition/guardrail specialist agents.
- It can **READ** the architecture graph: `query_ontology_graph`, `export_archimate`, `run_traversal_pattern`, `search_code_graph`.
- It **cannot edit** the EA canvas: `addElementToView`, `createEaRelationship`, `moveStructuredViewElement`, `saveCanvasState`, `updateProposedProperties` are **UI-only server actions** in `apps/web/lib/actions/ea.ts` — none is exposed as an MCP tool.
- Governance already exists to lean on: **viewpoint rules** (allowed element/relationship type slugs, enforced in the actions), the **DRAFT→SUBMITTED→APPROVED** lifecycle on `EaView`, `EaSnapshot` (model snapshots), and the **layout revision history** (`CanvasState.history`) + pure layout engines (`computeEaLayout`, `computeContainmentLayout`) shipped in the layout work.
- Real-time multi-user co-editing was an **explicit EA-2 non-goal** — phase it, don't lead with it.

## Design principles

1. **Edit the model, not pixels.** Coworker operates on view elements / relationships / canvasState via governed capabilities; never "drives" the canvas as a user.
2. **Governed by construction.** Every edit respects viewpoint rules, honors the view's lifecycle, is **attributed** to the coworker, and is **reversible** (layout → revision history; model → `EaSnapshot` / proposed-mode).
3. **Reuse, don't rebuild.** Wrap the existing EA actions + layout engines; add an MCP surface, not new layout math or a new persistence model.
4. **Phased, each shippable.** Stop after any phase.

## Phase 1 — READ: explain / critique a view (lowest risk)

A read-only coworker capability: given a `viewId`, return a structured digest (elements by type, relationships, containment summary, isolated/hub nodes, viewpoint conformance, layout density) so the coworker can **explain or critique** the view ("this view has 57 orphaned data objects; the Auth cluster is dense; consider splitting…").

- **MCP tool** `describe_ea_view(viewId)` (read; authority = `view_ea_modeler`) → JSON digest computed from `getEaView` + `computeMetrics` (already built) + viewpoint rules. No writes.
- Deliverable: tool + wiring into the EA-architect persona prompt. No canvas change.

## Phase 2 — GOVERN-EDIT: apply model & layout changes

Expose governed MCP tools that wrap the existing actions; each checks authority (`manage_ea_model`), viewpoint rules, and records attribution + a restore point.

- `arrange_ea_view(viewId, algorithm)` — run `computeEaLayout`/`computeContainmentLayout` server-side, push a `CanvasState.history` revision, save. (Reversible by construction.)
- `add_ea_element(viewId, …)` / `link_ea_elements(viewId, from, to, relType)` — wrap `addElementToView` / `createEaRelationship`; viewpoint-validated; new elements placed via `placeIncremental`.
- `propose_ea_change(viewElementId, properties)` — wrap `updateProposedProperties` (uses the existing **propose** mode so coworker edits land as proposals, not silent mutations of operational elements).
- All writes are attributed (a `createdById`/actor field) and emit an audit row; destructive edits require the view be in DRAFT.

## Phase 3 — LIVE REFLECT: real-time canvas updates (optional)

When the human has the view open, reflect coworker edits without a manual reload by pushing a canvas-changed event over the **existing SSE channel** (`useResilientEventSource`); the canvas re-fetches/merges. Still not multi-user co-editing — it's one-way reflection of governed edits. Defer until phases 1–2 prove the value.

## Non-goals

- Multi-user simultaneous co-editing / cursors / presence (EA-2 non-goal).
- The coworker consuming canvas **screenshots** as primary input (structured graph is higher-signal; a screenshot may be added later only for visual-density judgment).
- A new persistence model — reuse `canvasState` + `EaSnapshot` + revision history.

## Risks

- **Unbounded edits.** Mitigate with authority gating + viewpoint validation + DRAFT-only destructive edits + reversibility.
- **Attribution gaps.** Ensure coworker writes carry an actor id and audit trail before enabling Phase 2.
- **Scale.** `arrange_ea_view` reuses the capped/iteration-bounded layout engines; consider the deferred ELK web worker for 600-node views.

## Phasing → backlog

BI per phase under EP-EA-COWORKER-AUTHORING (read → govern-edit → live-reflect). Phase 1 is the safe first slice.
