// Universal Grid & Workbooks — platform-data tables (EP-GRID-WORKBOOKS, Phase 1b)
//
// Exposes existing platform datasets as grids without requiring a user-created
// Workbook. Each entry maps a registered adapter to its domain capabilities, so
// the same record a form edits can be viewed/edited as a spreadsheet. Access is
// gated by the domain's own capability (view to see, manage to edit); the
// canonical update action enforces it again on write.

import { can } from "@/lib/permissions";
import type { CapabilityKey } from "@/lib/govern/permissions";
import { gridRegistry, type AdapterContext } from "./adapter";
import "./backlog-adapter"; // self-register the backlog adapter
import "./invoice-adapter"; // self-register the invoice adapter
import "./risk-adapter"; // self-register the risk-assessment adapter
import { registerGenericReadTable, type GenericTableConfig } from "./generic-read-adapter";
import { PEOPLE_SUPPLIER_TABLES } from "./people-supplier-configs";
import {
  type ColumnDefinition,
  type GridRow,
  type CellValue,
  type GridCapabilities,
  type DataSourceFilter,
  type SortSpec,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  emptyViewConfig,
  type ViewConfig,
} from "./types";
import { WorkbookError } from "./workbook-service";

export interface PlatformUser {
  id: string;
  platformRole: string | null;
  isSuperuser: boolean;
}

/**
 * Where a platform grid lives in the portal IA. Each platform dataset is revealed
 * in-place on its own domain surface (EP-GRID-WORKBOOKS per-surface integration),
 * not on a standalone Workbooks hub. `board` marks whether the grid has a groupable
 * column suitable for a Kanban Board view.
 */
export interface PlatformTableHomeSurface {
  path: string;
  label: string;
  board: boolean;
}

export interface PlatformTableDef {
  entityType: string;
  label: string;
  description: string;
  viewCapability: CapabilityKey;
  manageCapability: CapabilityKey;
  homeSurface: PlatformTableHomeSurface;
}

// ── Generic read-only grids (Phase 2) ──────────────────────────────────────
// Any Prisma model becomes a sortable/filterable/board grid via config — no
// bespoke adapter class. Read-only by design; editable models keep their own
// validated adapters. Field lists are explicit allow-lists (no sensitive fields).
const EPIC_TABLE: GenericTableConfig = {
  entityType: "epic",
  prismaModel: "epic",
  idField: "epicId",
  labelField: "title",
  orderBy: { field: "updatedAt", dir: "desc" },
  columns: [
    { field: "epicId", name: "ID", fieldType: "text", width: 160 },
    { field: "title", name: "Title", fieldType: "text", width: 360 },
    {
      field: "status",
      name: "Status",
      fieldType: "select",
      width: 130,
      groupable: true,
      options: [
        { key: "open", label: "Open" },
        { key: "in-progress", label: "In Progress" },
        { key: "done", label: "Done" },
      ],
    },
    { field: "priority", name: "Priority", fieldType: "number", width: 90 },
    { field: "description", name: "Description", fieldType: "text", width: 400 },
    { field: "updatedAt", name: "Updated", fieldType: "datetime", width: 170 },
  ],
  rollups: [
    {
      field: "itemCount",
      name: "Backlog items",
      targetModel: "backlogItem",
      // BacklogItem.epic @relation(fields: [epicId], references: [id]) → the FK
      // targets Epic.id (cuid), NOT the semantic epicId used as the grid rowId.
      foreignKeyField: "epicId",
      anchorField: "id",
      op: "count",
      width: 120,
    },
  ],
};

const DIGITAL_PRODUCT_TABLE: GenericTableConfig = {
  entityType: "digital_product",
  prismaModel: "digitalProduct",
  idField: "productId",
  labelField: "name",
  orderBy: { field: "updatedAt", dir: "desc" },
  columns: [
    { field: "productId", name: "ID", fieldType: "text", width: 140 },
    { field: "name", name: "Name", fieldType: "text", width: 280 },
    {
      field: "lifecycleStage",
      name: "Lifecycle",
      fieldType: "select",
      width: 140,
      groupable: true,
      options: [
        { key: "plan", label: "Plan" },
        { key: "build", label: "Build" },
        { key: "run", label: "Run" },
        { key: "retire", label: "Retire" },
      ],
    },
    { field: "version", name: "Version", fieldType: "text", width: 100 },
    { field: "description", name: "Description", fieldType: "text", width: 360 },
    { field: "updatedAt", name: "Updated", fieldType: "datetime", width: 170 },
  ],
};

// Compliance controls — read-only grid; no PII fields (owner is a relation id,
// omitted). Select options mirror the controls page facets so board/grouping align.
const COMPLIANCE_CONTROL_TABLE: GenericTableConfig = {
  entityType: "compliance_control",
  prismaModel: "control",
  idField: "controlId",
  labelField: "title",
  orderBy: { field: "updatedAt", dir: "desc" },
  columns: [
    { field: "controlId", name: "ID", fieldType: "text", width: 140 },
    { field: "title", name: "Title", fieldType: "text", width: 320 },
    {
      field: "controlType",
      name: "Type",
      fieldType: "select",
      width: 130,
      groupable: true,
      options: [
        { key: "preventive", label: "Preventive" },
        { key: "detective", label: "Detective" },
        { key: "corrective", label: "Corrective" },
      ],
    },
    {
      field: "implementationStatus",
      name: "Status",
      fieldType: "select",
      width: 150,
      groupable: true,
      options: [
        { key: "planned", label: "Planned" },
        { key: "in-progress", label: "In Progress" },
        { key: "implemented", label: "Implemented" },
        { key: "not-applicable", label: "Not Applicable" },
      ],
    },
    {
      field: "effectiveness",
      name: "Effectiveness",
      fieldType: "select",
      width: 160,
      options: [
        { key: "effective", label: "Effective" },
        { key: "partially-effective", label: "Partially Effective" },
        { key: "ineffective", label: "Ineffective" },
        { key: "not-assessed", label: "Not Assessed" },
      ],
    },
    { field: "nextReviewDate", name: "Next review", fieldType: "date", width: 130 },
    { field: "updatedAt", name: "Updated", fieldType: "datetime", width: 170 },
  ],
};

// Compliance obligations — read-only; no PII (owner is a relation id, omitted).
// category/frequency are free-form strings → text columns (no board grouping).
const COMPLIANCE_OBLIGATION_TABLE: GenericTableConfig = {
  entityType: "compliance_obligation",
  prismaModel: "obligation",
  idField: "obligationId",
  labelField: "title",
  orderBy: { field: "updatedAt", dir: "desc" },
  columns: [
    { field: "obligationId", name: "ID", fieldType: "text", width: 140 },
    { field: "title", name: "Title", fieldType: "text", width: 320 },
    { field: "category", name: "Category", fieldType: "text", width: 150 },
    { field: "frequency", name: "Frequency", fieldType: "text", width: 120 },
    { field: "applicability", name: "Applicability", fieldType: "text", width: 160 },
    { field: "reviewDate", name: "Review date", fieldType: "date", width: 120 },
    { field: "status", name: "Status", fieldType: "text", width: 110 },
    { field: "updatedAt", name: "Updated", fieldType: "datetime", width: 170 },
  ],
};

// Compliance incidents — read-only; no PII (reporter is a relation id, omitted).
const COMPLIANCE_INCIDENT_TABLE: GenericTableConfig = {
  entityType: "compliance_incident",
  prismaModel: "complianceIncident",
  idField: "incidentId",
  labelField: "title",
  orderBy: { field: "occurredAt", dir: "desc" },
  columns: [
    { field: "incidentId", name: "ID", fieldType: "text", width: 140 },
    { field: "title", name: "Title", fieldType: "text", width: 300 },
    { field: "severity", name: "Severity", fieldType: "text", width: 110 },
    { field: "category", name: "Category", fieldType: "text", width: 140 },
    { field: "status", name: "Status", fieldType: "text", width: 110 },
    { field: "regulatoryNotifiable", name: "Notifiable", fieldType: "checkbox", width: 100 },
    { field: "occurredAt", name: "Occurred", fieldType: "datetime", width: 160 },
    { field: "notificationDeadline", name: "Notify by", fieldType: "datetime", width: 160 },
  ],
};

registerGenericReadTable(EPIC_TABLE);
registerGenericReadTable(DIGITAL_PRODUCT_TABLE);
registerGenericReadTable(COMPLIANCE_CONTROL_TABLE);
registerGenericReadTable(COMPLIANCE_OBLIGATION_TABLE);
registerGenericReadTable(COMPLIANCE_INCIDENT_TABLE);
// Customers, people (safe org-directory fields only), suppliers — explicit
// allow-lists live in people-supplier-configs.ts (unit-tested for safe omission).
for (const cfg of PEOPLE_SUPPLIER_TABLES) registerGenericReadTable(cfg);

/** The registry of platform datasets available as grids. Add a row per adapter. */
export const PLATFORM_TABLES: PlatformTableDef[] = [
  {
    entityType: "backlog_item",
    label: "Backlog",
    description: "Every backlog item as an editable spreadsheet — same records as the backlog forms.",
    viewCapability: "view_operations",
    manageCapability: "manage_backlog",
    homeSurface: { path: "/ops", label: "Operations", board: true },
  },
  {
    entityType: "invoice",
    label: "Invoices",
    description: "Finance invoices as a grid — edit status inline; amounts/dates stay in the invoice form.",
    viewCapability: "view_finance",
    manageCapability: "manage_finance",
    homeSurface: { path: "/finance/invoices", label: "Invoices", board: true },
  },
  {
    entityType: "risk_assessment",
    label: "Risk assessments",
    description: "Compliance risk register as an editable spreadsheet — same records as the risk forms.",
    viewCapability: "view_compliance",
    manageCapability: "manage_compliance",
    homeSurface: { path: "/compliance/risks", label: "Risk assessments", board: true },
  },
  {
    entityType: "compliance_control",
    label: "Controls",
    description: "Compliance controls as a read-only grid — sort, filter, and board by status.",
    viewCapability: "view_compliance",
    manageCapability: "view_compliance", // read-only grid; adapter performs no writes
    homeSurface: { path: "/compliance/controls", label: "Controls", board: true },
  },
  {
    entityType: "compliance_obligation",
    label: "Obligations",
    description: "Regulatory obligations as a read-only grid — sort and filter.",
    viewCapability: "view_compliance",
    manageCapability: "view_compliance", // read-only grid; adapter performs no writes
    homeSurface: { path: "/compliance/obligations", label: "Obligations", board: false },
  },
  {
    entityType: "compliance_incident",
    label: "Incidents",
    description: "Compliance incidents as a read-only grid — sort and filter.",
    viewCapability: "view_compliance",
    manageCapability: "view_compliance", // read-only grid; adapter performs no writes
    homeSurface: { path: "/compliance/incidents", label: "Incidents", board: false },
  },
  {
    entityType: "epic",
    label: "Epics",
    description: "Every epic as a read-only grid — sort, filter, and board by status.",
    viewCapability: "view_operations",
    manageCapability: "view_operations", // read-only grid; adapter performs no writes
    homeSurface: { path: "/ops", label: "Operations", board: true },
  },
  {
    entityType: "digital_product",
    label: "Digital products",
    description: "The product portfolio as a read-only grid — sort, filter, and board by lifecycle.",
    viewCapability: "view_portfolio",
    manageCapability: "view_portfolio", // read-only grid; adapter performs no writes
    homeSurface: { path: "/portfolio", label: "Portfolio", board: true },
  },
  {
    entityType: "customer_account",
    label: "Customers",
    description: "Customer accounts as a read-only grid — sort, filter, and board by status.",
    viewCapability: "view_customer",
    manageCapability: "view_customer", // read-only grid; adapter performs no writes
    homeSurface: { path: "/customer", label: "Customers", board: true },
  },
  {
    entityType: "employee_profile",
    label: "People",
    description: "The team directory as a read-only grid (safe fields only) — board by status.",
    viewCapability: "view_employee",
    manageCapability: "view_employee", // read-only grid; adapter performs no writes
    homeSurface: { path: "/employee", label: "People", board: true },
  },
  {
    entityType: "supplier",
    label: "Suppliers",
    description: "Suppliers as an editable spreadsheet — edit safe fields inline; tax/bank details stay out.",
    viewCapability: "view_finance",
    manageCapability: "manage_finance", // validated raw-write tier (editableFields allow-list)
    // The Suppliers list lives at /finance/suppliers, so the List/Grid tabs target it.
    homeSurface: { path: "/finance/suppliers", label: "Suppliers", board: true },
  },
];

function userCtx(user: PlatformUser) {
  return { platformRole: user.platformRole, isSuperuser: user.isSuperuser };
}

export function getPlatformTable(entityType: string): PlatformTableDef | undefined {
  return PLATFORM_TABLES.find((t) => t.entityType === entityType);
}

export function getHomeSurfaceForEntity(
  entityType: string,
): PlatformTableHomeSurface | undefined {
  return getPlatformTable(entityType)?.homeSurface;
}

export function listPlatformTablesForUser(user: PlatformUser): PlatformTableDef[] {
  return PLATFORM_TABLES.filter((t) => can(userCtx(user), t.viewCapability));
}

function requireTable(user: PlatformUser, entityType: string): PlatformTableDef {
  const def = getPlatformTable(entityType);
  if (!def) throw new WorkbookError("Unknown platform table", 404);
  if (!can(userCtx(user), def.viewCapability)) {
    throw new WorkbookError("You do not have access to this data", 403);
  }
  return def;
}

export interface PlatformGridData {
  schema: {
    tableId: string;
    name: string;
    dataSource: string;
    columns: ColumnDefinition[];
    capabilities: GridCapabilities;
  };
  rows: GridRow[];
  nextCursor: string | null;
  view: ViewConfig;
}

export async function getPlatformTableGridData(
  user: PlatformUser,
  entityType: string,
  opts: { filters?: DataSourceFilter; sort?: SortSpec[]; cursor?: string | null; limit?: number } = {},
): Promise<PlatformGridData> {
  const def = requireTable(user, entityType);
  const adapter = gridRegistry.require(entityType);
  const ctx: AdapterContext = {
    userId: user.id,
    canManage: can(userCtx(user), def.manageCapability),
  };
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const columns = await adapter.getColumns(entityType);
  const { data, nextCursor } = await adapter.queryRows(entityType, {
    filters: opts.filters ?? { conditions: [], logic: "and" },
    sort: opts.sort ?? [],
    pagination: { cursor: opts.cursor ?? null, limit },
  });
  return {
    schema: {
      tableId: entityType,
      name: def.label,
      dataSource: entityType,
      columns,
      capabilities: adapter.getCapabilities(ctx),
    },
    rows: data,
    nextCursor,
    view: emptyViewConfig(columns),
  };
}

export async function updatePlatformCells(
  user: PlatformUser,
  entityType: string,
  rowId: string,
  changes: Record<string, CellValue>,
): Promise<GridRow> {
  const def = requireTable(user, entityType);
  if (!can(userCtx(user), def.manageCapability)) {
    throw new WorkbookError(`You do not have permission to edit ${def.label}`, 403);
  }
  const adapter = gridRegistry.require(entityType);
  if (!adapter.updateCells) throw new WorkbookError("This data source is read-only", 400);
  return adapter.updateCells(entityType, rowId, changes, {
    userId: user.id,
    canManage: true,
  });
}

// ── Reference columns (Phase 2) ─────────────────────────────────────────────
// A reference column on any workbook table points at a platform entity. The set
// of valid targets is exactly the platform tables whose adapter implements
// searchReferences, filtered to those the user may view (no leak of targets the
// viewer cannot see). Search/resolve re-check the target's view capability.

export interface ReferenceTarget {
  entityType: string;
  label: string;
}

/** Platform entities the user may reference from a workbook column. */
export function listReferenceTargets(user: PlatformUser): ReferenceTarget[] {
  const seen = new Set<string>();
  const targets: ReferenceTarget[] = [];
  for (const t of PLATFORM_TABLES) {
    if (seen.has(t.entityType)) continue;
    const adapter = gridRegistry.get(t.entityType);
    if (!adapter || typeof adapter.searchReferences !== "function") continue;
    if (!can(userCtx(user), t.viewCapability)) continue;
    seen.add(t.entityType);
    targets.push({ entityType: t.entityType, label: t.label });
  }
  return targets;
}

export async function searchPlatformReferences(
  user: PlatformUser,
  entityType: string,
  query: string,
): Promise<{ id: string; label: string }[]> {
  requireTable(user, entityType); // 404 unknown / 403 no view capability — no leak
  const adapter = gridRegistry.require(entityType);
  if (!adapter.searchReferences) {
    throw new WorkbookError("This data source cannot be referenced", 400);
  }
  return adapter.searchReferences(entityType, query);
}

export async function resolvePlatformReference(
  user: PlatformUser,
  entityType: string,
  referenceId: string,
): Promise<{ id: string; label: string } | null> {
  requireTable(user, entityType);
  const adapter = gridRegistry.require(entityType);
  if (!adapter.resolveReference) return null;
  const res = await adapter.resolveReference(entityType, referenceId);
  return res ? { id: referenceId, label: res.label } : null;
}

export interface ReferenceFieldOption {
  field: string;
  name: string;
}

/** The allow-listed fields of a reference target, available for a lookup column. */
export async function getReferenceTargetFields(
  user: PlatformUser,
  entityType: string,
): Promise<ReferenceFieldOption[]> {
  requireTable(user, entityType); // 403/404 — gated by the target's view capability
  const adapter = gridRegistry.require(entityType);
  const columns = await adapter.getColumns(entityType);
  return columns.map((c) => ({ field: c.columnId, name: c.name }));
}
