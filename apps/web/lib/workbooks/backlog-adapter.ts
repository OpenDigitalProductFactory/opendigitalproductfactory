// Universal Grid & Workbooks — BacklogItemAdapter (EP-GRID-WORKBOOKS, Phase 1b)
//
// Renders real BacklogItem records as an editable grid. This is the first
// platform-data adapter: the grid is a live view over the same records the
// backlog forms edit, NOT a copy. Single-cell edits route through the
// updateBacklogItemFields partial update (enforces manage_backlog; validates only
// the changed fields) so editing one cell never requires the rest of the record
// to be complete — never a raw prisma write.

import { prisma } from "@dpf/db";
import { updateBacklogItemFields } from "@/lib/actions/backlog";
import {
  gridRegistry,
  type DataSourceAdapter,
  type AdapterContext,
} from "./adapter";
import {
  BACKLOG_ENTITY_TYPE,
  BACKLOG_COLUMNS,
  backlogItemToGridRow,
  buildBacklogPatch,
} from "./backlog-adapter-mapping";
import {
  type ColumnDefinition,
  type GridRow,
  type CellValue,
  type DataSourceFilter,
  type SortSpec,
  type Pagination,
  type PagedRows,
  type GridCapabilities,
} from "./types";
import { applyFilters, applySort, paginate } from "./grid-query";
import { backlogPrismaWhere } from "./backlog-adapter-filter";

const BACKLOG_GRID_SELECT = {
  itemId: true,
  title: true,
  status: true,
  type: true,
  workType: true,
  source: true,
  priority: true,
  epicId: true,
  scopeKind: true,
  archetypeCategories: true,
  archetypeIds: true,
  scopeRationale: true,
  lifecycleTags: true,
  body: true,
  updatedAt: true,
} as const;

async function readGridRow(itemId: string): Promise<GridRow | null> {
  const item = await prisma.backlogItem.findUnique({
    where: { itemId },
    select: BACKLOG_GRID_SELECT,
  });
  return item ? backlogItemToGridRow(item) : null;
}

class BacklogItemAdapter implements DataSourceAdapter {
  readonly entityType = BACKLOG_ENTITY_TYPE;

  async getColumns(): Promise<ColumnDefinition[]> {
    return BACKLOG_COLUMNS.map((c) => ({ ...c, provenanceKind: "system" as const }));
  }

  async queryRows(
    _entityType: string,
    opts: { filters: DataSourceFilter; sort: SortSpec[]; pagination: Pagination },
  ): Promise<PagedRows> {
    // The platform grid needs only scalar grid fields. Push down the domain's
    // exact status lens when safe, then reapply the shared filter below as the
    // semantic guard for every query path.
    const items = await prisma.backlogItem.findMany({
      where: backlogPrismaWhere(opts.filters),
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      select: BACKLOG_GRID_SELECT,
    });
    const rows = items.map(backlogItemToGridRow);
    const filtered = applyFilters(rows, opts.filters);
    const sorted = applySort(filtered, opts.sort);
    return paginate(sorted, opts.pagination.cursor, opts.pagination.limit);
  }

  async getRow(_entityType: string, rowId: string): Promise<GridRow | null> {
    return readGridRow(rowId);
  }

  async updateCells(
    _entityType: string,
    rowId: string,
    changes: Record<string, CellValue>,
    _ctx: AdapterContext,
  ): Promise<GridRow> {
    const existing = await prisma.backlogItem.findUnique({
      where: { itemId: rowId },
      select: { id: true },
    });
    if (!existing) throw new Error("Backlog item not found");

    // Partial update: only the changed fields are written + validated. Enforces
    // manage_backlog and preserves status side-effects / epic auto-completion.
    await updateBacklogItemFields(existing.id, buildBacklogPatch(changes));

    const updated = await readGridRow(rowId);
    if (!updated) throw new Error("Item updated but could not be read back");
    return updated;
  }

  getCapabilities(ctx: AdapterContext): GridCapabilities {
    const canEdit = ctx.canManage === true;
    return {
      // Platform data: read + edit existing records in Phase 1b.
      // Row creation/deletion stay in the domain's own forms for now.
      canAddRow: false,
      canAddColumn: false,
      canEditCell: canEdit,
      canDeleteRow: false,
    };
  }
}

export const backlogItemAdapter = new BacklogItemAdapter();

// Self-register on module load.
gridRegistry.register(backlogItemAdapter);
