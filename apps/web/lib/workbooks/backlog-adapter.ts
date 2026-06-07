// Universal Grid & Workbooks — BacklogItemAdapter (EP-GRID-WORKBOOKS, Phase 1b)
//
// Renders real BacklogItem records as an editable grid. This is the first
// platform-data adapter: the grid is a live view over the same records the
// backlog forms edit, NOT a copy. Writes route through the canonical
// updateBacklogItem server action (which itself enforces manage_backlog and all
// status/validation rules) — never a raw prisma write.

import { prisma } from "@dpf/db";
import { updateBacklogItem } from "@/lib/actions/backlog";
import { getBacklogItems } from "@/lib/explore/backlog-data";
import {
  gridRegistry,
  type DataSourceAdapter,
  type AdapterContext,
} from "./adapter";
import {
  BACKLOG_ENTITY_TYPE,
  BACKLOG_COLUMNS,
  backlogItemToGridRow,
  buildBacklogInput,
  type BacklogEditableExisting,
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

async function readGridRow(itemId: string): Promise<GridRow | null> {
  const item = await prisma.backlogItem.findUnique({
    where: { itemId },
    select: {
      itemId: true,
      title: true,
      status: true,
      type: true,
      workType: true,
      source: true,
      priority: true,
      epicId: true,
      body: true,
      updatedAt: true,
    },
  });
  return item ? backlogItemToGridRow(item) : null;
}

class BacklogItemAdapter implements DataSourceAdapter {
  readonly entityType = BACKLOG_ENTITY_TYPE;

  async getColumns(): Promise<ColumnDefinition[]> {
    return BACKLOG_COLUMNS;
  }

  async queryRows(
    _entityType: string,
    opts: { filters: DataSourceFilter; sort: SortSpec[]; pagination: Pagination },
  ): Promise<PagedRows> {
    const items = await getBacklogItems();
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
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        workType: true,
        source: true,
        priority: true,
        body: true,
        epicId: true,
        digitalProductId: true,
        taxonomyNodeId: true,
      },
    });
    if (!existing) throw new Error("Backlog item not found");

    const editable: BacklogEditableExisting = {
      title: existing.title,
      type: existing.type,
      status: existing.status,
      workType: existing.workType,
      source: existing.source,
      priority: existing.priority,
      body: existing.body,
      epicId: existing.epicId,
      digitalProductId: existing.digitalProductId,
      taxonomyNodeId: existing.taxonomyNodeId,
    };

    const input = buildBacklogInput(editable, changes);
    // Canonical, fully-validated + authorized update path (enforces manage_backlog).
    await updateBacklogItem(existing.id, input);

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
