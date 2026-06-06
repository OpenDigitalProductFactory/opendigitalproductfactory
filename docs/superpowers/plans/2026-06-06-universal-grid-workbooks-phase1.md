# Universal Grid & Workbooks — Phase 1 Implementation Plan

**Epic**: EP-GRID-WORKBOOKS
**BI**: BI-0643992A
**Spec**: [docs/superpowers/specs/2026-03-23-universal-grid-workbooks-design.md](../specs/2026-03-23-universal-grid-workbooks-design.md) (v1.2)
**Date**: 2026-06-06
**Status**: In progress

## Goal of Phase 1

Ship the first working vertical slice: **user-defined Workbooks** (the Airtable/Smartsheet
paradigm the operator named), end to end, behind a library-agnostic Grid interface. A knowledge
worker can create a workbook, add a custom table with typed columns, and edit rows inline in a
spreadsheet grid. AI coworkers can read/write the same data via MCP.

Platform-data adapters (backlog/finance/compliance grids), kanban, AI column advisor, and the
remaining field types are tracked as follow-up BIs under the same epic — not in this slice.

## Library decision (closes the spec's open "build the grid" question)

Embed **react-data-grid** (`react-data-grid@^7`, MIT, peerDep React ^19.2 — exact match for our
React 19.2.7). DOM-based, so it complies with the mandatory `--dpf-*` theme-token styling rule
(AGENTS.md §12); canvas grids (glide-data-grid) cannot and were ruled out. Ships inline editing,
row/column virtualization, sorting, column resize, row selection, copy-paste, and custom cell
renderers out of the box. Wrapped behind the spec's `GridProps`/`<Grid>` interface so it is
swappable. Watch item: rdg's 7.x line is published as `beta` (it is the maintained React-19 line;
6.x is React-18 only) — tracked, not blocking.

## Build steps (ordered, each independently committable)

1. **Schema + migration** (`packages/db/prisma/schema.prisma`)
   - Add the 7 models verbatim from the spec's Prisma block (Workbook, WorkbookShare,
     WorkbookTable, WorkbookColumn, WorkbookRow, WorkbookCell, WorkbookView).
   - Add the named back-relations on `User` (WorkbookCreatedBy, WorkbookShareUser,
     WorkbookRowCreatedBy, WorkbookViewCreatedBy).
   - Generate migration: `pnpm --filter @dpf/db exec prisma migrate dev --name universal_grid_workbooks`.

2. **Shared types + adapter framework** (`apps/web/lib/workbooks/`)
   - `types.ts` — ColumnDefinition, GridRow, CellValue, ViewConfig, DataSourceFilter,
     GridCapabilities, FieldType union (the Phase-1 field types).
   - `adapter.ts` — `DataSourceAdapter` interface + `gridRegistry` registration map.
   - `custom-table-adapter.ts` — reads/writes WorkbookRow/WorkbookCell; maps cells <-> grid shape;
     implements cell-value <-> storage-column resolution by fieldType.
   - `cell-validation.ts` — Zod-based per-fieldType validation (text/number/date/checkbox/select/
     multi_select/reference/url/email) returning a typed storage value; shared by server actions + MCP.

3. **Server actions** (`apps/web/lib/actions/workbooks.ts`, `"use server"`)
   - CRUD: createWorkbook, listWorkbooks, getWorkbook, deleteWorkbook; create/deleteTable;
     add/update/deleteColumn; create/update/deleteRow (cell writes go through cell-validation);
     saveView/listViews. Auth via `auth()`; permission check via `manage_workbooks`/`view_workbooks`.
   - Owner WorkbookShare created on workbook creation. revalidatePath on the workbooks routes.

4. **API routes** (`apps/web/app/api/v1/workbook*/.../route.ts`)
   - The endpoints from the spec's API section, using `authenticateRequest`,
     `parsePagination`/`buildPaginatedResponse`, `apiSuccess`/`ApiError`. Thin wrappers over the
     server-action logic (shared helpers in lib to avoid duplication).

5. **Grid component** (`apps/web/components/workbooks/Grid.tsx`, `"use client"`)
   - Props = spec `GridProps`. Maps ColumnDefinition -> react-data-grid columns with type-appropriate
     editors (text input, number, DatePicker, select dropdown, checkbox, ReferenceTypeahead).
   - Theme via a dpf-grid.css that maps react-data-grid CSS variables -> `--dpf-*` tokens.
   - onRowsChange -> updateCells server action (optimistic). Sorting + column resize persisted to view.

6. **Permissions + tile** (`apps/web/lib/govern/permissions.ts`)
   - Add `view_workbooks` (all roles) + `manage_workbooks` (HR-300+) to CapabilityKey + PERMISSIONS.
   - Add a Workbooks tile to ALL_TILES; register shell nav route.

7. **UI pages** (`apps/web/app/(shell)/workbooks/`)
   - Hub `page.tsx`: list workbooks, create-workbook action, empty state.
   - `[workbookId]/page.tsx`: tables list + add-table; render the active table's Grid; add-column flow.

8. **MCP tools** (`apps/web/lib/mcp-tools.ts`)
   - `workbook_list_tables`, `workbook_get_schema`, `workbook_query_rows`, `workbook_create_row`,
     `workbook_update_cells` — definitions in PLATFORM_TOOLS + handler cases in executeTool, reusing
     the same adapter + cell-validation as the UI. Gated on view_workbooks/manage_workbooks.

9. **Tests + build gate**
   - Unit: cell-validation (each fieldType happy + reject), custom-table-adapter cell<->storage
     mapping, view filter/sort translation.
   - `pnpm --filter web typecheck` + `pnpm --filter web build` green; vitest for affected files.
   - Migration applies cleanly.

## Out of scope for Phase 1 (follow-up BIs under EP-GRID-WORKBOOKS)

- Platform-data adapters (BacklogItemAdapter, CustomerAdapter, EpicAdapter, …) + embedded domain grids
- Kanban view + drag-drop
- AI column-addition advisor
- Phase-2 field types (formula, rollup, lookup, attachment, currency)
- Cell-level audit trail / change history
