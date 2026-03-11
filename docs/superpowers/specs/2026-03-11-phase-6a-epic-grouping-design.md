# Phase 6A — Epic Grouping for Backlog Design

**Date:** 2026-03-11
**Status:** Approved
**Scope:** Add epics as a first-class planning construct above backlog items in the existing backlog system.

---

## Context and Motivation

The backlog system (Phase 5A+B) tracks individual portfolio and product backlog items. As the platform grows — with large initiatives like the Digital Product Backbone, EA Modeler, and infrastructure registry all in flight simultaneously — flat item lists become unmanageable. Epics provide the grouping layer that makes the programme of work legible.

The platform's delivery team is AI agents. Epics are the primary contract between a human's intent and agent execution: a user or human role expresses what they want, an agent structures it into an epic with stories, the human reviews and approves the scope via the `/ops` interface, and agents execute against it. The design must serve both sides — agents write to it programmatically, humans read and manage it directly.

Epics are **cross-portfolio capable**. A single initiative (e.g. the Digital Product Backbone) spans the `foundational` portfolio (Neo4j, Docker infrastructure) and the `manufacturing_and_delivery` portfolio (factory modeling capability). Epics are not locked to a single taxonomy node.

---

## Operating Model

The `/ops` route is the shared workspace for humans and AI agents:

- **Agents** create epics and backlog items via server actions, scoped by their role and the user's expressed intent
- **Humans** review, edit, approve, and reprioritise via the UI
- The `manage_backlog` capability controls write access for both paths — same permission, same enforcement

This model scales: as more agent roles are introduced, they interact with the same backlog surface. The human remains in control through the review and management UI.

---

## Data Model

### New: `Epic`

```prisma
model Epic {
  id          String   @id @default(cuid())
  epicId      String   @unique           // e.g. "EP-<uuid>" — stable human-readable ID
  title       String
  description String?
  status      String   @default("open") // open | in-progress | done
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  portfolios  EpicPortfolio[]
  items       BacklogItem[]
}
```

Status values use hyphens (`in-progress`) to match the existing `BacklogItem.status` convention established in `backlog.ts`.

### New: `EpicPortfolio` (join table)

```prisma
model EpicPortfolio {
  epicId      String
  portfolioId String

  epic        Epic      @relation(fields: [epicId], references: [id], onDelete: Cascade)
  portfolio   Portfolio @relation(fields: [portfolioId], references: [id], onDelete: Cascade)

  @@id([epicId, portfolioId])
}
```

The existing `Portfolio` model gains a back-relation field:

```prisma
// Added to the Portfolio model in schema.prisma:
epicPortfolios  EpicPortfolio[]
```

### Modified: `BacklogItem`

Add optional FK to `Epic` and `epicId` to the select shape:

```prisma
epicId  String?
epic    Epic?   @relation(fields: [epicId], references: [id], onDelete: SetNull)
```

`onDelete: SetNull` means deleting an epic orphans its items back to the unassigned pool rather than deleting them.

`BacklogItemWithRelations` type in `backlog.ts` gains `epicId: string | null`. The `getBacklogItems` query in `backlog-data.ts` adds `epicId: true` to its select — required for `OpsClient` to filter unassigned items (`epicId === null`).

### `epicId` generation

Format: `EP-${crypto.randomUUID()}` — full UUID, matching the established `BI-${crypto.randomUUID()}` pattern used for `BacklogItem.itemId`. The unique constraint on the column is the collision safety net.

---

## Status Values

Epic status uses the same hyphenated convention as `BacklogItem.status`:

| Status | Meaning |
|---|---|
| `open` | Defined, work not yet started or partially started |
| `in-progress` | Actively being worked on |
| `done` | All intended items complete |

No approval gate at this stage — epics are planning containers, not governance artefacts. Governance workflow is a future concern.

---

## UI — `/ops` Page Restructured

### Epic cards (top section)

Each epic renders as a collapsible card:

```
[▶] EP-<uuid>  Digital Product Backbone          [open]
    foundational · manufacturing_and_delivery
    ████████░░  3 / 8 items done
```

Expanded, the card shows the backlog items belonging to that epic, grouped by type (portfolio items first, then product items). Each item renders using the existing `BacklogItemRow` component (see Data section for the full select shape required).

An **"Add epic"** button sits in the page header area.

Clicking the epic title or an edit icon opens the `EpicPanel` for editing.

### Unassigned items (bottom section)

Items with no epic continue to appear below the epic cards, grouped by type as today. Filtered client-side to `items.filter(i => i.epicId === null)`. This ensures no item is lost during the transition period while epics are being organised.

### Progress bar

Computed client-side:
- **Denominator**: all items in the epic (including `deferred` — they remain part of the epic's scope)
- **Numerator**: items with `status === "done"`
- Label: `X / N items done`
- A `deferred` item counts in N but not in X, reflecting that the work is deferred, not complete

---

## New Components

### `components/ops/EpicCard.tsx`

Client component. Props: `epic` (with portfolios and full items), callbacks for edit/delete.

- Collapsible via `useState`
- Progress bar computed from items: `done = items.filter(i => i.status === "done").length`
- Renders `BacklogItemRow` for each item (requires full `BacklogItemWithRelations` shape — see Data section)
- Edit button → calls `onEdit(epic)` → parent opens `EpicPanel`

### `components/ops/EpicPanel.tsx`

Client slide-in panel (same pattern as `BacklogPanel`). Fields:

| Field | Control |
|---|---|
| Title | Text input, required |
| Description | Textarea, optional |
| Status | Select: open / in-progress / done |
| Portfolios | Multi-checkbox: all 4 portfolio roots |

Calls `createEpic` or `updateEpic` server action on submit. Calls `router.refresh()` on success. A close button calls `onClose()`.

---

## Modified Components

### `BacklogPanel.tsx`

Add an optional **Epic** select field — lists all `open` and `in-progress` epics by title. Selecting one assigns the item's `epicId`. The field is optional; items can remain unassigned.

### `OpsClient.tsx`

Receives `epics` prop (array of epics with portfolios and full items) and `items` prop as today.

State uses **two independent panel state variables** to keep concerns separate and avoid mutual exclusion complexity:

```ts
// Existing — unchanged:
const [panelState, setPanelState] = useState<PanelState | null>(null);

// New — for epics:
const [epicPanelState, setEpicPanelState] = useState<
  { mode: "create" } | { mode: "edit"; epic: EpicWithRelations } | null
>(null);
```

Two independent `null` checks mean the panels are implicitly mutually exclusive in practice (opening one doesn't close the other, but the UI never presents both open simultaneously — "Add epic" always sets `epicPanelState` and clears `panelState`, and vice versa).

Renders:
1. Page header with "Add epic" button (`setEpicPanelState({ mode: "create" })`)
2. Epic cards list (one `EpicCard` per epic, passing `onEdit` and `onDelete` handlers)
3. Unassigned items section (filtered to `items.filter(i => i.epicId === null)`, grouped by type as today)
4. `<EpicPanel>` conditionally rendered when `epicPanelState !== null`
5. `<BacklogPanel>` conditionally rendered when `panelState !== null` (unchanged)

### `ops/page.tsx`

Adds `getEpics()` to the `Promise.all` fetch. Passes epics to `OpsClient`.

---

## Server-Side Data

### `lib/backlog-data.ts` (extended)

`getBacklogItems` gains `epicId: true` in its select to support client-side unassigned filtering.

New function:

```ts
export const getEpics = cache(async () => {
  return prisma.epic.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      portfolios: { include: { portfolio: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          digitalProduct: { select: { id: true, productId: true, name: true } },
          taxonomyNode:   { select: { id: true, nodeId: true, name: true } },
        },
      },
    },
  });
});
```

The `items` include uses `include` (not `select`) to match the full `BacklogItemWithRelations` shape required by `BacklogItemRow`. This ensures type compatibility without a separate component variant.

### `lib/actions/backlog.ts` (extended)

Three new server actions, all gated behind `requireManageBacklog()`:

**`createEpic(input)`**
- Validates title (non-empty)
- Generates `epicId: "EP-" + crypto.randomUUID()`
- Creates Epic + EpicPortfolio join rows in a `prisma.$transaction`

**`updateEpic(id, input)`**
- Updates title, description, status
- Replaces portfolio links in a `prisma.$transaction`: delete existing `EpicPortfolio` rows for this epic, insert new ones

**`deleteEpic(id)`**
- Deletes epic; `onDelete: SetNull` cascades to `BacklogItem.epicId` automatically

### `lib/backlog.ts` (extended)

- `EPIC_STATUSES` constant: `["open", "in-progress", "done"] as const`
- `validateEpicInput(input)` — validates title non-empty, status is a valid `EPIC_STATUSES` value
- `EpicInput` type

---

## Migration

One new Prisma migration:

```sql
CREATE TABLE "Epic" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "epicId"      TEXT NOT NULL UNIQUE,
  "title"       TEXT NOT NULL,
  "description" TEXT,
  "status"      TEXT NOT NULL DEFAULT 'open',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL
);

CREATE TABLE "EpicPortfolio" (
  "epicId"      TEXT NOT NULL,
  "portfolioId" TEXT NOT NULL,
  PRIMARY KEY ("epicId", "portfolioId"),
  FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE CASCADE,
  FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE
);

ALTER TABLE "BacklogItem"
  ADD COLUMN "epicId" TEXT REFERENCES "Epic"("id") ON DELETE SET NULL;
```

---

## Testing

**Unit tests** (`lib/backlog.test.ts` extended):
- `validateEpicInput` — title required; status must be one of `EPIC_STATUSES`
- `epicId` format: matches `EP-[0-9a-f-]{36}` (full UUID pattern, consistent with `BI-` items)

---

## What This Does Not Include

- Epic approval workflow (proposed → approved gate) — future governance concern
- Epic owner assignment — future
- Epic target date / roadmap timeline view — future
- Nested epics or themes above epics — future
- Agent-created epics via API — server actions are callable programmatically today; a dedicated agent API surface is a future concern
- Epic-level comments or activity log — future
