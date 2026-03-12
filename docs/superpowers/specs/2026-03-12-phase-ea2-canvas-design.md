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
- Enable referencing or proposing changes to operational elements
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
- ELK layout engine integration via `@reactflow/layout` or direct `elkjs`
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
- **Inspector** — shows properties of the selected node/edge; editable for proposed elements, read-only for references
- **Top bar** — view name, status badge (DRAFT/SUBMITTED/APPROVED), Submit button (disabled/hidden until workflow engine is wired)

---

## Viewpoints

Viewpoints restrict which element types and relationship types an author can place on a canvas. They are stored in the database (not hardcoded) to allow admin configuration.

### ViewpointDefinition model

```prisma
model ViewpointDefinition {
  id                     String   @id @default(cuid())
  name                   String   @unique
  description            String?
  allowedElementTypes    String[] // EaElementType.id values
  allowedRelationshipTypes String[] // e.g. ["Serving", "Realization", "Assignment", ...]
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  views EaView[]
}
```

### Seeded viewpoints (Phase EA-2 baseline)

| Name | Layer focus | Key element types |
|---|---|---|
| Application Architecture | App + Business refs + Tech infra | AppComponent, AppService, AppFunction, DataObject, Interface, BusinessService, Node, InfraService |
| Business Architecture | Business only | BusinessCapability, BusinessProcess, BusinessService, BusinessRole, BusinessActor, BusinessObject, ValueStream |
| Technology Architecture | Tech + App refs | Node, InfraService, AppComponent (ref only), SystemSoftware |
| Capability Map | Business | BusinessCapability (hierarchy only) |

Viewpoint validation is enforced server-side in `ea.ts` actions when adding elements or relationships to a view.

---

## Reference vs. Propose

When an author searches for and drops an existing operational element onto the canvas, an **in-place popup** appears anchored at the drop point:

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

### Node visual states on canvas

| State | Border | Background | Editable |
|---|---|---|---|
| Net-new proposed | Solid blue `#4a90d9` | Layer colour | Yes |
| Proposed change (of operational) | Solid accent `#7c8cf8` + glow | Layer colour | Yes |
| Reference (read-only) | Dashed blue `#4a90d9` | Layer colour, 85% opacity | No — 🔒 badge |

### Data representation

- **Reference**: `EaViewElement` record with `mode: "reference"`, `sourceElementId` pointing to the live `EaElement`
- **Proposed change**: `EaViewElement` record with `mode: "propose"`, `sourceElementId` pointing to origin, plus local overrides in `proposedProperties Json?`
- **Net-new**: `EaViewElement` with `mode: "new"`, no `sourceElementId`

`EaViewElement` is a join table between `EaView` and `EaElement` that also holds canvas position and mode.

---

## Data Model Changes

### Modified: `EaView`

Add governance state and canvas persistence fields:

```prisma
model EaView {
  // ... existing fields ...

  // Governance (stub — UI deferred to workflow engine)
  status          String   @default("draft")  // "draft" | "submitted" | "approved"
  submittedAt     DateTime?
  submittedById   String?
  approvedAt      DateTime?
  approvedById    String?

  // Canvas persistence
  canvasState     Json?    // { viewport: {x,y,zoom}, nodePositions: Record<elementId, {x,y}> }

  // Viewpoint
  viewpointId     String?
  viewpoint       ViewpointDefinition? @relation(fields: [viewpointId], references: [id])

  snapshots       EaSnapshot[]
  viewElements    EaViewElement[]
}
```

### New: `EaViewElement`

Join table between EaView and EaElement; stores canvas placement and reference/propose mode:

```prisma
model EaViewElement {
  id                  String   @id @default(cuid())
  viewId              String
  view                EaView   @relation(fields: [viewId], references: [id], onDelete: Cascade)
  elementId           String
  element             EaElement @relation(fields: [elementId], references: [id])
  mode                String   @default("new")  // "new" | "reference" | "propose"
  sourceElementId     String?  // original EaElement id when mode = "reference" | "propose"
  proposedProperties  Json?    // overrides when mode = "propose"
  positionX           Float    @default(0)
  positionY           Float    @default(0)
  createdAt           DateTime @default(now())

  @@unique([viewId, elementId])
}
```

### New: `EaSnapshot`

Immutable record created on approval (schema only — write deferred to workflow engine phase):

```prisma
model EaSnapshot {
  id              String   @id @default(cuid())
  viewId          String
  view            EaView   @relation(fields: [viewId], references: [id])
  approvedById    String?
  submittedById   String?
  approvedAt      DateTime @default(now())
  changeSummary   String?
  elementCount    Int
  relationshipCount Int
  graphJson       Json     // full snapshot of elements + relationships at approval time
}
```

### New: `ViewpointDefinition`

See Viewpoints section above.

---

## Canvas State Persistence

Canvas layout (node positions + viewport) is saved:

- **Auto-save**: debounced 2s after the user stops dragging nodes or panning (React Flow `onNodesChange` / `onMoveEnd`)
- **Server action**: `saveCanvasState(viewId, canvasState)` — writes `canvasState` JSON to `EaView`
- **Load**: `getEaView(id)` returns `canvasState`; React Flow initialises node positions from it on mount

---

## API / Server Actions

New or modified in `apps/web/lib/actions/ea.ts`:

| Action | Description |
|---|---|
| `addElementToView(viewId, elementId, mode, position)` | Creates `EaViewElement`; validates element type against viewpoint |
| `removeElementFromView(viewId, elementId)` | Deletes `EaViewElement` |
| `updateViewElementPosition(viewId, elementId, x, y)` | Updates position (called by auto-save) |
| `saveCanvasState(viewId, canvasState)` | Saves full canvas state JSON |
| `createEaView(input)` | Modified: now accepts `viewpointId` |
| `updateEaView(id, input)` | Modified: now accepts `status`, `viewpointId` |

Validation: `addElementToView` checks that `element.elementTypeId` is in `viewpoint.allowedElementTypes` before inserting. Returns `{ error: "ElementTypeNotAllowedByViewpoint" }` if not.

---

## New Route: `/ea/views/[id]`

**File:** `apps/web/app/(shell)/ea/views/[id]/page.tsx`

- Server component — loads `EaView` with `viewpoint`, `viewElements` (with element details), `canvasState`
- Auth gate: `manage_ea_model` capability (HR-000 / HR-300)
- Renders `<EaCanvas>` client component with serialised initial data

**File:** `apps/web/components/ea/EaCanvas.tsx` — React Flow canvas (client component)

Sub-components:
- `EaElementNode.tsx` — custom React Flow node for each element type/mode
- `EaRelationshipEdge.tsx` — custom React Flow edge
- `ElementPalette.tsx` — left panel, filtered by viewpoint
- `ElementInspector.tsx` — right panel, editable/read-only by mode
- `ReferencePopup.tsx` — in-place popup triggered on dropping an existing element

---

## Modified Route: `/ea` (view list)

`apps/web/app/(shell)/ea/page.tsx` — add "New view" button linking to a create-view modal/form. Each view card links to `/ea/views/[id]`.

---

## Testing Strategy

- **Unit tests** (Vitest): `addElementToView` viewpoint enforcement logic, `saveCanvasState` debounce helper, `EaViewElement` mode logic
- **Integration tests**: server actions against test DB (following existing `ea.test.ts` pattern)
- **Manual smoke test**: drag element from palette → popup appears → choose Reference → node appears dashed; choose Propose → node appears with accent border; drag to reposition → auto-save fires

---

## Legacy Reference

The previous platform's canvas implementation (`D:/digital-product-factory/dashboard/`) used JointJS 3.7.7 with:
- `shapes.js` — ArchiMate element shape definitions
- `canvas.js` — drag-drop, port connection, selection management
- `layout.js` — ELK auto-layout
- `events.js` — event bus between panels

UX patterns (palette grouping, in-place popups, dashed reference borders, inspector sync with selection) are carried forward. The underlying technology is replaced with React Flow.

---

## Out of Scope for This Phase

- Viewpoint definition admin UI (viewpoints seeded via `seed.ts`)
- Governance submission/approval UI (deferred to workflow engine)
- EaSnapshot write (schema created, writes deferred)
- Relationship palette dragging (relationships created by connecting node ports on canvas)
- Multi-user collaboration
