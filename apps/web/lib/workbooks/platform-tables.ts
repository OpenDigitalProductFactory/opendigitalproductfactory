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
