// Universal Grid & Workbooks — data source adapter interface + registry (EP-GRID-WORKBOOKS)
// Spec: docs/superpowers/specs/2026-03-23-universal-grid-workbooks-design.md §"Adapter Framework"
//
// Every grid data source (custom user tables, and — in later phases — platform
// entities like backlog_item) implements this interface. Registering an adapter
// is the single line a new domain needs to gain grid/MCP access.

import {
  type ColumnDefinition,
  type GridRow,
  type DataSourceFilter,
  type SortSpec,
  type Pagination,
  type PagedRows,
  type GridCapabilities,
  type CellValue,
} from "./types";

export interface AdapterContext {
  userId: string;
  /** workbook-level role for the current user, when the table belongs to a workbook */
  workbookRole?: "owner" | "editor" | "viewer";
  /**
   * For platform-data adapters (not backed by a WorkbookShare): whether the user
   * holds the domain's manage capability (e.g. manage_backlog). The service
   * resolves it from the domain permission and passes it in.
   */
  canManage?: boolean;
}

export interface ReferenceResolution {
  label: string;
  url?: string;
}

export interface DataSourceAdapter {
  /** matches WorkbookTable.dataSource ("custom", "backlog_item", …) */
  readonly entityType: string;

  /** Column schema for a table. Custom tables read WorkbookColumn; platform adapters return a fixed set. */
  getColumns(tableId: string): Promise<ColumnDefinition[]>;

  queryRows(
    tableId: string,
    opts: { filters: DataSourceFilter; sort: SortSpec[]; pagination: Pagination },
  ): Promise<PagedRows>;

  getRow(tableId: string, rowId: string): Promise<GridRow | null>;

  // Mutations — read-only adapters omit these.
  createRow?(
    tableId: string,
    input: Record<string, CellValue>,
    ctx: AdapterContext,
  ): Promise<GridRow>;
  updateCells?(
    tableId: string,
    rowId: string,
    changes: Record<string, CellValue>,
    ctx: AdapterContext,
  ): Promise<GridRow>;
  deleteRow?(tableId: string, rowId: string, ctx: AdapterContext): Promise<void>;

  // Reference resolution — optional.
  resolveReference?(
    referenceType: string,
    referenceId: string,
  ): Promise<ReferenceResolution | null>;
  searchReferences?(
    referenceType: string,
    query: string,
  ): Promise<{ id: string; label: string }[]>;

  getCapabilities(ctx: AdapterContext): GridCapabilities;
}

/**
 * The embedded grid owns filtering/sorting/grouping over one bounded client
 * dataset. Ask an adapter for that bound once; repeatedly paging an adapter that
 * materializes its source per call multiplies the same database work.
 */
export function queryBoundedRowsOnce(
  adapter: DataSourceAdapter,
  tableId: string,
  opts: { filters: DataSourceFilter; sort: SortSpec[]; limit: number },
): Promise<PagedRows> {
  return adapter.queryRows(tableId, {
    filters: opts.filters,
    sort: opts.sort,
    pagination: { cursor: null, limit: opts.limit },
  });
}

class GridRegistry {
  private adapters = new Map<string, DataSourceAdapter>();

  register(adapter: DataSourceAdapter): void {
    this.adapters.set(adapter.entityType, adapter);
  }

  get(entityType: string): DataSourceAdapter | undefined {
    return this.adapters.get(entityType);
  }

  require(entityType: string): DataSourceAdapter {
    const adapter = this.adapters.get(entityType);
    if (!adapter) {
      throw new Error(`No grid adapter registered for data source "${entityType}"`);
    }
    return adapter;
  }

  has(entityType: string): boolean {
    return this.adapters.has(entityType);
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }
}

export const gridRegistry = new GridRegistry();
