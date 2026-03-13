# Phase EA-2: EA Graph Canvas — Design Spec

**Date:** 2026-03-12
**Author:** Mark Bodman
**Status:** Approved

---

## Overview

Phase EA-2 adds an interactive graph canvas to the EA modeler, allowing architects to visually model enterprise architecture views using ArchiMate-aligned element types and relationships. Canvas state is persisted to the database. Viewpoints restrict which element and relationship types are available per view. Operational elements can be pulled into views as read-only references or editable proposed copies. Governance states (DRAFT → SUBMITTED → APPROVED) are stored on EaView but the governance UI is deferred to the platform workflow engine (epic BI-0c5427a2).

---

## Goals

- Replace the static EaView list page with a full interactive canvas editor
- Enforce viewpoint discipline (element/relationship type restrictions per view)
- Enable referencing or proposing changes to operational elements on a canvas
- Persist canvas layout (node positions, viewport) to the database
- Store EaSnapshot records on approval for audit/compliance (schema only in this phase; submission UI deferred)

---

## Non-Goals (Deferred)

- Governance submission/approval UI — deferred to platform workflow engine
- AI-assisted layout or element suggestion
- Real-time collaborative editing (multi-user simultaneous editing)
- Export to PDF/PNG

---

## Canvas Library

**React Flow** (v11+). Rationale:
- React-native TypeScript API — no iframe, no shadow DOM
- Port-based connection system matches ArchiMate relationship semantics
- ELK layout engine integration via direct `elkjs`
- Active maintenance; successor to the legacy JointJS implementation used in the previous platform iteration

---

## Layout

Three-panel layout on `/ea/views/[id]`:

```
┌─────────────────────────────────────────────────────────┐
│ Top bar: breadcrumb · view name · status badge · Submit  │
├──────────────┬───────────────────────────────┬──────────┤
│ Element      │                               │          │
│ Palette      │         Canvas                │Inspector │
│ (180px)      │      (React Flow)             │ (200px)  │
│              │                               │          │
│ - Search     │  Nodes, edges, relationships  │ Selected │
│ - Layer      │  Pan/zoom/select              │ element  │
│   groups     │  Auto-layout button           │ props    │
│              │                               │          │
│ + Search     │                               │ Save /   │
│   existing…  │                               │ Delete   │
└──────────────┴───────────────────────────────┴──────────┘
```

- **Palette** — filtered by active viewpoint; draggable element type chips grouped by ArchiMate layer (Business / Application / Technology)
- **Canvas** — React Flow renderer; nodes represent EaElements; edges represent EaRelationships
- **Inspector** — shows properties of the selected node/edge; editable for proposed/new elements, read-only for references
- **Top bar** — view name, status badge (DRAFT/SUBMITTED/APPROVED), Submit button (not rendered until workflow engine is wired)

---

## Viewpoints

Viewpoints restrict which element types and relationship types an author can place on a canvas. They are stored in the database (not hardcoded) to allow admin configuration.

### ViewpointDefinition model (new)

```prisma
model ViewpointDefinition {
  id                      String   @id @default(cuid())
  name                    String   @unique
  description             String?
  allowedElementTypeSlugs String[] // EaElementType.slug values, e.g. ["app_component", "app_service"]
  allowedRelTypeSlugs     String[] // EaRelationshipType.slug values, e.g. ["realizes", "serving"]
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt

  views EaView[]
}
```

Fields store `slug` values (not surrogate IDs) for human-readability in seed data and auditability. Validation compares against `EaElementType.slug` and `EaRelationshipType.slug` at action time.

### Seeded viewpoints (Phase EA-2 baseline)

Seeded in `packages/db/src/seed.ts` as part of `seedEaViewpoints()`. Slugs are looked up by `slug` field at seed time via `findUnique({ where: { notationId_slug: ... } })`; the seed throws if a slug is not found.

| Name | `allowedElementTypeSlugs` (representative) | `allowedRelTypeSlugs` |
|---|---|---|
| Application Architecture | `app_component`, `app_service`, `app_function`, `data_object`, `interface`, `business_service`, `node`, `infra_service` | `serving`, `realization`, `assignment`, `composition`, `aggregation`, `association` |
| Business Architecture | `business_capability`, `business_process`, `business_service`, `business_role`, `business_actor`, `business_object`, `value_stream` | `realization`, `assignment`, `triggering`, `influence`, `composition`, `association` |
| Technology Architecture | `node`, `infra_service`, `system_software`, `app_component` | `realization`, `assignment`, `serving`, `composition`, `association` |
| Capability Map | `business_capability` | `composition`, `aggregation`, `association` |

Exact slugs confirmed at seed time against live `EaElementType` and `EaRelationshipType` records.

### Viewpoint enforcement

`addElementToView` checks `element.elementType.slug` is in `viewpoint.allowedElementTypeSlugs` before inserting. `createEaRelationship` (modified in this phase) checks `relType.slug` against `viewpoint.allowedRelTypeSlugs` when `viewId` is supplied. Both return a named error string on failure.

---

## Reference vs. Propose

When an author drops an existing operational element onto the canvas, an **in-place popup** appears anchored at the drop point and disappears on Add or Cancel/Escape.

```
┌─────────────────────────────┐
│ Auth Service                │
│ App Component · production  │
│                             │
│ [🔒 Reference]              │  ← read-only anchor, dashed border
│ Read-only. Shows context.   │
│                             │
│ [✏️ Propose change]         │  ← editable copy, accent border
│ Describe how it changes.    │
│                             │
│  [Add to canvas]  [Cancel]  │
└─────────────────────────────┘
        ↓ (pointer to ghost node)
```

The popup is dismissed automatically if the user clicks outside it. It is positioned to flip to avoid viewport overflow (using Floating UI auto-placement).

### Same element, one mode per view

A given `EaElement` can appear **at most once** on a given `EaView` — the `@@unique([viewId, elementId])` constraint enforces this. If an element is already on the canvas the "Search existing…" flow shows "Already on this view" and disables Add. Authors cannot hold both a reference and a proposed copy of the same element in one view.

### Node visual states on canvas

| State | Border | Background | Editable |
|---|---|---|---|
| Net-new | Solid blue `#4a90d9` | Layer colour | Yes |
| Proposed change (of operational) | Solid accent `#7c8cf8` + glow | Layer colour | Yes |
| Reference (read-only) | Dashed blue `#4a90d9` | Layer colour, 85% opacity | No — 🔒 badge |

### Data representation

`EaViewElement.elementId` always points to a real `EaElement.id`. There is no separate `sourceElementId` field — `elementId` is the single reference in all modes:

- **Net-new**: `mode = "new"` · `elementId` → newly created `EaElement` · `proposedProperties = null`
- **Reference**: `mode = "reference"` · `elementId` → existing operational `EaElement` · `proposedProperties = null`
- **Propose**: `mode = "propose"` · `elementId` → same existing operational `EaElement` · `proposedProperties` = author's overrides (e.g. `{ name: "...", description: "..." }`)

The "propose" mode does not create a shadow element — it uses the same `EaElement.id` and stores overrides in `proposedProperties` JSON.

---

## Data Model Changes

### Modified: `EaView`

The existing `EaView` model (from Phase EA-1, `feature/ea-modeling-foundation` branch) has:
`id, notationId, name, description, layoutType, scopeType, scopeRef, createdById, elements EaViewElement[], createdAt, updatedAt`

The existing `elements` relation field is **renamed** to `viewElements`. All call sites of `prisma.eaView.findMany({ include: { elements: ... } })` must be updated in the same PR.

```prisma
model EaView {
  id          String     @id @default(cuid())
  notationId  String
  notation    EaNotation @relation(fields: [notationId], references: [id])
  name        String
  description String?
  layoutType  String     // "graph"|"swimlane"|"matrix"|"layered"
  scopeType   String     // "portfolio"|"domain"|"custom"
  scopeRef    String?
  createdById String?

  // Governance (stub — UI deferred to workflow engine)
  status        String    @default("draft")  // "draft"|"submitted"|"approved"
  submittedAt   DateTime?
  submittedById String?
  approvedAt    DateTime?
  approvedById  String?

  // Canvas persistence — single source of truth for node positions + viewport
  canvasState   Json?    // { viewport: {x,y,zoom}, nodes: Record<viewElementId, {x,y}> }

  // Viewpoint
  viewpointId   String?
  viewpoint     ViewpointDefinition? @relation(fields: [viewpointId], references: [id])

  viewElements  EaViewElement[]
  snapshots     EaSnapshot[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### Modified: `EaViewElement`

The existing `EaViewElement` has a composite PK `@@id([viewId, elementId])` and columns `x, y Float; width, height Float?`. This phase replaces it with a surrogate-keyed model — **destructive migration** (drop and recreate). Safe because Phase EA-1 is not yet on main and no production canvas data exists.

```prisma
model EaViewElement {
  id                 String    @id @default(cuid())
  viewId             String
  view               EaView    @relation(fields: [viewId], references: [id], onDelete: Cascade)
  elementId          String
  element            EaElement @relation(fields: [elementId], references: [id])
  mode               String    @default("new")  // "new"|"reference"|"propose"
  proposedProperties Json?     // author's overrides when mode="propose"; null otherwise

  @@unique([viewId, elementId])
  @@index([elementId])
}
```

Position columns (`x, y, width, height`) are dropped. Positions live exclusively in `EaView.canvasState`.

### New: `EaSnapshot`

Immutable record created on approval. **Schema created in this phase; writes deferred to workflow engine phase.** `approvedById` and `submittedById` are nullable strings with no FK in this phase — they will be wired as FK relations when the workflow engine is implemented. These columns will always be null until then.

```prisma
model EaSnapshot {
  id                String   @id @default(cuid())
  viewId            String
  view              EaView   @relation(fields: [viewId], references: [id])
  approvedById      String?
  submittedById     String?
  approvedAt        DateTime @default(now())
  changeSummary     String?
  elementCount      Int
  relationshipCount Int
  graphJson         Json     // full snapshot at approval time
}
```

### New: `ViewpointDefinition`

See Viewpoints section above.

---

## Canvas State Persistence

**Single source of truth:** `EaView.canvasState Json?`

Type (declared in `apps/web/lib/ea-types.ts` — new file shared between client components and server actions):

```ts
export type CanvasState = {
  viewport: { x: number; y: number; zoom: number };
  nodes: Record<string, { x: number; y: number }>; // key = EaViewElement.id
};
```

- **Immediate write on add:** `addElementToView` accepts `initialX` and `initialY` and writes the node's initial position into `canvasState` atomically in the same DB transaction. Position is persisted immediately — not dependent on the debounced auto-save.
- **Auto-save on drag/pan:** Debounced 1.5s client-side after `onNodesChange` (drag end) or `onMoveEnd` (pan/zoom). Calls `saveCanvasState`.
- **Load:** `getEaView(id)` returns `canvasState`; React Flow initialises node positions from it on mount.

---

## Server Actions

All in `apps/web/lib/actions/ea.ts`. All write actions call `requireManageEaModel()`.

### Net-new vs. existing element paths

- **Palette drag (net-new):** `addElementToView` creates `EaElement` + `EaViewElement` in one transaction. `elementId` always references a real `EaElement.id`.
- **"Search existing…" (operational):** `EaElement` already exists; `addElementToView` creates only `EaViewElement` with `mode = "reference"` or `"propose"`.

### New actions

```ts
// Place an element on a view and persist its initial position.
// mode="new": creates EaElement (elementTypeId + name required), then EaViewElement.
//             Writes initialX/initialY into EaView.canvasState atomically.
// mode="reference"|"propose": creates EaViewElement only (elementId required).
// Returns { error: "ElementTypeNotAllowedByViewpoint" } | { error: "ElementAlreadyOnView" }
addElementToView(input: {
  viewId: string;
  mode: "new" | "reference" | "propose";
  elementTypeId?: string;  // required for mode="new"
  name?: string;           // required for mode="new"
  elementId?: string;      // required for mode="reference"|"propose"
  initialX: number;        // drop x coordinate (React Flow canvas space)
  initialY: number;        // drop y coordinate (React Flow canvas space)
}): Promise<{ viewElement: { id: string; mode: string; elementId: string } } | { error: string }>

// Remove a view element by its surrogate id.
// Returns { error: "ViewElementNotFound" } if id does not exist.
removeElementFromView(input: {
  viewElementId: string;
}): Promise<{ error?: string }>

// Update proposed property overrides. Uses EaViewElement.id.
// Returns { error: "CannotEditReference" } if mode = "reference".
// Returns { error: "ViewElementNotFound" } if id does not exist.
updateProposedProperties(input: {
  viewElementId: string;
  properties: Record<string, unknown>;
}): Promise<{ error?: string }>

// Persist canvas state (node positions + viewport).
saveCanvasState(input: {
  viewId: string;
  canvasState: CanvasState;
}): Promise<void>
```

### Modified actions

```ts
// createEaView — add viewpointId
createEaView(input: {
  notationId: string;
  name: string;
  description?: string;
  layoutType: "graph" | "swimlane" | "matrix" | "layered";
  scopeType: "portfolio" | "domain" | "custom";
  scopeRef?: string;
  viewpointId?: string;  // NEW
}): Promise<EaView>

// updateEaView — add viewpointId, status
updateEaView(input: {
  id: string;
  name?: string;
  description?: string;
  layoutType?: "graph" | "swimlane" | "matrix" | "layered";
  scopeType?: "portfolio" | "domain" | "custom";
  scopeRef?: string;
  viewpointId?: string;                              // NEW
  status?: "draft" | "submitted" | "approved";      // NEW (stub — set only by workflow engine)
}): Promise<EaView>

// createEaRelationship — add viewId for viewpoint validation
// When viewId is provided, fetches view.viewpoint and checks relType.slug
// against viewpoint.allowedRelTypeSlugs.
// Returns { error: "RelationshipTypeNotAllowedByViewpoint" } if rejected.
// Existing callers that do not pass viewId skip viewpoint validation (backwards compatible).
// NOTE: return type changes from Promise<void> (EA-1) to Promise<{ relationship } | { error }>.
// All existing callers of createEaRelationship must be updated in the same PR (currently:
// ea.test.ts mocks only — no production call sites outside ea.ts itself).
createEaRelationship(input: {
  fromElementId: string;
  toElementId: string;
  relationshipTypeId: string;
  viewId?: string;    // NEW — supply to enable viewpoint enforcement
  properties?: Record<string, unknown>;
}): Promise<{ relationship: EaRelationship } | { error: string }>
```

---

## Auth

- `/ea/layout.tsx` gates the entire `/ea/*` subtree with `view_ea_modeler` (HR-000, HR-300)
- `/ea/views/[id]/page.tsx` does **not** add a second page-level gate — it inherits from the layout
- All write server actions check `manage_ea_model` via `requireManageEaModel()` (same roles; enforced at action level)
- Canvas renders read-only when the user has `view_ea_modeler` but not `manage_ea_model` (future when roles diverge)

---

## New Route: `/ea/views/[id]`

**File:** `apps/web/app/(shell)/ea/views/[id]/page.tsx`

- Server component — fetches `EaView` with `viewpoint`, `viewElements` (with `element` and `element.elementType`), `canvasState`
- Renders `<EaCanvas>` client component with serialised initial data as props

**Edge loading:** `EaRelationship` has no `viewId` FK — relationships are global element-to-element records. The server loads edges by querying `EaRelationship` where `fromElementId IN viewElementIds AND toElementId IN viewElementIds`. Only relationships where both endpoints are on the view are rendered as edges. This is the intended behaviour — a relationship is visible on a view if and only if both connected elements are on that view.

**Client components** under `apps/web/components/ea/`:

| Component | Responsibility |
|---|---|
| `EaCanvas.tsx` | React Flow provider, node/edge state, auto-save debounce |
| `EaElementNode.tsx` | Custom React Flow node — renders by mode (new/reference/propose) and layer colour |
| `EaRelationshipEdge.tsx` | Custom React Flow edge — renders by relationship type |
| `ElementPalette.tsx` | Left panel — element type list filtered by viewpoint; drag source; "Search existing…" button |
| `ElementInspector.tsx` | Right panel — selected element properties; editable for new/propose, read-only for reference |
| `ReferencePopup.tsx` | In-place popup anchored at drop point; Reference vs. Propose choice; uses Floating UI for overflow-aware positioning |
| `ExistingElementSearch.tsx` | Modal opened by "Search existing…" in palette. On selection, places element at React Flow viewport centre as ghost node then opens `ReferencePopup` — same flow as canvas-drop |

**`apps/web/lib/ea-types.ts`** (new file) — shared types: `CanvasState`, `EaViewMode`, serialised node/edge shapes passed from server to `EaCanvas`.

---

## Modified Route: `/ea` (view list)

`apps/web/app/(shell)/ea/page.tsx` — add "New view" button; each view card links to `/ea/views/[id]`. "New view" button opens an inline form or modal to set name, viewpoint, layout type.

---

## Testing Strategy

### Unit tests (`apps/web/lib/actions/ea.test.ts`)

New tests following existing mock pattern (`vi.mock("@dpf/db/ea-validation")`, `vi.mock("@dpf/db/neo4j-sync")`):

| Test | Assertion |
|---|---|
| `addElementToView` mode="new" — valid type | Returns `{ viewElement: { id, mode, elementId } }` |
| `addElementToView` — type not in viewpoint | Returns `{ error: "ElementTypeNotAllowedByViewpoint" }` |
| `addElementToView` — duplicate | Returns `{ error: "ElementAlreadyOnView" }` |
| `addElementToView` mode="propose" — `proposedProperties` starts null | `viewElement` created; `proposedProperties = null` |
| `addElementToView` — initial position written to `canvasState` | `prisma.eaView.update` called with merged `canvasState.nodes` entry |
| `removeElementFromView` — existing id | `prisma.eaViewElement.delete` called; no error returned |
| `removeElementFromView` — unknown id | Returns `{ error: "ViewElementNotFound" }` |
| `updateProposedProperties` — mode=reference | Returns `{ error: "CannotEditReference" }` |
| `saveCanvasState` — persists JSON | `prisma.eaView.update` called with `canvasState` |
| `createEaRelationship` with viewId — rel type not allowed | Returns `{ error: "RelationshipTypeNotAllowedByViewpoint" }` |

### Manual smoke test

1. Open `/ea/views/[id]` — canvas loads with saved node positions
2. Drag palette chip → node appears at drop position
3. Close browser immediately → reload → node still present at same position (initial position persisted atomically)
4. Use "Search existing…" → select Auth Service → popup appears → choose Reference → dashed border node
5. Drag node → auto-save fires after 1.5s → reload confirms new position
6. Edit proposed element in Inspector → save → `proposedProperties` updated
7. Connect two nodes via port drag → relationship edge appears
8. Attempt connection with relationship type not in viewpoint → edge creation rejected

---

## Legacy Reference

The previous platform's canvas (`D:/digital-product-factory/dashboard/`) used JointJS 3.7.7 with:
- `shapes.js` — ArchiMate element shape definitions
- `canvas.js` — drag-drop, port connection, selection management
- `layout.js` — ELK auto-layout
- `events.js` — event bus between panels

UX patterns (palette grouping, in-place popups, dashed reference borders, inspector sync with selection) are carried forward. Technology is replaced with React Flow.

---

## Out of Scope for This Phase

- Viewpoint definition admin UI (viewpoints seeded via `seed.ts`)
- Governance submission/approval UI (deferred to workflow engine epic BI-0c5427a2)
- EaSnapshot writes (schema created, writes deferred)
- Relationship palette dragging (relationships created by connecting node ports on canvas)
- Multi-user collaboration
