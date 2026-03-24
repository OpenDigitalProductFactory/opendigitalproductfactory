# Universal Grid & Workbooks Design

**Epic**: Universal Grid & Workbooks — Airtable/Smartsheet Experience for Knowledge Workers
**Date**: 2026-03-23
**Status**: Draft
**Version**: 1.1

## Problem Statement

Knowledge workers across every domain (ops, CRM, compliance, finance, HR, inventory) need a familiar, powerful way to view, filter, sort, and manipulate structured data. The current platform uses bespoke flex layouts per domain area — each with its own column rendering, sort logic, and edit patterns. This creates inconsistency, duplicated effort for each new domain, and no path for users to define their own data structures.

Airtable and Smartsheet have proven that the grid (spreadsheet) paradigm — dating back to VisiCalc — is the interface knowledge workers think in. This epic brings that paradigm into the platform as a core infrastructure capability, not a standalone feature.

## Goals

1. **Universal grid primitive**: Every list of records in the platform — current or future — can be rendered as an interactive grid with inline editing, sorting, filtering, and saved views.
2. **User-defined workbooks**: Knowledge workers can create their own tables with custom fields, linked to existing platform data via reference columns.
3. **AI coworker integration**: AI agents participate as full data citizens via MCP tools, and advise users on optimal data modeling decisions.
4. **Adapter framework**: New domain areas get grid/kanban/MCP access for free by implementing a single adapter interface.

## Non-Goals

- Full Gantt chart / timeline views (separate future epic)
- Calendar view (Phase 2)
- User-to-user table linking / cross-workbook joins (Phase 2)
- Formula engine (Phase 2 — column-level computed fields)
- Offline workbook access
- Real-time collaborative editing (multi-cursor)
- Cell-level audit trail / change history (Phase 2 — relevant for regulated industries)

## Research: Airtable & Smartsheet Benchmarking

### What makes these tools valuable

**Airtable** is a user-defined relational database with multiple view types. Its core value:
- Linked records + rollups (eliminates data duplication across tables)
- Multiple views of the same data (grid, kanban, calendar, gallery)
- Forms for data collection from non-users
- Automations (trigger → action chains)
- AI Field Agents for content generation

**Smartsheet** is a spreadsheet-paradigm tool built for project management. Its core value:
- Gantt charts with dependencies and critical path
- Native approval workflows (governance-first)
- Dashboards with real-time reporting
- Familiar spreadsheet UX (low learning curve)
- Control Center for project template standardization

### The 80/20 for knowledge workers

The 20% of features delivering 80% of value:
1. **Grid view with inline editing** — the universal data entry paradigm
2. **Filtering and sorting** — find what matters fast
3. **Multiple views of same data** — grid for data entry, kanban for workflow
4. **Reference fields to related data** — eliminates duplication
5. **Saved view configurations** — personalized lenses per user/role

### How DPF differentiates

- **AI coworker as data modeling advisor**: When users add columns, the AI suggests reference fields to existing platform data instead of naive text columns. Airtable lets users make bad data decisions silently.
- **Platform-native references**: User tables link to real platform entities (epics, customers, products) with resolved display values — not just foreign keys.
- **MCP-first AI access**: AI agents interact with workbook data through typed MCP tools, enabling AI-native workflows that Airtable/Smartsheet can only approximate through Zapier/webhook integrations.
- **Adapter framework**: Every platform domain automatically supports the grid paradigm. No per-domain UI development needed for basic grid views.

## Architecture

### Design Principle: Universal Grid

**"Every list is a grid. Every grid follows the same rules."**

The grid is not a feature in the Workbooks area — it is a core platform rendering capability that any current or future domain area inherits automatically. When a new Prisma model is added, implementing an adapter gives it grid/kanban/filtering/sorting/MCP access for free.

Different views (grid, kanban, record detail with embedded mini-grids), same business logic. The adapter layer is the single source of truth for how data is read and written, regardless of presentation.

### Architecture Stack

```
Presentation Layer    Grid | Kanban | Record Detail | Future views
                      -------------------------------------------------
View Config           WorkbookView (sort, filter, column visibility)
                      -------------------------------------------------
Adapter Layer         BacklogItemAdapter | CustomerAdapter | CustomTableAdapter | ...
                      Maps Prisma fields <-> grid columns, declares editability
                      -------------------------------------------------
Business Logic        Existing server actions (createBacklogItem, updateCustomer, etc.)
                      Validation, permissions, side-effects - unchanged
                      -------------------------------------------------
Data Layer            Prisma models (existing) + WorkbookRow/Cell (user-defined)
```

### Migration Path for Existing UIs

This is not a rewrite. Existing domain pages gain a "Grid View" toggle alongside their current layout. Over time, the grid becomes the default as users prefer its filtering/sorting power. Domain-specific UX (epic progress bars, compliance status badges) renders inside grid cells via custom cell renderers.

## Data Model

### Relationship to Existing DynamicView / DynamicForm

The existing `DynamicView` and `DynamicForm` models serve a narrower purpose: DynamicView stores layout configs for EA canvas views; DynamicForm stores form field schemas for offline-capable data collection. Neither supports the grid paradigm (inline editing, column typing, cell-level storage, view switching).

The Workbook models supersede `DynamicView` for tabular data presentation. `DynamicView` continues to serve EA canvas views. `DynamicForm` continues to serve offline forms. No migration or deprecation is needed — they are complementary, not overlapping.

### Prisma Schema

ID conventions follow the platform pattern: `id` (cuid PK for internal FKs) + a human-readable secondary ID with a meaningful prefix for display and API references.

All `User` relations use named relation labels to avoid Prisma ambiguity with the existing 40+ User relations.

```prisma
model Workbook {
  id          String   @id @default(cuid())
  workbookId  String   @unique // format: "WB-<cuid>" — generated by server action
  name        String
  description String   @default("")
  areaSlug    String?  // links to shell area (ops, crm, etc.) — null for standalone
  createdById String
  createdBy   User     @relation("WorkbookCreatedBy", fields: [createdById], references: [id])
  tables      WorkbookTable[]
  shares      WorkbookShare[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model WorkbookShare {
  id          String   @id @default(cuid())
  workbookId  String
  workbook    Workbook @relation(fields: [workbookId], references: [id], onDelete: Cascade)
  userId      String
  user        User     @relation("WorkbookShareUser", fields: [userId], references: [id])
  role        String   // owner | editor | viewer
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([workbookId, userId])
}

model WorkbookTable {
  id               String   @id @default(cuid())
  tableId          String   @unique // format: "TBL-<cuid>"
  name             String
  position         Int      @default(0)
  workbookId       String
  workbook         Workbook @relation(fields: [workbookId], references: [id], onDelete: Cascade)
  dataSource       String   @default("custom")
  // "custom" = user-defined rows stored in WorkbookRow/Cell
  // Any other value = view over existing Prisma model (e.g., "backlog_item", "customer_contact")
  dataSourceFilter Json?    // optional pre-filter — see "Data Source Filter Schema" below
  columns          WorkbookColumn[]
  rows             WorkbookRow[]     // only populated when dataSource = "custom"
  views            WorkbookView[]
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([workbookId, position])
}

model WorkbookColumn {
  id           String   @id @default(cuid())
  columnId     String   @unique // format: "COL-<cuid>"
  name         String
  position     Int      @default(0)
  tableId      String
  table        WorkbookTable @relation(fields: [tableId], references: [id], onDelete: Cascade)
  fieldType    String   // text | number | date | datetime | checkbox | select | multi_select | reference | url | email
  fieldConfig  Json?    // select options, reference target type, validation rules, etc.
  sourceField  String?  // when dataSource != "custom", maps to the Prisma model field name
  required     Boolean  @default(false)
  defaultValue String?
  width        Int?     // pixel width for grid rendering
  cells        WorkbookCell[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([tableId, position])
}

model WorkbookRow {
  id          String   @id @default(cuid())
  rowId       String   @unique // format: "ROW-<cuid>"
  position    Int      @default(0)
  tableId     String
  table       WorkbookTable @relation(fields: [tableId], references: [id], onDelete: Cascade)
  createdById String
  createdBy   User     @relation("WorkbookRowCreatedBy", fields: [createdById], references: [id])
  cells       WorkbookCell[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([tableId, position])
}

model WorkbookCell {
  id               String   @id @default(cuid())
  rowId            String
  row              WorkbookRow    @relation(fields: [rowId], references: [id], onDelete: Cascade)
  columnId         String
  column           WorkbookColumn @relation(fields: [columnId], references: [id], onDelete: Cascade)
  textValue        String?
  numberValue      Float?
  dateValue        DateTime?
  boolValue        Boolean?
  selectValue      String?        // stored key from fieldConfig options
  multiSelectValue String[]       // array of selected keys (Postgres array — DB is Postgres-only)
  referenceId      String?        // platform entity ID
  referenceType    String?        // entity table: "epic", "customer_contact", etc.
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([rowId, columnId])
  @@index([referenceType, referenceId])
  @@index([columnId, textValue])
  @@index([columnId, numberValue])
  @@index([columnId, dateValue])
}

model WorkbookView {
  id          String   @id @default(cuid())
  viewId      String   @unique // format: "VW-<cuid>"
  name        String
  tableId     String
  table       WorkbookTable @relation(fields: [tableId], references: [id], onDelete: Cascade)
  viewType    String   @default("grid") // grid | kanban
  config      Json     // see "View Config Schema" below
  isDefault   Boolean  @default(false)
  createdById String
  createdBy   User     @relation("WorkbookViewCreatedBy", fields: [createdById], references: [id])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([tableId, createdById])
}
```

### Platform Permissions

New capability keys added to the permission system:

- `view_workbooks` — Can view workbooks and their data (all authenticated users by default)
- `manage_workbooks` — Can create workbooks, add tables/columns, edit/delete (granted to managers+)

When viewing platform data through a grid (e.g., backlog items), the existing domain permission applies (`manage_backlog`, `manage_customers`, etc.). Workbook-level sharing (via `WorkbookShare`) further restricts access within the workbook permission model: owner > editor > viewer.

### Data Source Filter Schema

The `dataSourceFilter` JSON follows a consistent structure used by all adapters:

```typescript
interface DataSourceFilter {
  conditions: {
    field: string      // column sourceField name
    operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in"
    value: string | number | boolean | string[]
  }[]
  logic: "and" | "or"  // how conditions combine — default "and"
}
```

This is the same shape used in `WorkbookView.config.filters`, so the filter logic is shared between pre-configured data source filters and user-applied view filters.

### View Config Schema

The `WorkbookView.config` JSON structure:

```typescript
interface ViewConfig {
  // Grid + Kanban shared
  columns: {
    columnId: string
    visible: boolean
    width?: number       // pixels — grid only
  }[]
  sort: { columnId: string, direction: "asc" | "desc" }[]
  filters: DataSourceFilter

  // Kanban-specific
  kanban?: {
    groupByColumnId: string  // must reference a select or enum-type column
    cardFields: string[]     // columnIds to show on cards
  }
}
```

Kanban validation: when `viewType = "kanban"`, the `kanban.groupByColumnId` must reference a column with `fieldType` of `select` or a platform adapter column marked as `groupable: true` (e.g., status enums). This is validated at the API layer when saving a view — rejected with a descriptive error if the group-by column is incompatible.

### Key Indexes and Constraints

- `WorkbookCell(rowId, columnId)` — unique composite for cell lookup
- `WorkbookCell(referenceType, referenceId)` — reverse lookup for "what links to this entity?"
- `WorkbookCell(columnId, textValue/numberValue/dateValue)` — column-scoped filtering and sorting
- `WorkbookColumn(tableId, position)` — column ordering
- `WorkbookRow(tableId, position)` — row ordering
- `WorkbookTable(workbookId, position)` — table ordering within workbook
- `WorkbookView(tableId, createdById)` — fast view lookup per user
- `WorkbookShare(workbookId, userId)` — unique per user per workbook

## View Engine

### Unified Rendering Pipeline

Whether the table's data source is `custom` or a platform entity, the grid component receives the same shape:

```typescript
interface GridProps {
  columns: ColumnDefinition[]
  rows: GridRow[]  // { rowId: string, cells: Record<columnId, CellValue> }
  view: ViewConfig
  dataSource: string
  capabilities: GridCapabilities
}

interface GridCapabilities {
  canAddRow: boolean       // true for custom, false for platform data initially
  canAddColumn: boolean    // true for custom, guided for platform
  canEditCell: boolean     // per-cell based on permissions + data source
  canDeleteRow: boolean
}
```

### Data Source Adapter Pattern

Each platform entity gets a thin adapter that maps its Prisma fields to the grid's column/cell format. Adapters declare which fields are editable through the grid. Writes through adapters call existing server actions — no bypass of validation or business logic.

### Grid Component Responsibilities

- Column resizing and reordering (persisted to WorkbookView config)
- Inline cell editing with type-appropriate inputs (text field, date picker, select dropdown, reference typeahead)
- Sort by any column (multi-column sort stored in view config)
- Filter bar — field + operator + value, combinable with AND logic
- Row selection (checkbox column) for bulk actions
- Virtual scrolling for large datasets
- Custom cell renderers per column (status badges, progress bars, priority flags)

### Kanban View

- Requires a `select` or status-type column as the group-by field
- Cards show a configurable subset of columns
- Drag-drop between columns triggers cell update on the group-by field
- Same filter/sort as grid, different layout

### Embedded Grid Views in Domain Areas

Domain area pages (Ops, CRM, etc.) embed grid instances using pre-configured `WorkbookTable` records with platform data sources and sensible default columns. Users can customize their view (hide/show columns, reorder, filter) and save it. The grid renders inline, with a toggle between the legacy layout and grid view during migration.

## Adapter Framework

### Adapter Interface

```typescript
interface DataSourceAdapter<T> {
  // Identity
  entityType: string

  // Schema discovery
  getColumns(): ColumnDefinition[]
  getCellRenderers(): Record<string, CellRenderer>

  // Data access
  queryRows(filters: Filter[], sort: SortSpec[], pagination: Pagination): Promise<GridRow[]>
  getRow(id: string): Promise<GridRow>

  // Mutations (optional - read-only adapters omit these)
  createRow?(input: Record<string, CellValue>): Promise<GridRow>
  updateCells?(rowId: string, changes: Record<string, CellValue>): Promise<GridRow>
  deleteRow?(rowId: string): Promise<void>

  // Reference resolution
  resolveReference?(id: string): Promise<{ label: string, url?: string }>
  searchReferences?(query: string): Promise<{ id: string, label: string }[]>

  // Permissions
  getCapabilities(userId: string): Promise<GridCapabilities>
}
```

### Registration

```typescript
// Declarative — each domain registers its adapter at app init
gridRegistry.register("backlog_item", new BacklogItemAdapter())
gridRegistry.register("customer_contact", new CustomerContactAdapter())
gridRegistry.register("epic", new EpicAdapter())
gridRegistry.register("custom", new CustomTableAdapter())
// Future domains: add one line
```

### What a New Domain Gets for Free

By implementing the adapter interface and registering it:
- Grid view with inline editing, sorting, filtering, pagination
- Kanban view grouped by any select/enum field
- Embeddable mini-grids for record detail pages
- Saved view configs per user
- MCP tool access (MCP tools query the registry)
- AI coworker read/write through the same interface

## AI Coworker Integration

### UI-Side: Column Addition Advisor

When a user clicks "Add Column" on a custom table:

1. User types a column name (e.g., "Customer Name")
2. The system sends the column name + existing table context to the AI coworker
3. The AI analyzes:
   - Does a platform entity already have this data?
   - Would a reference field be better than a free-text column?
   - Is there a naming convention or field type that fits?
4. The AI responds with one of:
   - **Suggest reference**: "The platform already tracks customers. Want me to add a reference field to Customer instead of a text column?"
   - **Suggest field type**: "This looks like a date — want me to make it a Date field?"
   - **Approve as-is**: No friction when the naive approach is the right approach.
5. User accepts or overrides. The AI never blocks — it advises.

This is a lightweight inline interaction, not a full chat conversation.

### MCP Tools

```
workbook_list_tables      — List all tables the agent has access to
workbook_get_schema       — Get column definitions for a table
workbook_query_rows       — Read rows with filter/sort/pagination
workbook_create_row       — Insert a new row (validates against column types)
workbook_update_cells     — Update specific cells in a row
workbook_delete_row       — Delete a row
workbook_add_column       — Add a column to a custom table
workbook_update_column    — Rename, reorder, or reconfigure a column
workbook_delete_column    — Delete a column (cascades to all cell data)
workbook_get_views        — List saved views for a table
workbook_save_view        — Create or update a saved view configuration
```

### MCP Access Constraints

- Agents respect the same permissions as users — Trusted AI Kernel trust level determines write vs. read access
- All MCP writes go through the same validation as UI writes (field type checking, reference resolution)
- Agents can access both custom tables and platform data source tables through the same MCP interface
- MCP tool descriptions include the table's column schema so agents can reason about available fields

### AI-Initiated Suggestions (Passive)

When an agent is working in a context that involves workbook data, it can surface observations through the existing AI coworker chat interface: "This table has 3 columns duplicating data from the CRM. Want me to convert them to reference fields?"

## Navigation

### Hub + Embedded Model

**Top-level "Workbooks" area** in the shell navigation:
- Home for user-defined workbooks and tables
- Catalog of all available grid views across the platform
- Discovery surface where the AI coworker can suggest connections between user data and platform data

**Embedded grid views in domain areas:**
- Each domain area (Ops, CRM, Compliance, etc.) gets grid views of its data inline
- Pre-configured WorkbookTable records with platform data sources
- Users customize and save their own view configs
- Grid appears alongside (and eventually replaces) the current custom layouts

## Field Types (Phase 1)

| Type | Storage | Input Control | Notes |
|------|---------|---------------|-------|
| text | textValue | Text input | Single-line default, multiline via fieldConfig |
| number | numberValue | Number input | Supports decimals |
| date | dateValue | DatePicker | Uses existing DatePicker component |
| datetime | dateValue | DatePicker + time | Full timestamp |
| checkbox | boolValue | Checkbox toggle | |
| select | selectValue | Dropdown | Options defined in fieldConfig |
| multi_select | multiSelectValue | Multi-select dropdown | Array of option keys |
| reference | referenceId + referenceType | ReferenceTypeahead | Links to platform entity |
| url | textValue | Text input + link icon | Validated as URL |
| email | textValue | Text input + mail icon | Validated as email |

### Phase 2 Field Types (Future)

- **formula**: Computed column (expression evaluated per row)
- **rollup**: Aggregate linked records (SUM, COUNT, AVG)
- **lookup**: Pull display value from referenced record
- **attachment**: File upload linked to row
- **currency**: Number with currency formatting

## Validation & Error Handling

### Cell Write Validation

Every cell write is validated against the column's `fieldType` before persistence:

- **Type mismatch**: Writing a non-numeric string to a `number` column returns 400 with `"Invalid value for number field: expected numeric"`. The server action maps the input value to the correct storage column (`textValue`, `numberValue`, etc.) based on `fieldType` — clients never choose the storage column directly.
- **Required fields**: Creating or updating a row checks all `required: true` columns have non-null values. Missing required fields return 400 with the list of missing column names.
- **Select values**: `selectValue` must match a key in the column's `fieldConfig.options` array. Unknown keys return 400.
- **URL validation**: `url` fields validated with `new URL()` constructor — must be a parseable URL.
- **Email validation**: `email` fields validated with the same Zod email pattern used elsewhere in the platform.
- **Text max length**: 10,000 characters (consistent with backlog `body` field limit).
- **Reference validation**: `referenceId` is validated against the target entity type — if the referenced record does not exist, the write is rejected with 404. This is an application-level check (no FK constraint to the target table, since references are polymorphic).

### Orphaned References

When a platform entity is deleted (e.g., a Customer is removed), cells referencing it become orphaned. Handling:
- Cells with orphaned references display "(Deleted)" in the grid — the `referenceId` is preserved but `resolveReference()` returns a tombstone label.
- No cascade delete — the cell data is retained for audit purposes.
- The AI coworker can proactively flag orphaned references: "3 cells in your table reference deleted customers. Want me to clear them?"

### Column Deletion

Deleting a column cascades to all cells for that column (via Prisma `onDelete: Cascade`). The UI confirms this destructive action before proceeding: "Delete column 'Customer Name'? This will remove data in X rows."

### Permissions

- Workbook-level: owner (full control), editor (add/edit rows and columns), viewer (read-only) — stored in `WorkbookShare`
- Inherited from platform: when viewing platform data through a grid, the existing domain permissions apply (e.g., `manage_backlog` for backlog grid editing)
- AI agent access governed by Trusted AI Kernel trust level
- View configs are per-user — saving a view does not affect other users

## API Routes

Routes follow the platform's flat pattern (globally unique IDs eliminate need for nested paths):

```
GET    /api/v1/workbooks                     — List workbooks (user has access to)
POST   /api/v1/workbooks                     — Create workbook
GET    /api/v1/workbooks/[id]                — Get workbook with tables
PATCH  /api/v1/workbooks/[id]                — Update workbook
DELETE /api/v1/workbooks/[id]                — Delete workbook

GET    /api/v1/workbook-tables/[tableId]     — Get table with columns
POST   /api/v1/workbook-tables               — Create table (workbookId in body)
PATCH  /api/v1/workbook-tables/[tableId]     — Update table
DELETE /api/v1/workbook-tables/[tableId]     — Delete table

GET    /api/v1/workbook-rows/[tableId]       — Query rows (filter, sort, paginate)
POST   /api/v1/workbook-rows                 — Create row (tableId in body)
PATCH  /api/v1/workbook-rows/[rowId]         — Update cells
DELETE /api/v1/workbook-rows/[rowId]         — Delete row

POST   /api/v1/workbook-columns              — Add column (tableId in body)
PATCH  /api/v1/workbook-columns/[colId]      — Update column (rename, reorder, resize)
DELETE /api/v1/workbook-columns/[colId]      — Delete column (cascades cells)

GET    /api/v1/workbook-views/[tableId]      — List views for table
POST   /api/v1/workbook-views                — Save view (tableId in body)
PATCH  /api/v1/workbook-views/[viewId]       — Update view config
DELETE /api/v1/workbook-views/[viewId]       — Delete view

GET    /api/v1/grid/[entityType]             — Universal grid endpoint for platform data
POST   /api/v1/grid/[entityType]/query       — Query with filters/sort via adapter
```

### Pagination

All list/query endpoints use cursor-based pagination consistent with the existing platform pattern:

```typescript
{ data: T[], nextCursor: string | null, total: number }
```

Default page size: 50 rows. Maximum: 200.

## Testing Strategy

- **Unit tests**: Adapter implementations (column mapping, cell value conversion, filter/sort translation)
- **Integration tests**: CRUD operations on WorkbookRow/Cell, reference resolution, permission checks
- **Component tests**: Grid rendering with mock data, inline editing, view config persistence
- **MCP tool tests**: End-to-end through MCP interface (list, query, create, update, delete)

## Record Detail Integration

"Record Detail" in the architecture stack diagram is not a separate view type — it refers to existing domain detail pages (e.g., Epic detail, Customer detail) embedding mini-grids for related data. When a user views an Epic, its backlog items appear as an inline grid using the `BacklogItemAdapter` with a pre-applied filter for that epic's ID. This uses the same grid component and adapter pipeline — no new view type enum needed.

## Seed Data

Platform data source tables (e.g., "Ops Backlog" with `dataSource = "backlog_item"`) are materialized on first use, not seeded. When a user opens a domain area's grid view for the first time, the system checks for an existing `WorkbookTable` for that data source + area. If none exists, it auto-creates one with default columns from the adapter's `getColumns()`. This avoids seed bloat and ensures adapters are the single source of truth for default column configs.

User-created workbooks are never seeded — they are always user-initiated.

## Build Order

1. **Prisma schema + migration** — Workbook, WorkbookShare, WorkbookTable, WorkbookColumn, WorkbookRow, WorkbookCell, WorkbookView models
2. **Adapter interface + registry** — Core types, registration mechanism, CustomTableAdapter
3. **Server actions + API routes** — CRUD for workbooks, tables, columns, rows, views; cell validation; permission checks
4. **Grid component** — Core grid with inline editing, sorting, filtering, column resize, virtual scrolling
5. **First platform adapter** — BacklogItemAdapter (Ops area gets grid view)
6. **Kanban view** — Card layout with drag-drop, sharing adapter infrastructure
7. **Workbooks hub page** — Top-level navigation, create/manage workbooks
8. **AI column advisor** — Inline suggestion flow on "Add Column"
9. **MCP tools** — Workbook MCP tool definitions and handlers
10. **Remaining platform adapters** — Customer, Epic, Employee, etc.
