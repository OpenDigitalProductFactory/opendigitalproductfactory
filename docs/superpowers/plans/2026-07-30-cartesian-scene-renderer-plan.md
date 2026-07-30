# Cartesian Operational Scene Renderer — implementation plan

**Status:** in progress

**Date:** 2026-07-30

**Backlog:** BI-E75AF714

**Epic:** EP-SPATIAL-OPERATIONAL-VIEWS

**Branch:** `feat/cartesian-scene-renderer`

**Depends on:** BI-EA4B8638 (`SceneLayout`, merged), BI-CD99DC3F (`OperationalSceneLayout` + entity resolver, merged)

**Backlog coverage receipt:** `cms6yp25i077101oge2gvoal5` — atomic

**Decision evidence:** `DI-7A44B6D81FA6`, activity `cms6ys77407a401ogy6pn0c3k`

Operational-Precedent: restaurant-floor

## Design grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/specs/2026-07-21-spatial-operational-views-design.md`
  - `docs/superpowers/plans/2026-07-29-operational-scene-persistence-plan.md`
- Current code substrate reviewed:
  - `packages/storefront-templates/src/scene-layout.ts`
  - `apps/web/components/twin/floor/FloorPlanCanvas.tsx`
  - `apps/web/lib/shared/use-save-state.ts`
  - `apps/web/components/ui/SaveStateIndicator.tsx`
- Source of truth:
  - `SceneLayout` owns coordinate-space geometry; `OperationalSceneLayout`
    owns tenant-scoped persisted state and optimistic versioning.
  - `/workspace` is the canonical internal Operations home.
- Decision:
  - Implement one reusable Cartesian renderer beneath the twin kit, retain
    explicit configure/operate/read-only modes, and refactor the restaurant
    floor canvas into an adapter. Restaurant commands and route integration
    remain in BI-287AA5F7.

## Outcome

Ship one business-grade React Flow renderer for every cartesian operational
scene. It renders the canonical `CartesianSceneLayout`, joins caller-supplied
live presentation state, supports `configure`, `operate`, and customer-safe
`read-only` modes, persists drag-to-nudge geometry after 1.5 seconds, and makes
save/conflict failures visible and recoverable.

This BI supplies the shared renderer and persistence command. Restaurant
seating, waitlist/reservation state, forward availability, customer redaction,
and `/workspace` integration remain the independently shippable
BI-287AA5F7. BOOK, YARD, ROOMS, BAYS, and other bindings must reuse this
renderer rather than fork it.

## Grounding and decision

The implementation extends:

- `@dpf/storefront-templates` `CartesianSceneLayout` as the geometry source of
  truth;
- Prisma `OperationalSceneLayout` as the durable, organization-scoped authored
  projection;
- `@xyflow/react` v12.11.2, already used by the EA and process canvases;
- `useSaveState` + `SaveStateIndicator` for optimistic, visible,
  retryable persistence;
- report-kit `intentStyle` for all live status colors;
- the existing `FloorPlanCanvas` as the first compatibility adapter.

Three options were weighed by WWMD:

1. Extend the restaurant-only canvas.
2. Put a reusable `CartesianSceneCanvas` beneath the twin kit.
3. Embed React Flow, persistence, and mode state directly into `TwinView`.

The kernel selected option 2 with high confidence (composite 8.119, margin
5.180, no commandment conflict). This keeps `TwinView` renderer-neutral,
removes the restaurant-only rendering dialect, and gives later archetype
bindings one stable seam.

## UX fit review — Cartesian operational scene renderer

- **Decision:** fits-with-guardrails
- **Owning area:** Workspace / Operations
- **Route family:** `/workspace` is the canonical live home; this BI adds no
  route or global navigation. BI-287AA5F7 performs the first route binding.
- **Primary persona:** a frontline operator making a time-sensitive resource
  decision; they should not need to understand React Flow, scene JSON, or
  persistence versions.
- **Navigation layer touched:** local mode/action controls only; no global or
  section navigation.
- **Reuse/convergence:** reuse React Flow, `SceneLayout`, `useSaveState`,
  `SaveStateIndicator`, and report-kit intent colors. Replace
  `FloorPlanCanvas`'s local node conversion and retire its bespoke table/zone
  nodes.
- **Source truth:** `OperationalSceneLayout.layoutState` owns authored
  geometry; domain read models and `scene-entity-resolver` own live identity
  and status; the canvas owns neither.
- **Empty/failure behavior:** an empty scene renders an honest caller-supplied
  setup state. A failed save rolls back to the confirmed scene and exposes
  Retry/Revert. A version conflict says the layout changed elsewhere and
  requires refresh instead of overwriting it.
- **AI boundary:** the renderer sends no prompt. Operate-mode activation calls
  an explicit domain callback; the caller owns proposal preview, command
  authorization, confirmation, and conflict handling.
- **Required guardrails:**
  - configure mode permits drag-to-nudge only; resize/rotate/palette authoring
    remains P3;
  - operate mode never mutates geometry;
  - read-only mode exposes no selection or confirmation action;
  - every color is paired with visible status text;
  - the scene supplies a semantic text alternative in DOM order;
  - controls meet the 44px target and use token-backed styles;
  - no hardcoded status map or canvas-specific domain command.
- **Evidence before merge:** pure adapter/validation tests, repository
  authorization and optimistic-version tests, client interaction/autosave
  tests, static accessibility assertions, source-local typecheck, exact
  governed production build, hosted UX gate, and the visual/persona exercise
  performed when BI-287AA5F7 binds the renderer to `/workspace`.
- **Captured in:** this plan and
  `docs/ux-fit/2026-07-30-cartesian-scene-renderer.ux-fit.json`.

## Architecture

### Pure scene adapter

Add `apps/web/lib/twin/cartesian-scene.ts` with:

- runtime validation and bounded normalization for untrusted scene JSON;
- deterministic zone bounds and placement-to-zone membership;
- deterministic scene-to-React-Flow node descriptors;
- absolute/relative coordinate conversion for group nodes;
- immutable placement nudge updates;
- shape-kind normalization for `table`, `chair`, `bay`, `rack`, `seat`,
  `station`, and the generic fallback.

The pure module must not import React, Prisma, or browser APIs.

### Renderer

Add a `components/twin/cartesian/` family:

- `CartesianSceneCanvas.tsx` — controlled React Flow surface, mode behavior,
  drag synchronization, 1.5-second save-state orchestration, and text
  alternative;
- `CartesianResourceNode.tsx` — shared accessible resource body plus thin
  custom-node exports for each supported resource shape;
- `CartesianZoneNode.tsx` — token-backed rectangle/polygon zone backdrop;
- focused tests with React Flow mocked at the component boundary.

The canvas receives:

- the confirmed `CartesianSceneLayout`;
- the persisted scene id/version when autosave is enabled;
- presentation bindings keyed by `entityRef`, carrying label, visible status,
  intent, optional supporting text, and cog recommendation state;
- an optional `onSave` persistence closure;
- an optional operate-mode activation callback;
- an optional empty-state element.

The canvas does not fetch domain state and does not import a restaurant,
salon, rental, room, or dispatch module.

### Persistence command

Add `operational-scene-layout-actions.ts` with a pure repository function and a
thin authenticated server action:

- require an authorized administrator for configure writes;
- scope every update by the session organization and scene id;
- validate `spaceKind === "cartesian-interior"` and validate the full scene;
- use `updateMany({ id, orgId, version: expectedVersion })` plus
  `version: { increment: 1 }` for optimistic concurrency;
- distinguish `not-found`, `forbidden/unauthorized`, invalid scene, and version
  conflict without leaking another organization's layout;
- revalidate `/workspace` after success;
- return the next version so subsequent debounced saves do not reuse a stale
  token.

Creation/priming remains the archetype adapter's responsibility. This BI saves
an existing canonical scene; BI-287AA5F7 creates/auto-primes the restaurant
scene before mounting the canvas.

## Implementation sequence

1. Write failing pure tests for validation, group membership, coordinate
   conversion, shape fallback, and immutable nudge.
2. Implement the pure adapter until those tests pass.
3. Write failing repository tests for tenant scope, authorization boundary,
   optimistic version increment, conflict, and invalid payload.
4. Implement the repository and server-action boundary.
5. Write failing component tests for mode behavior, visible status text,
   cog highlight, activation, debounced save wiring, rollback/error indicator,
   and semantic text alternative.
6. Implement the generic canvas and custom nodes.
7. Refactor `FloorPlanCanvas` into a small adapter and delete the bespoke
   `TableFloorNode` / `FloorZoneNode` dialect. This is the slice's ≥20%
   refactoring budget.
8. Export the stable renderer contract from the twin-kit barrel.
9. Add the measured UX-fit manifest using decision
   `DI-7A44B6D81FA6`; list exactly the UI files in the final diff.
10. Run targeted tests and source-local typecheck where the source-only
    worktree permits; then run the exact governed local merge gate, hosted PR
    checks, and merge queue.

## Test matrix

| Concern | Evidence |
| --- | --- |
| Geometry validation | rejects NaN/infinite/non-positive geometry, duplicate ids, unsupported space kind, excessive zones/placements |
| Group nodes | deterministic smallest containing zone, correct relative position, exact absolute round trip |
| Configure | only placement nodes draggable; drag updates one placement; snap grid enabled; 1.5s save debounce |
| Operate | geometry locked; visible status + intent; cog recommendation is named; activation callback receives placement |
| Read-only | no drag, select, connect, or activation path |
| Accessibility | semantic scene heading/list; every placement includes label and status text; token focus and ≥44px controls |
| Save success | organization-scoped version match increments and returns next version |
| Save conflict | zero-row update returns conflict; client retains confirmed geometry and exposes recovery |
| Save failure | visible error, Retry, and Revert; no swallowed rejection |
| Regression/refactor | legacy `FloorScene` still renders through the generic canvas with the same labels, capacity, shapes, and states |

## Documentation impact

No operator guide is added in this substrate BI because no operator route is
introduced. BI-287AA5F7 must update the Operations user guide when the
restaurant layout becomes reachable. This branch updates the architecture
history through this plan and records UX/decision evidence in the same PR.
